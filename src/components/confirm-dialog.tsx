"use client";

import { Dialog } from "./dialog";
import { useI18n } from "./i18n-provider";

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
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
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>
          {cancelLabel ?? t("Cancelar")}
        </button>
        <button
          type="button"
          className="share-button danger"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? t("Un momento…") : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
