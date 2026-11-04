"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Dialog } from "../dialog";
import { api, ClientApiError } from "@/lib/client-api";
import { CityField } from "../city-field";
import { useI18n } from "../i18n-provider";
import type { BaseDialogProps } from "./shared";

export function AuthDialog({
  open,
  onClose,
  onSuccess,
  initialMode = "login",
}: BaseDialogProps & {
  onSuccess: () => void;
  initialMode?: "login" | "register";
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "totp">(initialMode);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  // Credenciales ya verificadas a la espera del segundo factor.
  const [pendingLogin, setPendingLogin] = useState<{ email: string; password: string } | null>(null);
  const startedAt = useRef(0);

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // Sello de tiempo del formulario (anti-bot) y widget opcional de Turnstile.
  useEffect(() => {
    if (!open || mode !== "register") return;
    startedAt.current = Date.now();
    if (!turnstileSiteKey) return;

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [open, mode, turnstileSiteKey]);

  function close() {
    setError("");
    setPending(false);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setMessage("");

    if (mode === "forgot") {
      try {
        const data = await api<{ message: string }>("/api/auth/forgot", {
          method: "POST",
          body: { email: form.get("email") },
        });
        setMessage(data.message);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("No se pudo enviar el enlace."));
      } finally {
        setPending(false);
      }
      return;
    }

    if (mode === "totp") {
      if (!pendingLogin) {
        setMode("login");
        setPending(false);
        return;
      }
      try {
        await api("/api/auth/login", {
          method: "POST",
          body: {
            email: pendingLogin.email,
            password: pendingLogin.password,
            code: String(form.get("code") ?? ""),
          },
        });
        setPendingLogin(null);
        onSuccess();
        close();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("No se pudo completar el acceso."));
      } finally {
        setPending(false);
      }
      return;
    }

    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: {
          email,
          password,
          ...(mode === "register"
            ? {
                name: form.get("name"),
                city: form.get("city"),
                website: form.get("website") ?? "",
                startedAt: startedAt.current,
                turnstileToken: form.get("cf-turnstile-response") ?? undefined,
              }
            : {}),
        },
      });
      onSuccess();
      close();
    } catch (caught) {
      // La cuenta tiene 2FA: se pide el código sin perder las credenciales.
      if (
        mode === "login" &&
        caught instanceof ClientApiError &&
        caught.body &&
        typeof caught.body === "object" &&
        (caught.body as { twoFactorRequired?: unknown }).twoFactorRequired
      ) {
        setPendingLogin({ email, password });
        setMode("totp");
        setError("");
        return;
      }
      setError(caught instanceof Error ? caught.message : t("No se pudo completar el acceso."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={
        mode === "login"
          ? t("Entra en Wanderbibliothek")
          : mode === "register"
            ? t("Crea tu cuenta")
            : mode === "totp"
              ? t("Verificación en dos pasos")
              : t("Recupera tu contraseña")
      }
      description={
        mode === "login"
          ? t("Accede para guardar favoritos, solicitar libros y conversar con quien los comparte.")
          : mode === "register"
            ? t("Solo necesitamos tu nombre, un correo y tu ciudad para poner en marcha los intercambios.")
            : mode === "totp"
              ? t("Abre tu aplicación de autenticación y escribe el código de 6 dígitos.")
              : t("Escribe tu correo y te enviaremos un enlace para elegir una contraseña nueva.")
      }
      overline={t("TU COMUNIDAD DE LECTURA")}
      icon={<ShieldCheck size={20} />}
    >
      {mode !== "forgot" && mode !== "totp" && (
      <div className="auth-tabs" role="tablist" aria-label={t("Acceso o registro")}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          className={mode === "login" ? "auth-tab selected" : "auth-tab"}
          onClick={() => {
            setMode("login");
            setError("");
          }}
        >
          {t("Iniciar sesión")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          className={mode === "register" ? "auth-tab selected" : "auth-tab"}
          onClick={() => {
            setMode("register");
            setError("");
          }}
        >
          {t("Crear cuenta")}
        </button>
      </div>
      )}

      <form className="listing-form" onSubmit={submit}>
        {mode === "register" && (
          <>
            <label>
              {t("Nombre")}
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={60}
                placeholder={t("Cómo te llamas")}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "auth-error" : undefined}
              />
            </label>
            <div className="hp-field" aria-hidden="true">
              <label>
                {t("No rellenar")}
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <label>
              {t("Ciudad")}
              <CityField
                name="city"
                required
                ariaInvalid={Boolean(error)}
                ariaDescribedBy={error ? "auth-error" : undefined}
              />
            </label>
          </>
        )}
        {mode === "totp" ? (
          <label>
            {t("Código de verificación")}
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              placeholder="123456"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "auth-error" : undefined}
            />
          </label>
        ) : (
          <>
            <label>
              {t("Correo")}
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="tu@correo.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "auth-error" : undefined}
              />
            </label>
            {mode !== "forgot" && (
              <label>
                {t("Contraseña")}
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  minLength={mode === "register" ? 10 : undefined}
                  placeholder={mode === "register" ? t("Mínimo 10 caracteres") : t("Tu contraseña")}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "auth-error" : undefined}
                />
              </label>
            )}
          </>
        )}

        {mode === "register" && turnstileSiteKey && (
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="auto" />
        )}

        {error && (
          <p className="form-error" id="auth-error" role="alert">
            {error}
          </p>
        )}

        {message && (
          <p className="action-feedback" role="status">
            {message}
          </p>
        )}

        <button className="share-button form-submit" type="submit" disabled={pending}>
          {pending
            ? t("Un momento…")
            : mode === "login"
              ? t("Entrar")
              : mode === "register"
                ? t("Crear cuenta")
                : mode === "totp"
                  ? t("Verificar")
                  : t("Enviar enlace")}
          {!pending && <ArrowRight size={16} />}
        </button>
      </form>

      {mode === "login" && (
        <button
          type="button"
          className="text-link auth-forgot"
          onClick={() => {
            setMode("forgot");
            setError("");
            setMessage("");
          }}
        >
          {t("¿Has olvidado tu contraseña?")}
        </button>
      )}
      {(mode === "forgot" || mode === "totp") && (
        <button
          type="button"
          className="text-link auth-forgot"
          onClick={() => {
            setMode("login");
            setPendingLogin(null);
            setError("");
            setMessage("");
          }}
        >
          {t("Volver al acceso")}
        </button>
      )}

      {process.env.NODE_ENV !== "production" && (
        <p className="form-hint">
          {t("Demo: ana@book2peer.test con la contraseña demo1234.")}
        </p>
      )}
    </Dialog>
  );
}

