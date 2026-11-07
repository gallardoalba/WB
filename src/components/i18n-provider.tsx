"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { messageId } from "@/lib/message-id";

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

/**
 * Traducciones del idioma activo, indexadas por el identificador del texto
 * origen (`messageId`) y no por el texto: así la clave viaja en diez dígitos en
 * lugar de en otra frase entera. En castellano llega vacío.
 */
export type Messages = Record<number, string>;

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
  /** Textos del idioma activo, por identificador; en español llega vacío. */
  messages: Messages;
  children: ReactNode;
}) {
  // `messages` llega como un objeto nuevo en **cada** render del servidor (el
  // RSC lo vuelve a deserializar), y `router.refresh()` re-renderiza a menudo.
  // Si `t` cambiara de identidad con él, cualquier efecto que lo tenga en sus
  // dependencias se volvería a ejecutar en cada refresco: el de la conversación,
  // por ejemplo, relee el hilo, marca como leído y vuelve a refrescar → bucle.
  // El diccionario vive en una referencia y `t` se crea una sola vez.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const t = useCallback(
    (text: Translatable, vars?: Record<string, string | number>) =>
      interpolate(messagesRef.current[messageId(text)] ?? text, vars),
    [],
  );
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
