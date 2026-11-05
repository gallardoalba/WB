import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { translate } from "@/lib/i18n";
import type { DocBlock, TechnicalDocument } from "@/lib/technical";
import { LocaleSwitcher } from "./locale-switcher";

/**
 * Pinta un texto con los fragmentos entre acentos graves como `código`, igual
 * que los escribiría un README sin necesidad de un motor de Markdown.
 */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function Block({ block }: { block: DocBlock }) {
  if (block.kind === "p") {
    return (
      <p>
        <Inline text={block.text} />
      </p>
    );
  }
  if (block.kind === "list") {
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === "code") {
    return (
      <pre className="doc-code">
        <code>{block.lines.join("\n")}</code>
      </pre>
    );
  }
  if (block.kind === "table") {
    return (
      <div className="doc-table">
        <table>
          <thead>
            <tr>
              {block.head.map((cell) => (
                <th key={cell} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) => (
                  <td key={`${row[0]}-${index}`}>
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <ul className="doc-links">
      {block.items.map((item) => (
        <li key={item.href}>
          <a href={item.href} target="_blank" rel="noreferrer">
            {item.label}
          </a>
          <span>{item.note}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Marco de la documentación técnica. Es pública y no necesita sesión: quien va
 * a desplegar o auditar la instancia tiene que poder leerla antes de entrar.
 */
export function TechnicalDoc({
  locale,
  document,
}: {
  locale: Locale;
  document: TechnicalDocument;
}) {
  const t = (text: string) => translate(locale, text);
  return (
    <main className="page-shell doc-shell">
      <div className="page-topbar">
        <Link className="back-link" href="/">
          <ArrowLeft size={16} /> {t("Inicio")}
        </Link>
        <LocaleSwitcher locale={locale} />
      </div>

      <div className="doc-layout">
        <aside className="doc-aside">
          <nav className="doc-toc" aria-label={t("En esta página")}>
            <p className="doc-toc-title">{t("En esta página")}</p>
            <ol>
              {document.sections.map((section) => (
                <li key={section.id}>
                  <Link href={`#${section.id}`}>{section.heading}</Link>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="tech-doc">
          <h1>{document.title}</h1>
          <p className="doc-updated">
            {locale === "de" ? "Stand" : "Última revisión"}: {document.updated}
          </p>

          {document.intro.map((paragraph) => (
            <p key={paragraph} className="doc-lead">
              <Inline text={paragraph} />
            </p>
          ))}

          {document.sections.map((section) => (
            <section key={section.id} id={section.id}>
              <h2>{section.heading}</h2>
              {section.blocks.map((block, index) => (
                <Block key={`${section.id}-${index}`} block={block} />
              ))}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
