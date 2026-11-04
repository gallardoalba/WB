"use client";

import { useSyncExternalStore } from "react";
import { HeartHandshake, MapPin, Plus, X } from "lucide-react";
import { useI18n } from "./i18n-provider";

const CHANGE_EVENT = "wb-onboarding-change";

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Guía de primeros pasos. Se puede cerrar y recuerda la decisión por cuenta;
 * no bloquea el catálogo y cada paso lleva directo a la acción.
 */
export function OnboardingCard({
  userId,
  onOpenProfile,
  onOpenOffer,
  onOpenCommunity,
}: {
  userId: string;
  onOpenProfile: () => void;
  onOpenOffer: () => void;
  onOpenCommunity: () => void;
}) {
  const { t } = useI18n();
  const storageKey = `wb-onboarding-dismissed:${userId}`;
  const visible = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(storageKey) !== "1",
    () => false,
  );

  if (!visible) return null;

  function dismiss() {
    window.localStorage.setItem(storageKey, "1");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <div className="onboarding-copy">
        <h2 id="onboarding-title">{t("Tu primer intercambio, en tres pasos")}</h2>
        <p>{t("Comparte un libro que ya hayas leído y elige a quién seguir. Todo empieza en tu ciudad.")}</p>
      </div>
      <ol className="onboarding-steps">
        <li>
          <button type="button" className="onboarding-step" onClick={onOpenProfile}>
            <MapPin size={17} />
            <span>{t("Revisa tu ciudad")}</span>
          </button>
        </li>
        <li>
          <button type="button" className="onboarding-step" onClick={onOpenOffer}>
            <Plus size={17} />
            <span>{t("Publica un libro")}</span>
          </button>
        </li>
        <li>
          <button type="button" className="onboarding-step" onClick={onOpenCommunity}>
            <HeartHandshake size={17} />
            <span>{t("Sigue a lectores")}</span>
          </button>
        </li>
      </ol>
      <button
        type="button"
        className="onboarding-close"
        aria-label={t("Cerrar la guía de primeros pasos")}
        onClick={dismiss}
      >
        <X size={16} />
      </button>
    </section>
  );
}
