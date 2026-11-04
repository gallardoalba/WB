"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { translate, type Locale, type MessageKey } from "@/lib/i18n";

/**
 * Texto que se puede pasar a `t()`: cualquier español funciona (si falta la
 * traducción se muestra tal cual), pero las claves del diccionario se
 * autocompletan y `MessageKey` permite tipar mapas de etiquetas.
 */
type Translatable = MessageKey | (string & {});

type I18nValue = {
  locale: Locale;
  t: (text: Translatable, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue>({ locale: "es", t: (text) => text });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useCallback(
    (text: Translatable, vars?: Record<string, string | number>) => translate(locale, text, vars),
    [locale],
  );
  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
