"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
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
  children: ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  wide = false,
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
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openDialogs += 1;
    inertBackground();
    panel?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
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

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      data-dialog-root
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={wide ? "dialog add-dialog" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <button type="button" className="dialog-close" aria-label={t("Cerrar")} onClick={onClose}>
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
