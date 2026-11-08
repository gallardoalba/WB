/**
 * Comprueba el bot de Mastodon sin esperar a que alguien publique un libro.
 *
 *   sudo npm --prefix /srv/wanderbibliothek/current run mastodon:test
 *   sudo npm ... run mastodon:test -- --libro bok_123      # enseña el aviso
 *   sudo npm ... run mastodon:test -- --enviar bok_123     # lo publica
 *   sudo npm ... run mastodon:test -- --cola               # reintenta pendientes
 *
 * Sin banderas no publica nada: lee el token, pregunta a la instancia quién es
 * y muestra un aviso de ejemplo con su longitud real. Así se comprueba una
 * credencial recién puesta sin ensuciar el perfil con un post de prueba.
 *
 * El entorno se toma de `/etc/wanderbibliothek/env` (el mismo fichero que lee
 * systemd); con `--env` se puede apuntar a otro. Ese fichero es de root (600),
 * de ahí el `sudo`: con `sudo -u wanderbibliothek` no se puede leer y solo se
 * vería «el bot está apagado».
 */
import { envFileProblem, loadEnvFile } from "../src/lib/env-file";
import {
  announceBook,
  composeStatus,
  coverAlt,
  coverForBook,
  localeForLanguage,
  mastodonConfig,
  processSocialOutbox,
  purgeSocialOutbox,
  STATUS_LIMIT,
  uploadMedia,
  workUrl,
} from "../src/lib/mastodon";
import { getBook } from "../src/lib/repo";
import { siteUrl } from "../src/lib/site";

const USAGE =
  "Uso: npm run mastodon:test -- [--libro <obra>] [--media <obra>] [--enviar <obra>] [--cola] [--env /ruta]";

type Options = {
  libro: string | null;
  media: string | null;
  enviar: string | null;
  cola: boolean;
  entorno: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    libro: null,
    media: null,
    enviar: null,
    cola: false,
    entorno: "/etc/wanderbibliothek/env",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--cola") {
      options.cola = true;
      continue;
    }
    if (arg === "--libro" || arg === "--media" || arg === "--enviar" || arg === "--env") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} necesita un valor.`);
      if (arg === "--libro") options.libro = value;
      else if (arg === "--media") options.media = value;
      else if (arg === "--enviar") options.enviar = value;
      else options.entorno = value;
      index += 1;
      continue;
    }
    throw new Error(`Opción desconocida: ${arg}`);
  }
  return options;
}

let options: Options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(USAGE);
  process.exit(1);
}

const problema = envFileProblem(options.entorno);
const leidas = problema ? 0 : loadEnvFile(options.entorno);
if (leidas > 0) console.log(`Entorno leído de ${options.entorno}.`);

const config = mastodonConfig();
if (!config) {
  console.error(
    "El bot está apagado: falta MASTODON_TOKEN (o MASTODON_INSTANCE no es una URL https).",
  );
  if (problema) console.error(problema);
  process.exit(1);
}

/** Obra inventada para el ejemplo: no anuncia un libro real por error. */
const SAMPLE = {
  title: "El infinito en un junco",
  author: "Irene Vallejo",
  url: "https://wanderbibliothek.org/werk/bok_ejemplo",
  locale: "de" as const,
  seed: "bok_ejemplo",
};

function showText(text: string): void {
  console.log(`\n--- Aviso (${Array.from(text).length}/${STATUS_LIMIT} caracteres) ---`);
  console.log(text);
  console.log("--- fin ---\n");
}

async function verifyCredentials(): Promise<boolean> {
  try {
    const response = await fetch(`${config!.instance}/api/v1/accounts/verify_credentials`, {
      headers: { authorization: `Bearer ${config!.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const account = (await response.json()) as { acct?: string; display_name?: string };
      console.log(`Credencial correcta: @${account.acct ?? "?"} (${account.display_name ?? ""})`);
      return true;
    }
    const body = await response.text().catch(() => "");
    console.error(`La instancia rechaza el token: HTTP ${response.status} ${body.slice(0, 200)}`);
    return false;
  } catch (error) {
    console.error(
      `No se pudo hablar con la instancia: ${error instanceof Error ? error.message : error}`,
    );
    return false;
  }
}

async function main() {
  console.log(`Instancia: ${config!.instance} · visibilidad: ${config!.visibility}`);
  if (!(await verifyCredentials())) process.exit(1);

  const objetivo = options.enviar ?? options.libro ?? options.media;
  if (!objetivo) {
    showText(composeStatus(SAMPLE));
    console.log(
      "Nada enviado. Con --libro <obra> se ve el aviso de una obra real, con --media <obra> se sube su portada sin publicar y con --enviar <obra> se publica.",
    );
  } else {
    const book = getBook(objetivo);
    if (!book) {
      console.error(`No existe la obra ${objetivo} en esta base de datos.`);
      process.exit(1);
    }
    const locale = localeForLanguage(book.language);
    showText(
      composeStatus({
        title: book.title,
        author: book.author,
        url: workUrl(siteUrl(), book.id, locale),
        locale,
        seed: book.id,
      }),
    );

    // La portada: se comprueba aquí para no llevarse la sorpresa al publicar.
    const cover = await coverForBook(book.id).catch(() => null);
    console.log(
      cover
        ? `Portada: ${cover.contentType}, ${Math.round(cover.data.byteLength / 1024)} KB → se adjunta al aviso.`
        : "Portada: no hay (el aviso saldría solo con texto).",
    );

    if (options.media) {
      if (!cover) {
        console.error("No hay portada que subir para esta obra.");
        process.exit(1);
      }
      // Subir sin publicar sirve para comprobar el permiso `write:media`.
      const uploaded = await uploadMedia(config!, {
        data: cover.data,
        contentType: cover.contentType,
        description: coverAlt(locale, book.title, book.author),
      });
      console.log(
        uploaded.ok
          ? `Media subida: id ${uploaded.id} (sin adjuntar a ningún estado).`
          : `La subida falló: ${uploaded.error}. Si dice «OAuth», falta el permiso write:media en la aplicación.`,
      );
    }

    if (options.enviar) {
      // Se publica con `announceBook` y no con un POST suelto: así queda la fila
      // en la cola, con su clave de idempotencia, y la obra no se anuncia dos
      // veces si alguien vuelve a poner el mismo libro.
      const result = await announceBook({
        bookId: book.id,
        title: book.title,
        author: book.author,
        language: book.language,
        base: siteUrl(),
      });
      console.log(
        result.sent
          ? `Publicado y anotado en la cola (${result.media ? "con portada" : "sin portada"}).`
          : result.queued
            ? "Encolado, pero el envío no salió: se reintenta en el cron (o con --cola)."
            : "No se encoló: esa obra ya tiene un aviso.",
      );
    } else if (!options.media) {
      console.log("Nada enviado. Con --enviar <obra> se publica este mismo texto.");
    }
  }

  if (options.cola) {
    const result = await processSocialOutbox({ limit: 20, config });
    console.log(`Cola: ${result.sent} enviados, ${result.failed} fallidos.`);
    const purged = purgeSocialOutbox();
    if (purged > 0) console.log(`Purgados ${purged} avisos entregados antiguos.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
