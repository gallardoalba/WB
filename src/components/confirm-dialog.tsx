"use client";

import { Dialog } from "./dialog";
import { useI18n } from "./i18n-provider";
import type { ReactNode } from "react";

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  /** Campos adicionales de la confirmación (motivo, duración…). */
  children?: ReactNode;
  /** Deshabilita confirmar mientras los campos obligatorios no estén listos. */
  confirmDisabled?: boolean;
};

/** Confirmación accesible para acciones destructivas (sustituye a window.confirm). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending = false,
  children,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      overline={t("CONFIRMAR ACCIÓN")}
    >
      {children}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>
          {cancelLabel ?? t("Cancelar")}
        </button>
        <button
          type="button"
          className="primary-button danger"
          onClick={onConfirm}
          disabled={pending || confirmDisabled}
        >
          {pending ? t("Un momento…") : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
