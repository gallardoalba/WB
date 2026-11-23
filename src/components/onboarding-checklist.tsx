"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import type { OnboardingProgress } from "@/lib/domain";
import { api } from "@/lib/client-api";
import { localePath } from "@/lib/locale";
import { useI18n } from "./i18n-provider";

/**
 * Lista de primeros pasos de la portada.
 *
 * Las tareas las resuelve el servidor (`snapshot.onboarding`), así que se
 * tachan igual desde cualquier dispositivo. La tarjeta se oculta al completar
 * las cuatro o cuando la persona la descarta. El cierre se guarda en la cuenta
 * para que no vuelva a aparecer en otro navegador; `localStorage` se mantiene
 * como respaldo para quien ya la había cerrado antes de la v69.
 */
const STORAGE_KEY = "wb-checklist-off";
const CHANGE_EVENT = "wb-checklist-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

/** `localStorage` es la fuente de verdad: recargar no devuelve la tarjeta. */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const TASKS = [
  {
    key: "profile",
    title: "Completa tu perfil",
    hint: "Una biografía breve ayuda a que sepan qué lees.",
    path: "/cuenta",
    cta: "Editar perfil",
  },
  {
    key: "published",
    title: "Publica tu primer ejemplar",
    hint: "Con el ISBN, la ficha se rellena desde la DNB o Open Library.",
    path: "/ofrecer",
    cta: "Publicar",
  },
  {
    key: "requested",
    title: "Pide un ejemplar del catálogo",
    hint: "Quien lo tiene decide si lo comparte contigo.",
    path: "/descubrir",
    cta: "Explorar",
  },
  {
    key: "following",
    title: "Sigue a un lector",
    hint: "En «Siguiendo» verás qué publican, qué piden y qué comentan.",
    path: "/lectores",
    cta: "Ver lectores",
  },
] as const satisfies readonly {
  key: keyof OnboardingProgress;
  title: string;
  hint: string;
  path: string;
  cta: string;
}[];

export function OnboardingChecklist({ progress }: { progress: OnboardingProgress }) {
  const { t, locale } = useI18n();
  // En el servidor y en la hidratación se pinta (el snapshot es `false`); el
  // navegador lo corrige en cuanto lee la marca.
  const dismissedLocally = useSyncExternalStore(subscribe, readDismissed, () => false);
  const [pending, setPending] = useState(false);

  // Quien ya la había cerrado antes de la v69 conserva la marca local. Se
  // traslada a la cuenta en cuanto la vemos, para que no reaparezca en otro
  // navegador; la tarjeta ya está oculta en este.
  useEffect(() => {
    if (progress.dismissed || !dismissedLocally) return;
    void api("/api/account/onboarding", { method: "POST" }).catch(() => undefined);
  }, [progress.dismissed, dismissedLocally]);

  const done = TASKS.filter((task) => progress[task.key]).length;
  // Con las cuatro hechas ya no hay nada que recordar; si se descartó en esta
  // cuenta o en este navegador, tampoco.
  if (progress.dismissed || dismissedLocally || done === TASKS.length) return null;

  async function hide() {
    if (pending) return;
    setPending(true);
    // La marca local oculta la tarjeta al instante; la de la cuenta la hace
    // desaparecer también en los demás dispositivos.
    window.localStorage.setItem(STORAGE_KEY, "1");
    window.dispatchEvent(new Event(CHANGE_EVENT));
    try {
      await api("/api/account/onboarding", { method: "POST" });
    } catch {
      // Sin red, la marca local evita que se repita en esta sesión; el próximo
      // acceso lo reintentará si la tarjeta vuelve a mostrarse.
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <div className="onboarding-head">
        <div>
          <h2 id="onboarding-title">{t("Tus primeros pasos")}</h2>
          <p className="onboarding-progress">
            {t("{n} de {total} completados", { n: done, total: TASKS.length })}
          </p>
        </div>
        <button
          type="button"
          className="onboarding-hide"
          onClick={() => void hide()}
          disabled={pending}
          aria-label={t("Ocultar los primeros pasos")}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <ul className="onboarding-tasks">
        {TASKS.map((task) => {
          const completed = progress[task.key];
          return (
            <li key={task.key} className={completed ? "is-done" : undefined}>
              <span className="onboarding-check" aria-hidden="true">
                {completed ? <Check size={14} /> : null}
              </span>
              <div className="onboarding-task-text">
                <strong>
                  {t(task.title)}
                  {completed && <span className="sr-only"> — {t("hecho")}</span>}
                </strong>
                <small>{t(task.hint)}</small>
              </div>
              {!completed && (
                <Link href={localePath(locale, task.path)} className="onboarding-cta">
                  {t(task.cta)}
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className="onboarding-foot">
        <a href={`${localePath(locale, "/")}?tour=1`}>{t("Ver el tour de bienvenida")}</a>
      </p>
    </section>
  );
}
