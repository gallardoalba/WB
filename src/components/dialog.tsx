"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "./i18n-provider";

/**
 * El diálogo se monta en `<body>` (fuera del shell de la app) y el resto de la
 * página queda `inert`: el foco y el cursor virtual del lector de pantalla no
 * pueden salir del modal.
 */
let openDialogs = 0;
const inerted = new Set<HTMLElement>();

/**
 * Último elemento que recibió el foco fuera de un diálogo: es el disparador.
 *
 * Se memoriza aquí, al recibir el foco, y no se lee `document.activeElement`
 * dentro del efecto: al abrirse un diálogo el fondo pasa a `inert`, el foco se
 * cae a `<body>` y el botón que abrió el diálogo ya no se puede recuperar (le
 * pasaba al de intercambios, que dejaba el foco en `<body>` al cerrarse).
 */
let lastFocusOutside: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest("[data-dialog-root]")) return;
      lastFocusOutside = target;
    },
    true,
  );
}

function inertBackground() {
  for (const node of Array.from(document.body.children)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.hasAttribute("data-dialog-root") || node.inert) continue;
    inerted.add(node);
    node.inert = true;
  }
}

function releaseBackground() {
  for (const node of inerted) node.inert = false;
  inerted.clear();
}

/** Lo que tarda en desaparecer al cerrarse; con menos movimiento, nada. */
const EXIT_MS = 170;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  overline?: string;
  icon?: ReactNode;
  wide?: boolean;
  /** Clase extra para dar a un diálogo concreto su propio ancho. */
  className?: string;
  children: ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  wide = false,
  className,
  children,
}: DialogProps) {
  const { t } = useI18n();
  // `createPortal` necesita `document`; en el servidor y en la hidratación se
  // usa el snapshot del servidor (false) y el diálogo aparece después.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // Al cerrarse, el panel se quedaba montado solo hasta el siguiente render y
  // desaparecía de golpe: el fundido de entrada se quedaba sin pareja. Ahora
  // sigue montado lo que dura el de salida (`is-closing`, en el CSS) y luego se
  // retira; con `prefers-reduced-motion` se retira en el acto.
  //
  // `closing` no es estado: se deduce de «abierto + todavía visible». Así no hay
  // dos fuentes de verdad que se puedan desincronizar.
  const [visible, setVisible] = useState(open);
  const closing = !open && visible;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = lastFocusOutside ?? (document.activeElement as HTMLElement | null);
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openDialogs += 1;
    inertBackground();
    // Si el diálogo tiene campos, el foco entra en el primero: quien navega con
    // teclado o lector de pantalla no tiene que tabular desde el panel ni pasar
    // por la cruz de cerrar. Sin campos, el panel (que anuncia el título).
    //
    // ⚠ No basta con `querySelector`: el primer campo puede estar dentro de un
    // `<details>` cerrado (el explicador del cifrado del intercambio) y `focus()`
    // sobre algo que no se pinta no hace nada, dejando el foco en `<body>`. Por
    // eso, al final se comprueba dónde ha caído y, si no entró, se enfoca el panel.
    const firstField = panel?.querySelector<HTMLElement>(
      "input:not([type='hidden']):not([disabled]):not([tabindex='-1']), textarea:not([disabled]), select:not([disabled])",
    );
    (firstField ?? panel)?.focus();
    if (panel && !panel.contains(document.activeElement)) panel.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Con un autocompletado abierto (ciudad, sugerencias) Escape cierra la
        // lista, no el diálogo: si no, se pierde lo que se llevaba escrito.
        const target = event.target as HTMLElement | null;
        if (target?.closest('[role="combobox"][aria-expanded="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !panel) return;

      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (node) => node.offsetWidth > 0 || node.offsetHeight > 0 || node === document.activeElement,
      );

      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      openDialogs -= 1;
      if (openDialogs <= 0) {
        openDialogs = 0;
        releaseBackground();
      }
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      // En un fotograma, no en el cuerpo del efecto: React desaconseja (y el
      // lint marca) cambiar estado de forma síncrona aquí.
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    if (!visible) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setVisible(false), reduce ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, visible]);

  // Se pinta en cuanto `open` es verdadero (sin esperar al efecto, o el primer
  // render no tendría panel donde poner el foco) y se queda mientras dura el
  // cierre.
  if (!mounted) return null;
  if (!open && !visible) return null;

  return createPortal(
    <div
      className={closing ? "modal-backdrop is-closing" : "modal-backdrop"}
      data-dialog-root
      onMouseDown={(event) => {
        if (!closing && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={["dialog", wide ? "add-dialog" : "", className ?? ""]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <button
          type="button"
          className="dialog-close"
          aria-label={t("Cerrar")}
          onClick={onClose}
          disabled={closing}
        >
          <X size={19} />
        </button>
        {icon && <span className="dialog-icon">{icon}</span>}
        <h2 id={titleId}>{title}</h2>
        {description && (
          <p id={descriptionId} className="dialog-description">
            {description}
          </p>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
