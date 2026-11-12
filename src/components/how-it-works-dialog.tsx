"use client";

import { useState } from "react";
import { Dialog } from "./dialog";
import { useI18n } from "./i18n-provider";

/**
 * «Cómo funciona» de la ficha pública, en un diálogo.
 *
 * Antes era un enlace a `/#how-it-works-title`: quien llegaba desde un buscador
 * salía de la ficha del libro para leer la explicación en la portada (y, hasta
 * que se arregló el ancla, aterrizaba arriba del todo sin verla). Los pasos se
 * leen ahora encima de la misma ficha, sin perder el libro que se estaba
 * mirando ni volver a cargar otra página.
 *
 * Los textos de los pasos son los mismos de la portada: si cambia el mecanismo,
 * se corrige en un solo sitio del diccionario y las dos superficies lo dicen
 * igual.
 */
export function HowItWorksDialog({ className = "text-link" }: { className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {t("Cómo funciona")}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("Cómo funciona")}
        description={t("Qué pasa desde que ves un ejemplar hasta que cambia de manos.")}
        className="how-dialog"
      >
        <ol className="how-dialog-steps">
          <li>
            <span className="how-step" aria-hidden="true">
              1
            </span>
            <h3>{t("Comparte")}</h3>
            <p>
              {t(
                "Publica el libro que ya has leído con su estado y tu ciudad. No hay precio: aquí los ejemplares se dan o se intercambian.",
              )}
            </p>
          </li>
          <li>
            <span className="how-step" aria-hidden="true">
              2
            </span>
            <h3>{t("Encuentra")}</h3>
            <p>{t("Busca por título, autoría o tema y filtra por distancia e idioma.")}</p>
          </li>
          <li>
            <span className="how-step" aria-hidden="true">
              3
            </span>
            <h3>{t("Pide")}</h3>
            <p>
              {t(
                "Envía una solicitud desde la ficha del libro. Llega sin texto: nadie lee nada tuyo antes de que la acepten.",
              )}
            </p>
          </li>
          <li>
            <span className="how-step" aria-hidden="true">
              4
            </span>
            <h3>{t("Quedad y confirmad")}</h3>
            <p>
              {t(
                "Acordáis la entrega en la conversación y la confirmáis las dos partes. El ejemplar pasa a la estantería de quien lo recibe y puede volver a circular.",
              )}
            </p>
          </li>
        </ol>
        <p className="how-dialog-note">
          {t(
            "Los ejemplares están en casa de quien los ofrece: la plataforma solo mantiene el índice. La conversación con la otra persona va cifrada y el intercambio no se cierra hasta que las dos partes confirman la entrega.",
          )}
        </p>
      </Dialog>
    </>
  );
}
