"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { DirectMessageDialog } from "./direct-message-dialog";
import { SectionBoundary } from "./section-boundary";
import { useI18n } from "./i18n-provider";

/**
 * Abre la conversación privada con otra persona. Solo se ofrece entre
 * seguidores mutuos; el diálogo explica el motivo si no se puede escribir.
 */
export function DirectMessageButton({
  peerId,
  peerName,
  autoOpen = false,
  unread = 0,
}: {
  peerId: string;
  peerName: string;
  autoOpen?: boolean;
  unread?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(autoOpen);

  return (
    <>
      <button type="button" className="secondary-button small" onClick={() => setOpen(true)}>
        <MessageCircle size={14} />
        {t("Mensaje")}
        {unread > 0 && (
          <span className="dm-badge" aria-label={t("{n} sin leer", { n: unread })}>
            {unread}
          </span>
        )}
      </button>
      {/* Siempre montado: el diálogo se cierra con su propio fundido de salida
          y el hilo se pide solo cuando `open` es verdadero. */}
      <SectionBoundary>
        <DirectMessageDialog
          open={open}
          onClose={() => setOpen(false)}
          peerId={peerId}
          peerName={peerName}
        />
      </SectionBoundary>
    </>
  );
}
