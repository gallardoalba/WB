"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, MailCheck } from "lucide-react";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

export function VerifyEmail({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function confirm() {
    setState("sending");
    setError("");
    try {
      await api("/api/auth/verify", { method: "POST", body: { token } });
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo confirmar el correo."));
      setState("idle");
    }
  }

  if (!token) {
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <MailCheck size={22} />
        </span>
        <h2>{t("Falta el enlace")}</h2>
        <p>{t("Abre el enlace completo que te hemos enviado por correo.")}</p>
        <Link className="secondary-button small" href="/">
          {t("Volver al catálogo")}
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <span className="dialog-icon">
        <MailCheck size={20} />
      </span>
      <h1>{t("Confirma tu correo")}</h1>
      {state === "done" ? (
        <>
          <p className="action-feedback" role="status">
            {t("Correo confirmado. Ya puedes usar tu cuenta con normalidad.")}
          </p>
          <Link className="share-button" href="/">
            <Check size={15} /> {t("Ir al catálogo")}
          </Link>
        </>
      ) : (
        <>
          <p>{t("Pulsa el botón para confirmar que este correo es tuyo.")}</p>
          <button
            type="button"
            className="share-button"
            onClick={confirm}
            disabled={state === "sending"}
          >
            {state === "sending" ? t("Confirmando…") : t("Confirmar mi correo")}
          </button>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
