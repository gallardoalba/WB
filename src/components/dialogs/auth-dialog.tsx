"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Dialog } from "../dialog";
import { api, ClientApiError } from "@/lib/client-api";
import { CityField } from "../city-field";
import { useI18n } from "../i18n-provider";
import type { SessionUser } from "@/lib/domain";
import type { BaseDialogProps } from "./shared";

export function AuthDialog({
  open,
  onClose,
  onSuccess,
  initialMode = "login",
}: BaseDialogProps & {
  /** Recibe la cuenta ya autenticada: el armazón la pinta sin esperar al refresco. */
  onSuccess: (user: SessionUser) => void;
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
        const data = await api<{ user: SessionUser }>("/api/auth/login", {
          method: "POST",
          body: {
            email: pendingLogin.email,
            password: pendingLogin.password,
            code: String(form.get("code") ?? ""),
          },
        });
        setPendingLogin(null);
        onSuccess(data.user);
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
      const data = await api<{ user: SessionUser }>(
        mode === "login" ? "/api/auth/login" : "/api/auth/register",
        {
          method: "POST",
          body: {
            email,
            password,
            ...(mode === "register"
              ? {
                  name: form.get("name"),
                  city: form.get("city"),
                  // El consentimiento viaja como booleano, no como el "on" del
                  // formulario: el servidor exige que sea explícito.
                  ageConfirmed: form.get("ageConfirmed") === "on",
                  website: form.get("website") ?? "",
                  startedAt: startedAt.current,
                  turnstileToken: form.get("cf-turnstile-response") ?? undefined,
                }
              : {}),
          },
        },
      );
      onSuccess(data.user);
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
      <div className="auth-tabs" role="group" aria-label={t("Acceso o registro")}>
        <button
          type="button"
          aria-pressed={mode === "login"}
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
          aria-pressed={mode === "register"}
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
              {t("Nombre público")}
              <input
                name="name"
                autoComplete="nickname"
                required
                maxLength={60}
                placeholder={t("Cómo te llamas")}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "auth-error" : undefined}
              />
            </label>
            <p className="form-note">
              {t("Es el nombre que verán las demás personas. Puedes usar un seudónimo.")}
            </p>
            <div className="hp-field" aria-hidden="true">
              <label>
                {t("No rellenar")}
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <div className="field">
              <label htmlFor="auth-city">{t("Ciudad")}</label>
              <CityField
                id="auth-city"
                name="city"
                required
                ariaInvalid={Boolean(error)}
                ariaDescribedBy={error ? "auth-error" : undefined}
              />
            </div>
            <div className="consent-field">
              <input id="age-confirmed" type="checkbox" name="ageConfirmed" required />
              <label htmlFor="age-confirmed">
                {t("Confirmo que tengo al menos 16 años.")}{" "}
                <Link href="/privacidad" target="_blank" rel="noreferrer">
                  {t("Política de privacidad")}
                </Link>
              </label>
            </div>
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
                ? t("Crear mi cuenta")
                : mode === "totp"
                  ? t("Verificar")
                  : t("Enviar enlace")}
          {!pending && <ArrowRight size={16} />}
        </button>

        {mode === "register" && (
          <p className="form-hint auth-hint">
            {t(
              "Te enviaremos un correo para confirmar la cuenta. Si no llega en unos minutos, mira en la carpeta de spam.",
            )}
          </p>
        )}
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
          {t("Demo: ana@wanderbibliothek.test con la contraseña demo1234.")}
        </p>
      )}
    </Dialog>
  );
}

