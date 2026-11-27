"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, MailCheck } from "lucide-react";
import { api } from "@/lib/client-api";
import { useUrlToken } from "@/lib/use-url-token";
import { useI18n } from "./i18n-provider";

export function VerifyEmail({ token: initialToken }: { token: string }) {
  const { token, ready } = useUrlToken(initialToken);
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  // El mismo enlace sirve para confirmar la cuenta y para confirmar un correo
  // nuevo: la respuesta dice cuál de las dos cosas se ha hecho.
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState("");

  async function confirm() {
    setState("sending");
    setError("");
    try {
      const result = await api<{ emailChanged?: boolean; email?: string }>(
        "/api/auth/verify",
        { method: "POST", body: { token } },
      );
      if (result.emailChanged && result.email) setNewEmail(result.email);
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo confirmar el correo."));
      setState("idle");
    }
  }

  if (!ready) {
    return (
      <div className="auth-page">
        <p className="form-hint">{t("Cargando…")}</p>
      </div>
    );
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
      <h1>{newEmail ? t("Correo actualizado") : t("Confirma tu correo")}</h1>
      {state === "done" ? (
        <>
          <p className="action-feedback" role="status">
            {newEmail
              ? t("Tu cuenta usa ahora {email}. A partir de ahora entra con esa dirección.", {
                  email: newEmail,
                })
              : t("Correo confirmado. Ya puedes usar tu cuenta con normalidad.")}
          </p>
          <Link className="primary-button" href="/">
            <Check size={15} /> {t("Ir al catálogo")}
          </Link>
        </>
      ) : (
        <>
          <p>{t("Pulsa el botón para confirmar que este correo es tuyo.")}</p>
          <button
            type="button"
            className="primary-button"
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
