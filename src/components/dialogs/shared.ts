export type BaseDialogProps = {
  open: boolean;
  onClose: () => void;
};

/** Etiquetas de las acciones de la conversación de un intercambio. */
export const ACTION_LABELS: Record<string, string> = {
  accepted: "Aceptar",
  declined: "Rechazar",
  cancelled: "Cancelar",
  completed: "Marcar completado",
};
