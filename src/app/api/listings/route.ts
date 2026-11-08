import { after } from "next/server";
import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { getSessionUser, requireUser } from "@/lib/auth";
import { cityName } from "@/lib/city-name";
import { getCover } from "@/lib/covers";
import { notifyIndexNow } from "@/lib/indexnow";
import { announceBook } from "@/lib/mastodon";
import { catalogPage, countBookWants, createListing } from "@/lib/repo";
import { siteUrl } from "@/lib/site";
import { assertSameOrigin, clientKey, guard, hasClientIp, hit, publicaSinTope } from "@/lib/throttle";
import { catalogParamsSchema, listingSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    // La búsqueda es pública: se limita el ritmo para que no se pueda raspar.
    if (hasClientIp()) {
      hit({ bucket: "catalog:search:ip", key: clientKey(request), limit: 120, windowMs: 60_000 });
    } else {
      hit({ bucket: "catalog:search", key: "all", limit: 600, windowMs: 60_000 });
    }
    const user = await getSessionUser();
    const url = new URL(request.url);
    // Mismo criterio que la página: un parámetro raro (`?page=0`, `?sort=x`)
    // se queda en el valor por defecto en vez de devolver 422. Así el enlace
    // compartido funciona en las dos puertas de entrada al catálogo.
    const parsed = catalogParamsSchema.safeParse(Object.fromEntries(url.searchParams));
    const params = parsed.success ? parsed.data : catalogParamsSchema.parse({});
    return json(catalogPage(user?.id ?? null, params));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    // Se valida **antes** de gastar cuota: un cuerpo inválido no es un
    // intento de publicar y no debe consumir el límite diario (si no, unos
    // cuantos formularios mal enviados dejan la cuenta sin poder publicar el
    // resto del día). El rechazo es una respuesta 422 barata y sin escrituras.
    const input = listingSchema.parse(await readJson(request));
    // Dos cuotas, no una: un tope corto frena el envío en bucle y el diario
    // acota el abuso de una cuenta. Diez al día se quedaba corto para quien
    // cataloga su estantería de una sentada —y el aviso decía «espera un
    // momento» cuando la espera era de horas—.
    //
    // La administración queda fuera: catalogar un fondo entero de una sentada es
    // trabajo normal del servicio y el freno existe contra el abuso de una
    // cuenta cualquiera, no contra quien lo mantiene. La guardia de mismo origen
    // se aplica igual (es la que protege del CSRF).
    if (publicaSinTope(user)) {
      assertSameOrigin(request);
    } else {
      guard(request, { bucket: "listing:create:burst", key: user.id, limit: 5, windowMs: 60_000 });
      guard(request, {
        bucket: "listing:create",
        key: user.id,
        limit: 40,
        windowMs: 24 * 60 * 60 * 1000,
      });
    }
    const listing = createListing(
      user.id,
      input.city ? { ...input, city: await cityName(input.city) } : input,
    );
    invalidatePublicData();
    // La portada se descarga ahora, no cuando la pida la primera visita: el
    // navegador ya no habla con Open Library, así que ese segundo de espera no
    // debe pagarlo quien abre la ficha. `after` la resuelve tras responder.
    if (input.isbn) {
      const isbn = input.isbn;
      after(() => getCover(isbn).catch(() => undefined));
    }
    // Aviso a Bing (y por él a DuckDuckGo y Ecosia) de que hay una ficha nueva.
    // Va en `after()` y nunca lanza: publicar no puede depender del buscador.
    const base = siteUrl();
    after(() =>
      notifyIndexNow(base, [
        `${base}/werk/${listing.bookId}`,
        `${base}/es/werk/${listing.bookId}`,
        `${base}/en/werk/${listing.bookId}`,
      ]),
    );
    // Aviso en Mastodon, también en `after()` y tan silencioso como el anterior:
    // el post se encola en la base, así que un fallo de la instancia no pierde el
    // aviso ni retrasa la respuesta. Un post por obra y, por persona, uno al día.
    after(() =>
      announceBook({
        bookId: listing.bookId,
        title: input.title,
        author: input.author,
        language: input.language ?? null,
        base,
        ownerId: user.id,
        // Si el formulario trae portada, la sube justo después de esto.
        esperarPortada: input.withCover,
        // La administración anuncia cada obra nueva, sin el tope de una al día.
        sinTopeDiario: publicaSinTope(user),
      }),
    );
    // La demanda se calcula después de publicar: si alguien buscaba la obra
    // en la misma ciudad, la persona que publica lo ve de inmediato.
    const demand = countBookWants(listing.bookId, user.city, user.id);
    return json({ listing, demand }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
