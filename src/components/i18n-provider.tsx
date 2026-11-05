"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

/**
 * Traducción en el cliente.
 *
 * El diccionario alemán **no** se importa aquí: llega resuelto desde el layout
 * (servidor) y solo para quien tiene la interfaz en alemán. Antes este módulo
 * importaba `@/lib/i18n` como valor y el diccionario entero (68 KB) viajaba al
 * navegador de todo el mundo, también para quien lee en español.
 */

/**
 * Texto que se puede pasar a `t()`: cualquier español funciona (si falta la
 * traducción se muestra tal cual), pero las claves del diccionario se
 * autocompletan y `MessageKey` permite tipar mapas de etiquetas.
 */
type Translatable = MessageKey | (string & {});

export type Messages = Record<string, string>;

type I18nValue = {
  locale: Locale;
  t: (text: Translatable, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue>({ locale: DEFAULT_LOCALE, t: (text) => text });

/** Misma interpolación que `translate()` en el servidor: `{nombre}`. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key]),
  );
}

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  /** Textos del idioma activo; en español llega vacío. */
  messages: Messages;
  children: ReactNode;
}) {
  const t = useCallback(
    (text: Translatable, vars?: Record<string, string | number>) =>
      interpolate(messages[text] ?? text, vars),
    [messages],
  );
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
