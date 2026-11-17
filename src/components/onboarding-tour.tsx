"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Compass, Handshake, Route } from "lucide-react";
import { Dialog } from "./dialog";
import { useI18n } from "./i18n-provider";

/**
 * Tour de bienvenida de cuatro pasos.
 *
 * Se guarda en `localStorage` y no en la cuenta a propósito: es una ayuda de
 * interfaz, no un dato del perfil, y así cada navegador decide si ya la vio. La
 * cuenta puede reabrirlo con `/?tour=1` (sección «Primeros pasos»).
 */
export const TOUR_STORAGE_KEY = "wb-tour-seen";

const STEPS = [
  {
    icon: BookOpen,
    title: "Publica tu primer ejemplar",
    text: "Escribe el ISBN y la ficha se rellena con los datos de la Biblioteca Nacional Alemana (DNB) o de Open Library; si el libro no tiene ISBN, escribe el título a mano. Elige el estado, revisa la ciudad y añade una foto de la portada: es obligatoria.",
  },
  {
    icon: Compass,
    title: "Pide el ejemplar que te interese",
    text: "El catálogo se puede ojear sin cuenta. Al pedir un ejemplar avisas a quien lo tiene, y esa persona decide si lo comparte contigo. No se paga nada y nadie está obligado a corresponder.",
  },
  {
    icon: Handshake,
    title: "Quedad y confirmad",
    text: "Cuando se acepta una solicitud se abre una conversación cifrada de extremo a extremo. Acordáis dónde y cuándo —la plataforma no pide direcciones— y cada parte confirma al tener el libro en las manos. Desde ahí sigue circulando: queda en la estantería de quien lo tiene, en pausa, y puede volver a compartirse.",
  },
  {
    icon: Route,
    title: "Mira el viaje del libro",
    text: "Cada ejemplar que ya ha circulado cuenta por dónde ha pasado: ciudades y meses, nunca nombres. Quien lo tiene ahora decide si se enseña, y puedes apagarlo en tu cuenta.",
  },
] as const;

export function OnboardingTour({ autoStart }: { autoStart: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // El parámetro se lee una vez: si se releyera en cada pasada del efecto, tras
  // limpiar la URL el reabrir se perdería. `opened` evita que un refresco del
  // snapshot vuelva a abrirlo después de cerrarlo.
  const replay = useRef<boolean | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (replay.current === null) {
      replay.current =
        new URLSearchParams(window.location.search).get("tour") === "1";
    }
    if (opened.current) return;
    if (!replay.current && !autoStart) return;
    if (!replay.current && window.localStorage.getItem(TOUR_STORAGE_KEY) === "1") return;
    // En un fotograma, como el resto de diálogos: el estado no se cambia en el
    // cuerpo del efecto.
    const frame = requestAnimationFrame(() => {
      if (opened.current) return;
      opened.current = true;
      setStep(0);
      setOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [autoStart]);

  // Se quita el parámetro para que recargar no repita el tour.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tour") !== "1") return;
    url.searchParams.delete("tour");
    window.history.replaceState({}, "", url);
  }, []);

  function dismiss() {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
    setOpen(false);
    setStep(0);
  }

  const current = STEPS[step];
  const Icon = current.icon;
  const last = step === STEPS.length - 1;

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title={t(current.title)}
      description={t(current.text)}
      overline={t("PRIMEROS PASOS")}
      icon={<Icon size={20} aria-hidden="true" />}
      className="tour-dialog"
    >
      <p className="tour-progress" role="status">
        {t("Paso {n} de {total}", { n: step + 1, total: STEPS.length })}
      </p>
      <div className="dialog-actions">
        <button type="button" className="tour-skip" onClick={dismiss}>
          {t("Saltar el tour")}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setStep((value) => Math.max(0, value - 1))}
          disabled={step === 0}
        >
          {t("Anterior")}
        </button>
        <button
          type="button"
          className="share-button"
          onClick={() => (last ? dismiss() : setStep((value) => value + 1))}
        >
          {last ? t("Empezar") : t("Siguiente")}
        </button>
      </div>
    </Dialog>
  );
}
