/**
 * Rellena sinopsis y páginas de los libros que ya estaban publicados.
 *
 *   npm run meta:refresh              # los que tienen algún hueco
 *   npm run meta:refresh -- --dry-run # enseña qué haría, sin escribir
 *   npm run meta:refresh -- --all     # también los que ya tienen los dos datos
 *
 * La migración v50 crea `books.description` y `books.pages`, pero los libros
 * anteriores se quedan vacíos: solo se rellenan cuando alguien vuelve a
 * publicar ese ISBN. Este script recorre los que tienen ISBN y pide la ficha
 * al mismo módulo que usa el formulario (DNB + Open Library), sin tocar el
 * resto de la fila. Las peticiones van de una en una: son dos o tres servicios
 * públicos y no hay prisa.
 */
import { getDb } from "../src/lib/db";
import { fetchIsbnMetadata, tagsFromSubjects } from "../src/lib/isbn-metadata";
import { TAGS, tagsForCategory } from "../src/lib/domain";

type Row = {
  id: string;
  title: string;
  isbn: string;
  description: string | null;
  pages: number | null;
};

async function main() {
  const flags = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");
  const all = flags.includes("--all");

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, isbn, description, pages
         FROM books
        WHERE isbn IS NOT NULL AND isbn <> ''
        ORDER BY created_at ASC`,
    )
    .all() as Row[];

  const pendientes = all
    ? rows
    : rows.filter((row) => row.description === null || row.pages === null);

  if (pendientes.length === 0) {
    console.log(`Nada que rellenar: ${rows.length} libro(s) con ISBN ya tienen sinopsis y páginas.`);
    return;
  }

  console.log(
    `${pendientes.length} libro(s) por revisar de ${rows.length} con ISBN${dryRun ? " (simulación)" : ""}.`,
  );

  let conDatos = 0;
  let sinDatos = 0;
  let descripciones = 0;
  let paginas = 0;
  const update = db.prepare("UPDATE books SET description = ?, pages = ? WHERE id = ?");

  for (const row of pendientes) {
    let metadata = null;
    try {
      metadata = await fetchIsbnMetadata(row.isbn, (category, subjects) =>
        tagsFromSubjects(subjects, category ? tagsForCategory(category) : TAGS),
      );
    } catch (error) {
      console.log(`  ✗ ${row.isbn} ${row.title.slice(0, 40)} — fallo de consulta: ${String(error)}`);
      sinDatos += 1;
      continue;
    }

    if (!metadata || (!metadata.description && !metadata.pages)) {
      console.log(`  · ${row.isbn} ${row.title.slice(0, 40)} — el catálogo no tiene más datos`);
      sinDatos += 1;
      continue;
    }

    // Nunca se pisa lo que ya había: solo se rellenan los huecos.
    const ganaSinopsis = row.description === null && metadata.description !== null;
    const ganaPaginas = row.pages === null && metadata.pages !== null;
    const description = row.description ?? metadata.description;
    const pages = row.pages ?? metadata.pages;
    const cambios = [ganaSinopsis ? "sinopsis" : null, ganaPaginas ? "páginas" : null].filter(Boolean);

    if (ganaSinopsis) descripciones += 1;
    if (ganaPaginas) paginas += 1;
    conDatos += 1;

    console.log(
      `  ✓ ${row.isbn} ${row.title.slice(0, 40)} — ${cambios.join(" + ") || "sin cambios"}` +
        (ganaSinopsis ? ` («${metadata.description?.slice(0, 50)}…»)` : ""),
    );

    if (!dryRun) update.run(description, pages, row.id);
  }

  console.log(
    `\n${conDatos} con datos nuevos, ${sinDatos} sin nada que añadir. ` +
      `Sinopsis: ${descripciones} · Páginas: ${paginas}.` +
      (dryRun ? " No se ha escrito nada (--dry-run)." : ""),
  );
}

void main();
