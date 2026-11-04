"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { translate, type Locale } from "@/lib/i18n";

type I18nValue = {
  locale: Locale;
  t: (text: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue>({ locale: "es", t: (text) => text });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useCallback(
    (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars),
    [locale],
  );
  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
