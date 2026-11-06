"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Send } from "lucide-react";
import { Dialog } from "../dialog";
import { api } from "@/lib/client-api";
import { useI18n } from "../i18n-provider";
import type { BaseDialogProps } from "./shared";

/** Lo mínimo para pedir un ejemplar desde su ficha. */
export type RequestTarget = {
  id: string;
  title: string;
  ownerName: string;
};

export function RequestDialog({
  open,
  onClose,
  listing,
  onCreated,
}: BaseDialogProps & { listing: RequestTarget | null; onCreated: () => void }) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function close() {
    setError("");
    setPending(false);
    onClose();
  }

  if (!listing) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!listing) return;
    setPending(true);
    setError("");
    try {
      await api("/api/requests", {
        method: "POST",
        body: { listingId: listing.id },
      });
      onCreated();
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar la solicitud."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("¿Te gustaría leerlo?")}
      description={t(
        "Enviarás una solicitud a {name} por “{title}”. Cuando la acepte, podréis acordar la entrega en la conversación cifrada.",
        { name: listing.ownerName, title: listing.title },
      )}
      overline={t("UNA HISTORIA CAMBIA DE MANOS")}
      icon={<Send size={20} />}
    >
      <form className="listing-form" onSubmit={submit}>
        <p className="form-note">
          {t("La solicitud se envía sin texto. Así nadie puede leerla antes de que la acepten.")}
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={close}>
            {t("Ahora no")}
          </button>
          <button className="share-button" type="submit" disabled={pending}>
            {pending ? t("Enviando…") : t("Enviar solicitud")}
            {!pending && <ArrowRight size={16} />}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

