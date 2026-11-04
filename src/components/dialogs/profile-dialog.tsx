"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, LogOut, User } from "lucide-react";
import { Dialog } from "../dialog";
import { api } from "@/lib/client-api";
import { CityField } from "../city-field";
import type { RequestView, SessionUser } from "@/lib/domain";
import { useI18n } from "../i18n-provider";
import type { BaseDialogProps } from "./shared";

export function ProfileDialog({
  open,
  onClose,
  user,
  requests,
  publishedCount,
  alertsOn = false,
  onToggleAlert,
  onLoggedOut,
}: BaseDialogProps & {
  user: SessionUser | null;
  requests: RequestView[];
  publishedCount: number;
  alertsOn?: boolean;
  onToggleAlert?: () => void;
  onLoggedOut: () => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [accountMsg, setAccountMsg] = useState("");
  const [accountError, setAccountError] = useState("");
  const [busyAccount, setBusyAccount] = useState(false);

  const router = useRouter();
  const [verifyMsg, setVerifyMsg] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);

  const [totp, setTotp] = useState<{ enabled: boolean; pending: boolean } | null>(null);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpQr, setTotpQr] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpPassword, setTotpPassword] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpMsg, setTotpMsg] = useState("");
  const [totpError, setTotpError] = useState("");

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    api<{ enabled: boolean; pending: boolean }>("/api/account/totp")
      .then((state) => {
        if (!cancelled) setTotp(state);
      })
      .catch((caught: unknown) => {
        // Antes se quedaba en «Cargando…» para siempre sin decir nada.
        if (!cancelled) {
          setTotpError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar la verificación en dos pasos.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  if (!user) return null;

  const published = publishedCount;
  const completed = requests.filter((request) => request.status === "completed").length;
  const active = requests.filter((request) =>
    ["pending", "accepted"].includes(request.status),
  ).length;

  async function logout() {
    setPending(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
      onLoggedOut();
      onClose();
    } finally {
      setPending(false);
    }
  }

  async function resendVerification() {
    setVerifyBusy(true);
    setVerifyMsg("");
    try {
      await api("/api/account/verify-email", { method: "POST" });
      setVerifyMsg(t("Enlace enviado. Revisa tu correo."));
    } catch (caught) {
      setVerifyMsg(caught instanceof Error ? caught.message : t("No se pudo enviar el enlace."));
    } finally {
      setVerifyBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusyAccount(true);
    setAccountError("");
    setAccountMsg("");
    try {
      await api("/api/account/profile", {
        method: "PATCH",
        body: {
          name: data.get("name"),
          city: data.get("city"),
          bio: data.get("bio") ?? "",
          emailNotifications: data.get("emailNotifications") === "on",
        },
      });
      setAccountMsg(t("Perfil actualizado."));
      router.refresh();
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : t("No se pudo guardar el perfil."));
    } finally {
      setBusyAccount(false);
    }
  }

  async function startTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError("");
    setTotpMsg("");
    try {
      const data = await api<{ secret: string; otpauthUrl: string; qrDataUrl: string }>(
        "/api/account/totp/setup",
        {
          method: "POST",
          body: { password: totpPassword },
        },
      );
      setTotpSecret(data.secret);
      setTotpUri(data.otpauthUrl);
      setTotpQr(data.qrDataUrl);
      setTotpPassword("");
      setTotp({ enabled: false, pending: true });
    } catch (caught) {
      setTotpError(caught instanceof Error ? caught.message : t("No se pudo generar el secreto."));
    } finally {
      setTotpBusy(false);
    }
  }

  async function enableTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError("");
    setTotpMsg("");
    try {
      const state = await api<{ enabled: boolean; pending: boolean }>("/api/account/totp/enable", {
        method: "POST",
        body: { code: totpCode },
      });
      setTotp(state);
      setTotpSecret("");
      setTotpUri("");
      setTotpQr("");
      setTotpCode("");
      setTotpMsg(t("Verificación en dos pasos activada."));
    } catch (caught) {
      setTotpError(caught instanceof Error ? caught.message : t("No se pudo activar la verificación."));
    } finally {
      setTotpBusy(false);
    }
  }

  async function disableTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError("");
    setTotpMsg("");
    try {
      await api("/api/account/totp/disable", {
        method: "POST",
        body: { password: totpPassword, code: totpCode },
      });
      setTotp({ enabled: false, pending: false });
      setTotpPassword("");
      setTotpCode("");
      setTotpMsg(t("Verificación en dos pasos desactivada."));
    } catch (caught) {
      setTotpError(caught instanceof Error ? caught.message : t("No se pudo desactivar la verificación."));
    } finally {
      setTotpBusy(false);
    }
  }

  async function changeOwnPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAccount(true);
    setAccountError("");
    setAccountMsg("");
    try {
      await api("/api/account/password", {
        method: "PATCH",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setAccountMsg(t("Contraseña actualizada. Se cerraron las demás sesiones."));
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : t("No se pudo cambiar la contraseña."));
    } finally {
      setBusyAccount(false);
    }
  }

  async function removeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAccount(true);
    setAccountError("");
    try {
      await api("/api/account/delete", { method: "POST", body: { password: deletePassword } });
      onLoggedOut();
      onClose();
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : t("No se pudo eliminar la cuenta."));
      setBusyAccount(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user.name}
      description={user.bio || t("Sin biografía todavía.")}
      overline={t("TU PERFIL")}
      icon={<User size={20} />}
    >
      <dl className="profile-facts">
        <div>
          <dt>{t("Correo")}</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>{t("Ciudad")}</dt>
          <dd>{user.city}</dd>
        </div>
      </dl>

      <div className="profile-stats">
        <div>
          <strong>{published}</strong>
          <span>{t("publicados")}</span>
        </div>
        <div>
          <strong>{active}</strong>
          <span>{t("en curso")}</span>
        </div>
        <div>
          <strong>{completed}</strong>
          <span>{t("completados")}</span>
        </div>
      </div>

      {!user.emailVerified && (
        <div className="account-box verify-banner">
          <strong>{t("Confirma tu correo")}</strong>
          <p>
            {t("Te enviamos un enlace a")} <b>{user.email}</b>. {t("Sin confirmarlo no podrás recuperar la cuenta si olvidas la contraseña.")}
          </p>
          {verifyMsg && (
            <p className="action-feedback" role="status">
              {verifyMsg}
            </p>
          )}
          <button
            type="button"
            className="secondary-button small"
            onClick={resendVerification}
            disabled={verifyBusy}
          >
            {verifyBusy ? t("Enviando…") : t("Reenviar enlace")}
          </button>
        </div>
      )}

      <div className="account-box">
        <details>
          <summary>{t("Editar perfil")}</summary>
          <form onSubmit={saveProfile}>
            <label htmlFor="profile-name">{t("Nombre visible")}</label>
            <input
              id="profile-name" aria-describedby={accountError ? "account-error" : undefined}
              name="name"
              key={user.name}
              defaultValue={user.name}
              autoComplete="name"
              minLength={2}
              maxLength={60}
              required
            />
            <label htmlFor="profile-city">{t("Ciudad")}</label>
            <CityField
              id="profile-city"
              name="city"
              key={user.city}
              defaultValue={user.city}
              required
              ariaDescribedBy={accountError ? "account-error" : undefined}
            />
            <label htmlFor="profile-bio">{t("Biografía (opcional)")}</label>
            <textarea
              id="profile-bio" aria-describedby={accountError ? "account-error" : undefined}
              name="bio"
              key={user.bio}
              defaultValue={user.bio}
              rows={3}
              maxLength={300}
            />
            <label className="checkbox-row" htmlFor="profile-email-notifications">
              <input
                id="profile-email-notifications"
                name="emailNotifications"
                type="checkbox"
                defaultChecked={user.emailNotifications}
              />
              {t("Recibir un correo cuando haya novedades importantes")}
            </label>
            {onToggleAlert && (
              <label className="checkbox-row" htmlFor="profile-city-alerts">
                <input
                  id="profile-city-alerts"
                  type="checkbox"
                  checked={alertsOn}
                  onChange={onToggleAlert}
                />
                {t("Avisarme de nuevos libros en {city}", { city: user.city })}
              </label>
            )}
            <button className="secondary-button small" type="submit" disabled={busyAccount}>
              {t("Guardar perfil")}
            </button>
          </form>
        </details>

        <details>
          <summary>{t("Cambiar contraseña")}</summary>
          <form onSubmit={changeOwnPassword}>
            <label htmlFor="current-password">{t("Contraseña actual")}</label>
            <input
              id="current-password" aria-describedby={accountError ? "account-error" : undefined}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
            <label htmlFor="new-password">{t("Nueva contraseña")}</label>
            <input
              id="new-password" aria-describedby={accountError ? "account-error" : undefined}
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
            <button className="secondary-button small" type="submit" disabled={busyAccount}>
              {t("Guardar contraseña")}
            </button>
          </form>
        </details>

        <details>
          <summary>{t("Verificación en dos pasos")}</summary>
          {totpError && (
            <p className="form-error" role="alert">
              {totpError}
            </p>
          )}
          {totpMsg && (
            <p className="action-feedback" role="status">
              {totpMsg}
            </p>
          )}
          {totp === null ? (
            <p className="form-hint">
              {totpError ? t("No se pudo cargar el estado.") : t("Cargando…")}
            </p>
          ) : totp.enabled ? (
            <form onSubmit={disableTotp}>
              <p className="form-hint">
                {t("La cuenta pide un código de tu aplicación de autenticación al entrar.")}
              </p>
              <label htmlFor="totp-disable-password">{t("Contraseña actual")}</label>
              <input
                id="totp-disable-password"
                type="password"
                autoComplete="current-password"
                value={totpPassword}
                onChange={(event) => setTotpPassword(event.target.value)}
                required
              />
              <label htmlFor="totp-disable-code">{t("Código actual")}</label>
              <input
                id="totp-disable-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                required
              />
              <button className="secondary-button small" type="submit" disabled={totpBusy}>
                {t("Desactivar")}
              </button>
            </form>
          ) : totpSecret ? (
            <form onSubmit={enableTotp}>
              <p className="form-hint">
                {t("Escanea este código con tu aplicación de autenticación o añade la clave a mano:")}
              </p>
              {totpQr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="totp-qr" src={totpQr} alt={t("Código QR para configurar la verificación en dos pasos")} />
              )}
              <p>
                <code className="secret-code">{totpSecret}</code>
              </p>
              <a className="text-link" href={totpUri}>
                {t("Abrir en la aplicación de autenticación")}
              </a>
              <label htmlFor="totp-enable-code">{t("Código de 6 dígitos")}</label>
              <input
                id="totp-enable-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                required
              />
              <button className="secondary-button small" type="submit" disabled={totpBusy}>
                {t("Activar")}
              </button>
            </form>
          ) : (
            <form onSubmit={startTotp}>
              <p className="form-hint">
                {t("Protege la cuenta con un código temporal además de la contraseña. Se pedirá también al entrar.")}
              </p>
              <label htmlFor="totp-setup-password">{t("Contraseña actual")}</label>
              <input
                id="totp-setup-password"
                type="password"
                autoComplete="current-password"
                value={totpPassword}
                onChange={(event) => setTotpPassword(event.target.value)}
                required
              />
              <button className="secondary-button small" type="submit" disabled={totpBusy}>
                {t("Generar secreto")}
              </button>
            </form>
          )}
        </details>

        <a className="secondary-button small" href="/api/account/export" download>
          <Download size={14} /> {t("Descargar mis datos")}
        </a>

        <details className="danger-zone">
          <summary>{t("Eliminar cuenta")}</summary>
          <form onSubmit={removeAccount}>
            <p>{t("Se retirarán tus publicaciones y se cerrará la sesión.")}</p>
            <label htmlFor="delete-password">{t("Confirma con tu contraseña")}</label>
            <input
              id="delete-password" aria-describedby={accountError ? "account-error" : undefined}
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              required
            />
            <button className="secondary-button small danger" type="submit" disabled={busyAccount}>
              {t("Eliminar mi cuenta")}
            </button>
          </form>
        </details>
      </div>

      {accountMsg && (
        <p className="action-feedback" role="status">
          {accountMsg}
        </p>
      )}
      {accountError && (
        <p className="form-error" id="account-error" role="alert">
          {accountError}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={logout} disabled={pending}>
          <LogOut size={15} /> {pending ? t("Saliendo…") : t("Cerrar sesión")}
        </button>
        <button type="button" className="share-button" onClick={onClose}>
          <Check size={15} /> {t("Volver")}
        </button>
      </div>
    </Dialog>
  );
}

