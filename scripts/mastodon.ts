/**
 * Comprueba el bot de Mastodon sin esperar a que alguien publique un libro.
 *
 *   sudo npm --prefix /srv/wanderbibliothek/current run mastodon:test
 *   sudo npm ... run mastodon:test -- --libro bok_123      # enseña el aviso
 *   sudo npm ... run mastodon:test -- --enviar bok_123     # lo publica
 *   sudo npm ... run mastodon:test -- --ahora bok_123      # adelanta su turno
 *   sudo npm ... run mastodon:test -- --cola               # reintenta pendientes
 *   sudo npm ... run mastodon:test -- --publicadas         # revisa lo ya publicado
 *   sudo npm ... run mastodon:test -- --gustar             # enseña qué le gustaría
 *   sudo npm ... run mastodon:test -- --gustar-enviar      # da el «me gusta»
 *   sudo npm ... run mastodon:test -- --gustos             # historial de «me gusta»
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
  mastodonConfig,
  mediaForPost,
  pendingPostFor,
  processSocialOutbox,
  purgeSocialOutbox,
  STATUS_LIMIT,
  subjectsForBook,
  uploadMedia,
  workUrl,
} from "../src/lib/mastodon";
import {
  likeCountSince,
  likesConfig,
  processLikes,
  purgeSocialLikes,
  recentLikes,
} from "../src/lib/mastodon-likes";
import { reviewPublished } from "../src/lib/mastodon-review";
import { getDb } from "../src/lib/db";
import { getBook } from "../src/lib/repo";
import { siteUrl } from "../src/lib/site";

const USAGE =
  "Uso: npm run mastodon:test -- [--libro <obra>] [--media <obra>] [--enviar <obra>] [--ahora <obra>] [--cola] [--publicadas] [--gustar] [--gustar-enviar] [--gustos] [--env /ruta]";

type Options = {
  libro: string | null;
  media: string | null;
  enviar: string | null;
  ahora: string | null;
  cola: boolean;
  publicadas: boolean;
  gustar: boolean;
  gustarEnviar: boolean;
  gustos: boolean;
  entorno: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    libro: null,
    media: null,
    enviar: null,
    ahora: null,
    cola: false,
    publicadas: false,
    gustar: false,
    gustarEnviar: false,
    gustos: false,
    entorno: "/etc/wanderbibliothek/env",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--cola") {
      options.cola = true;
      continue;
    }
    if (arg === "--publicadas") {
      options.publicadas = true;
      continue;
    }
    if (arg === "--gustar") {
      options.gustar = true;
      continue;
    }
    if (arg === "--gustar-enviar") {
      options.gustarEnviar = true;
      continue;
    }
    if (arg === "--gustos") {
      options.gustos = true;
      continue;
    }
    if (arg === "--libro" || arg === "--media" || arg === "--enviar" || arg === "--ahora" || arg === "--env") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} necesita un valor.`);
      if (arg === "--libro") options.libro = value;
      else if (arg === "--media") options.media = value;
      else if (arg === "--enviar") options.enviar = value;
      else if (arg === "--ahora") options.ahora = value;
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

// Revisar lo publicado fue la primera petición: no necesita token ni red.
if (options.publicadas) {
  showPublished();
  process.exit(0);
}

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
  seed: "bok_ejemplo",
};

function showText(text: string): void {
  console.log(`\n--- Aviso (${Array.from(text).length}/${STATUS_LIMIT} caracteres) ---`);
  console.log(text);
  console.log("--- fin ---\n");
}

/**
 * Lista los avisos que ya salieron en el perfil y señala los que siguen en
 * castellano o en inglés, con su enlace para editarlos a mano en Mastodon.
 *
 * No habla con la instancia ni necesita token: lee la cola, que es donde el
 * bot anotó el estado que publicó (`external_url`). Los avisos publicados antes
 * de que el bot pasara al alemán conservan el idioma del ejemplar.
 */
