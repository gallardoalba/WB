"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

/** Aviso proactivo: publicar, comentar o pedir exige el correo confirmado. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function resend() {
    setState("sending");
    setError("");
    try {
      await api("/api/account/verify-email", { method: "POST" });
      setState("sent");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar el enlace."));
      setState("idle");
    }
  }

  return (
    <div className="verify-banner" role="status">
      <MailWarning size={17} aria-hidden="true" />
      <p>
        <strong>{t("Confirma tu correo para publicar y pedir libros.")}</strong>{" "}
        {t("Te enviamos un enlace a {email}.", { email })}
        {state === "sent" && ` ${t("Enlace enviado. Revisa tu correo.")}`}
        {error && <span className="form-error"> {error}</span>}
      </p>
      <button
        type="button"
        className="secondary-button small"
        onClick={resend}
        disabled={state === "sending" || state === "sent"}
      >
        {state === "sent" ? t("Enviado") : state === "sending" ? t("Enviando…") : t("Reenviar enlace")}
      </button>
    </div>
  );
}
