"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "./i18n-provider";

const STORAGE_KEY = "b2p-theme";
const CHANGE_EVENT = "b2p-theme-change";
type Theme = "light" | "dark";

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

function snapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Selector manual de tema; sin elección guardada se sigue al sistema. */
export function ThemeToggle() {
  const { t } = useI18n();
  // La fuente de verdad es el atributo del <html>: así no hay parpadeo ni
  // desajuste de hidratación (el servidor siempre pinta «claro»).
  const theme = useSyncExternalStore(subscribe, snapshot, () => "light" as Theme);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: Theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.dataset.theme = initial;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  function toggle() {
    const next: Theme = snapshot() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === "dark" ? t("Cambiar a modo claro") : t("Cambiar a modo oscuro")}
      title={theme === "dark" ? t("Modo claro") : t("Modo oscuro")}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