function showPublished(): void {
  const rows = getDb()
    .prepare(
      `SELECT o.id, o.subject, o.body, o.external_url, o.sent_at, b.title, b.author
         FROM social_outbox o
         LEFT JOIN books b ON b.id = o.subject
        WHERE o.network = 'mastodon' AND o.status = 'sent'
        ORDER BY o.sent_at ASC, o.id ASC`,
    )
    .all() as {
    id: string;
    subject: string;
    body: string;
    external_url: string | null;
    sent_at: string | null;
    title: string | null;
    author: string | null;
  }[];

  const revisadas = reviewPublished(
    rows.map((row) => ({
      id: row.id,
      bookId: row.subject,
      title: row.title,
      author: row.author,
      body: row.body,
      url: row.external_url,
      sentAt: row.sent_at,
    })),
  );
  const pendientes = revisadas.filter((post) => post.needsTranslation);

  console.log(
    `Avisos publicados en el perfil: ${revisadas.length} · pendientes de traducción: ${pendientes.length}`,
  );
  if (pendientes.length === 0) {
    console.log("No hay avisos en otros idiomas: el perfil está en alemán.");
    return;
  }

  for (const post of pendientes) {
    const fecha = post.sentAt ? post.sentAt.slice(0, 10) : "sin fecha";
    const obra = post.title ? `${post.title} — ${post.author ?? ""}`.trim() : post.bookId;
    console.log(`\n${fecha} · ${obra}`);
    console.log(post.url ?? "(sin enlace guardado: búscalo en el perfil)");
    console.log(post.body.replace(/\n+/g, " "));
    console.log(`Motivos: ${post.reasons.join("; ")}`);
  }
  console.log("\nAbre cada enlace y edita la publicación en Mastodon para traducirla a mano.");
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

  const objetivo = options.enviar ?? options.ahora ?? options.libro ?? options.media;
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
    showText(
      composeStatus({
        title: book.title,
        author: book.author,
        url: workUrl(siteUrl(), book.id),
        seed: book.id,
        ...subjectsForBook(book.id),
      }),
    );

    // La imagen exacta que se subiría: la tarjeta del sitio o, si falla, la portada.
    const cover = await mediaForPost(siteUrl(), book.id).catch(() => null);
    console.log(
      cover
        ? `Imagen: ${cover.contentType}, ${Math.round(cover.data.byteLength / 1024)} KB → se adjunta al aviso.`
        : "Imagen: no hay (el aviso saldría solo con texto).",
    );

    if (options.media) {
      if (!cover) {
        console.error("No hay imagen que subir para esta obra.");
        process.exit(1);
      }
      // Subir sin publicar sirve para comprobar el permiso `write:media`.
      const uploaded = await uploadMedia(config!, {
        data: cover.data,
        contentType: cover.contentType,
        description: coverAlt(book.title, book.author),
      });
      console.log(
        uploaded.ok
          ? `Media subida: id ${uploaded.id} (sin adjuntar a ningún estado).`
          : `La subida falló: ${uploaded.error}. Si dice «OAuth», falta el permiso write:media en la aplicación.`,
      );
    }

    if (options.ahora) {
      // Adelantar el turno: no se vuelve a encolar (la clave única lo impide),
      // se suelta la fila que ya espera, sin hacer caso a la separación entre
      // avisos ni al horario de silencio.
      const fila = pendingPostFor(book.id);
      if (!fila) {
        console.log(
          "Esa obra no tiene aviso en cola: no hay turno que adelantar. Con --enviar <obra> se encola y sale en su turno.",
        );
      } else {
        const result = await processSocialOutbox({ limit: 1, only: fila, force: true, config });
        console.log(
          result.sent > 0
            ? "Publicado ahora, sin esperar al turno ni al horario de silencio."
            : result.failed > 0
              ? "No salió: el motivo está en la fila de la cola. Lo reintenta el cron (o `--cola`)."
              : "No había nada que publicar en esa fila.",
        );
      }
    } else if (options.enviar) {
      // Se publica con `announceBook` y no con un POST suelto: así queda la fila
      // en la cola, con su clave de idempotencia, y la obra no se anuncia dos
      // veces si alguien vuelve a poner el mismo libro.
      const result = await announceBook({
        bookId: book.id,
        title: book.title,
        author: book.author,
        base: siteUrl(),
        // El script se lanza a mano con `sudo`, desde la administración del
        // servicio: la regla de «solo la administración anuncia» se cumple.
        isAdmin: true,
      });
      console.log(
        result.sent
          ? `Publicado y anotado en la cola (${result.media ? "con portada" : "sin portada"}).`
          : result.queued
            ? "Encolado, pero el envío no salió: se reintenta en el cron (o con --cola)."
            : "No se encoló: esa obra ya tiene un aviso. Para adelantarlo, --ahora <obra>."
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

  if (options.gustos) {
    const historial = recentLikes(10);
    console.log(`\n«Me gusta» recientes (se guardan para no repetirlos): ${historial.length}`);
    for (const fila of historial) {
      console.log(
        ` ${fila.created_at} · #${fila.tag ?? "?"} · @${fila.account_acct} · ${fila.status_url ?? fila.status_id}`,
      );
    }
    console.log(`En las últimas 24 h: ${likeCountSince()}.`);
  }

  if (options.gustar || options.gustarEnviar) {
    const likes = likesConfig();
    if (!likes) {
      console.error(
        "El bot de «me gusta» está apagado: añade MASTODON_LIKES=on al entorno (y un token con write:favourites).",
      );
    } else {
      console.log(
        `«Me gusta»: tope ${likes.perDay} en 24 h, separación mínima ${likes.minGapMinutes} min, ya lleva ${likeCountSince()}.`,
      );
      const result = await processLikes({
        config: likes,
        dryRun: !options.gustarEnviar,
      });
      console.log(`\n${result.liked ? "Pulsado" : "Nada pulsado"}: ${result.reason}.`);
      if (result.status) {
        console.log(
          ` Estado ${result.status.id} · #${result.status.tag} (${result.status.locale}) · @${result.status.account}`,
        );
        console.log(` ${result.status.url ?? "(sin URL)"}`);
      }
      if (result.liked) {
        const purged = purgeSocialLikes();
        if (purged > 0) console.log(`Purgados ${purged} «me gusta» antiguos.`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
