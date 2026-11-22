import { connection } from "next/server";
import { siteUrl } from "@/lib/site";

/**
 * Rastreadores que recopilan contenido para entrenar modelos. Se les cierra
 * todo desde `robots.txt` y, además, nginx les responde 403 por User-Agent
 * (un bot puede ignorar este fichero; el cortafuegos no).
 *
 * No están los que una persona provoca al preguntar (OAI-SearchBot,
 * Claude-SearchBot, Perplexity-User, ChatGPT-User): son visitas puntuales para
 * citar una página, no recolección masiva.
 */
const AI_TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "FacebookBot",
  "cohere-ai",
  "Diffbot",
  "YouBot",
  "Timpibot",
  "ImagesiftBot",
  "AI2Bot",
  "Omgilibot",
  "PanguBot",
  // Detectados en el informe del 9-nov: AIWebIndex se presenta como «índice
  // legible por IA» y RootEvidence recorrió el sitio entero sin figurar en
  // ninguna lista. Entran por la misma puerta que los demás.
  "AIWebIndex",
  "RootEvidence",
];

export default async function robots() {
  await connection();
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Las páginas públicas con `noindex` deben seguir siendo rastreables:
        // bloquearlas aquí impediría que los buscadores leyeran esa directiva.
        disallow: [
          "/api/",
          "/admin",
          "/comunidad",
          "/estanteria",
          "/intercambios",
          "/cuenta",
          "/ofrecer",
          "/verificar",
          "/verificacion",
          "/restablecer",
        ],
      },
      // Quien solo busca entrenar no lee nada, ni siquiera páginas noindex.
      { userAgent: AI_TRAINING_BOTS, disallow: "/" },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
