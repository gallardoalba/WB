"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { KeyRound, Check } from "lucide-react";
import { api } from "@/lib/client-api";
import { useUrlToken } from "@/lib/use-url-token";
import { useI18n } from "./i18n-provider";

export function ResetPassword({ token: initialToken }: { token: string }) {
  const { token, ready } = useUrlToken(initialToken);
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("sending");
    setError("");
    try {
      await api("/api/auth/reset", {
        method: "POST",
        body: { token, password: form.get("password") },
      });
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo cambiar la contraseña."));
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
          <KeyRound size={22} />
        </span>
        <h2>{t("Falta el enlace")}</h2>
        <p>{t("Abre el enlace completo que te hemos enviado por correo.")}</p>
        <Link className="secondary-button small" href="/">
          {t("Volver al catálogo")}
        </Link>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="auth-page">
        <span className="dialog-icon">
          <Check size={20} />
        </span>
        <h1>{t("Contraseña actualizada")}</h1>
        <p className="action-feedback" role="status">
          {t("Ya puedes entrar con tu contraseña nueva. Hemos cerrado las demás sesiones.")}
        </p>
        <Link className="share-button" href="/?auth=1">
          {t("Entrar")}
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-page listing-form" onSubmit={submit}>
      <span className="dialog-icon">
        <KeyRound size={20} />
      </span>
      <h1>{t("Elige una contraseña nueva")}</h1>
      <label htmlFor="reset-password">{t("Nueva contraseña")}</label>
      <input
        id="reset-password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={200}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "reset-error" : undefined}
      />
      <p className="form-hint">{t("Al menos 10 caracteres y que no sea una contraseña habitual.")}</p>
      {error && (
        <p className="form-error" id="reset-error" role="alert">
          {error}
        </p>
      )}
      <button className="share-button" type="submit" disabled={state === "sending"}>
        {state === "sending" ? t("Guardando…") : t("Guardar contraseña")}
      </button>
    </form>
  );
}
