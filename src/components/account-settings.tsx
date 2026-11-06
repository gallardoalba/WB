"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, Lock, LogOut, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client-api";
import { ensureIdentity } from "@/lib/e2e";
import type { RequestView, SessionUser } from "@/lib/domain";
import { formatWhen } from "@/lib/text";
import { CityField } from "./city-field";
import { useI18n } from "./i18n-provider";

type KeyHistory = {
  keyId: string;
  platform: string;
  reason: string;
  createdAt: string;
  replacedAt: string | null;
};
type StoredKeys = {
  keys: { platform: string; keyId: string }[];
  keyId: string | null;
  history: KeyHistory[];
};

/**
 * Ajustes de la cuenta. Vive en su propia página (`/cuenta`) en vez de en un
 * diálogo: son formularios largos, con contraseñas y verificación en dos
 * pasos, y así se pueden enlazar, recargar y leer con calma.
 */
export function AccountSettings({
  user,
  requests,
  publishedCount,
  alertsOn,
}: {
  user: SessionUser;
  requests: RequestView[];
  publishedCount: number;
  alertsOn: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [accountMsg, setAccountMsg] = useState("");
  const [accountError, setAccountError] = useState("");
  const [busyAccount, setBusyAccount] = useState(false);

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

  const [keys, setKeys] = useState<StoredKeys | null>(null);
  const [localKeyId, setLocalKeyId] = useState<string | null>(null);
  const [keyPassword, setKeyPassword] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState("");
  const [keyError, setKeyError] = useState("");

  const [alertOn, setAlertOn] = useState(alertsOn);
  const [alertBusy, setAlertBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [stored, identity] = await Promise.all([
          api<StoredKeys>("/api/account/keys"),
          ensureIdentity(),
        ]);
        if (cancelled) return;
        setLocalKeyId(identity.keyId);
        // Este bloque es la ranura web: la app móvil tiene la suya y no se
        // toca desde aquí.
        const web = stored.keys?.find((key) => key.platform === "web") ?? null;
        if (web) {
          setKeys(stored);
          return;
        }
        // Primera clave del navegador: se publica sola, igual que hace el shell
        // al entrar. Antes había que pulsar un botón y la sección parecía
        // pedir permiso para algo que ya estaba resuelto.
        try {
          const saved = await api<StoredKeys>("/api/account/keys", {
            method: "PUT",
            body: { ...identity.publicJwk, platform: "web" },
          });
          if (cancelled) return;
          setKeys(saved);
        } catch {
          // Si falla, se queda el botón manual con su explicación.
          if (!cancelled) setKeys(stored);
        }
      } catch {
        if (!cancelled) setKeyError(t("No se pudo cargar el estado del cifrado."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    api<{ enabled: boolean; pending: boolean }>("/api/account/totp")
      .then((state) => {
        if (!cancelled) setTotp(state);
      })
      .catch((caught: unknown) => {
        // Sin este aviso la sección se quedaba en «Cargando…» para siempre.
        if (!cancelled) {
          setTotpError(
            caught instanceof Error
              ? caught.message
              : t("No se pudo cargar la verificación en dos pasos."),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  // «Activo» significa que la clave de la cuenta es la de este navegador: si
  // hay otra publicada, este dispositivo no puede leer los mensajes nuevos.
  const keyActive = Boolean(keys?.keyId) && keys?.keyId === localKeyId;
  /** La cuenta ya cifra en algún dispositivo (aunque no sea este navegador). */
  const hasAnySlot = (keys?.keys?.length ?? 0) > 0;

  const completed = requests.filter((request) => request.status === "completed").length;
  const active = requests.filter((request) => ["pending", "accepted"].includes(request.status)).length;

  async function logout() {
    setPending(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
      router.replace("/");
      router.refresh();
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

  /** Publica o sustituye la clave de este navegador; rotar exige la contraseña. */
  async function activateKey() {
    setKeyBusy(true);
    setKeyMsg("");
    setKeyError("");
    try {
      const identity = await ensureIdentity();
      const body: Record<string, unknown> = { ...identity.publicJwk, platform: "web" };
      // Añadir la ranura a una cuenta que ya cifra pide la contraseña igual que
      // rotarla: si no, una sesión abierta bastaría para instalar otra clave.
      if ((keys?.keys?.length ?? 0) > 0) body.password = keyPassword;
      const saved = await api<StoredKeys>("/api/account/keys", {
        method: "PUT",
        body,
      });
      setKeys(saved);
      setLocalKeyId(identity.keyId);
      setKeyPassword("");
      setKeyMsg(t("Cifrado activado en este navegador."));
      router.refresh();
    } catch (caught) {
      setKeyError(
        caught instanceof Error ? caught.message : t("No se pudo activar el cifrado."),
      );
    } finally {
      setKeyBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
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

  async function toggleAlert() {
    const next = !alertOn;
    setAlertBusy(true);
    try {
      await api("/api/alerts/availability", {
        method: "POST",
        body: { city: user.city, enabled: next },
      });
      setAlertOn(next);
      setAccountMsg(
        next
          ? t("Te avisaremos de los libros nuevos en {city}.", { city: user.city })
          : t("Ya no te avisaremos de libros nuevos en {city}.", { city: user.city }),
      );
    } catch (caught) {
      setAccountError(
        caught instanceof Error ? caught.message : t("No se pudo guardar el aviso."),
      );
    } finally {
      setAlertBusy(false);
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
        { method: "POST", body: { password: totpPassword } },
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
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : t("No se pudo eliminar la cuenta."));
      setBusyAccount(false);
    }
  }

  return (
    <div className="account-settings">
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
          <strong>{publishedCount}</strong>
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
            {t("Te enviamos un enlace a")} <b>{user.email}</b>.{" "}
            {t("Sin confirmarlo no podrás recuperar la cuenta si olvidas la contraseña.")}
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

      <div className="account-box">
        <details open>
          <summary>{t("Editar perfil")}</summary>
          <form onSubmit={saveProfile}>
            <label htmlFor="profile-name">{t("Nombre visible")}</label>
            <input
              id="profile-name"
              aria-describedby={accountError ? "account-error" : undefined}
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
              id="profile-bio"
              aria-describedby={accountError ? "account-error" : undefined}
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
            <label className="checkbox-row" htmlFor="profile-city-alerts">
              <input
                id="profile-city-alerts"
                type="checkbox"
                checked={alertOn}
                onChange={() => void toggleAlert()}
                disabled={alertBusy}
              />
              {t("Avisarme de nuevos libros en {city}", { city: user.city })}
            </label>
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
              id="current-password"
              aria-describedby={accountError ? "account-error" : undefined}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
            <label htmlFor="new-password">{t("Nueva contraseña")}</label>
            <input
              id="new-password"
              aria-describedby={accountError ? "account-error" : undefined}
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

        <details className="crypto-section">
          <summary>
            <span>{t("Cifrado de mensajes")}</span>
            <span className={`crypto-badge${keyActive ? " is-on" : ""}`}>
              {keys === null
                ? t("Comprobando…")
                : keyActive
                  ? t("Activo")
                  : t("Sin activar")}
            </span>
          </summary>
          {keyMsg && (
            <p className="action-feedback" role="status">
              {keyMsg}
            </p>
          )}
          {keyError && (
            <p className="form-error" role="alert">
              {keyError}
            </p>
          )}

          <div className="crypto-status">
            <span className={`crypto-icon${keyActive ? " is-on" : ""}`} aria-hidden="true">
              {keyActive ? <ShieldCheck size={18} /> : <Lock size={18} />}
            </span>
            <div>
              <strong>
                {keys === null
                  ? t("Comprobando el estado del cifrado…")
                  : keyActive
                    ? t("Este navegador puede leer las conversaciones")
                    : keys.keyId
                      ? t("Tu cuenta ya tiene una clave, pero no es la de este navegador")
                      : t("Este navegador todavía no está cifrado")}
              </strong>
              <p>
                {keys === null
                  ? t("En cuanto esté, se dirá aquí si este navegador puede leer las conversaciones.")
                  : keyActive
                    ? t(
                        "La conversación de cada intercambio se cifra con una clave que solo existe aquí: el servidor guarda un sobre que no puede abrir.",
                      )
                    : keys.keyId
                      ? t(
                          "Puedes entrar desde el dispositivo donde la creaste o sustituirla aquí con tu contraseña: al hacerlo, el anterior deja de leer los mensajes nuevos.",
                        )
                      : (keys.keys?.length ?? 0) > 0
                        ? t(
                            "Tu cuenta ya cifra desde otro dispositivo. Con tu contraseña puedes añadir también la clave de este navegador: las dos leerán los mensajes nuevos.",
                          )
                        : t(
                            "Se crea y se publica sola al entrar con tu cuenta. Si esa publicación falló, puedes hacerlo aquí a mano.",
                          )}
              </p>
            </div>
          </div>

          <dl className="crypto-facts">
            <div>
              <dt>{t("Huella de este navegador")}</dt>
              <dd>
                {keyActive ? (
                  <code className="secret-code">{keys?.keyId?.slice(0, 8)}</code>
                ) : (
                  <span>{t("Sin clave en este navegador")}</span>
                )}
              </dd>
            </div>
            {/* Solo se enseña la clave de la cuenta cuando no es la de este
                navegador: repetir dos veces la misma huella solo confunde. */}
            {keys?.keyId && !keyActive && (
              <div>
                <dt>{t("Clave de la cuenta")}</dt>
                <dd>
                  <code className="secret-code">{keys.keyId.slice(0, 8)}</code>
                </dd>
              </div>
            )}
            {keys?.keys?.some((key) => key.platform === "android") && (
              <div>
                <dt>{t("Aplicación móvil")}</dt>
                <dd>
                  <code className="secret-code">
                    {keys.keys
                      .find((key) => key.platform === "android")!
                      .keyId.slice(0, 8)}
                  </code>
                </dd>
              </div>
            )}
            {keys && keys.history.length > 0 && (
              <div>
                <dt>{t("Último cambio")}</dt>
                <dd>{formatWhen(keys.history[0]!.createdAt, locale)}</dd>
              </div>
            )}
          </dl>

          <ul className="crypto-list">
            <li>{t("La clave privada no sale de este navegador: no se puede exportar, ni siquiera para la administración.")}</li>
            <li>{t("Ni quien administra la web puede leer el contenido: el panel solo muestra «mensaje cifrado».")}</li>
            <li>{t("El navegador y la app tienen cada uno su clave: los mensajes nuevos se cifran una vez por dispositivo, así que los dos pueden leerlos.")}</li>
          </ul>

          {keys !== null && !keyActive && !hasAnySlot && (
            <button
              className="secondary-button small"
              type="button"
              disabled={keyBusy}
              onClick={() => void activateKey()}
            >
              {keyBusy ? t("Activando…") : t("Activar el cifrado en este navegador")}
            </button>
          )}

          {keys !== null && !keyActive && hasAnySlot && (
            <form onSubmit={(event) => {
              event.preventDefault();
              void activateKey();
            }}>
              <label htmlFor="key-password">
                {t("Contraseña actual")}
                <input
                  id="key-password"
                  type="password"
                  autoComplete="current-password"
                  value={keyPassword}
                  onChange={(event) => setKeyPassword(event.target.value)}
                  required
                />
              </label>
              <p className="form-hint">
                {keys.keyId
                  ? t(
                      "Al sustituir la clave desde aquí, el otro dispositivo deja de leer los mensajes nuevos. Pide la contraseña para que nadie pueda hacerlo desde una sesión abierta.",
                    )
                  : t(
                      "Pide la contraseña para que nadie pueda añadir su propia clave desde una sesión abierta.",
                    )}
              </p>
              <button
                className="secondary-button small"
                type="submit"
                disabled={keyBusy || !keyPassword}
              >
                {keyBusy ? t("Activando…") : t("Usar la clave de este navegador")}
              </button>
            </form>
          )}
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
            <p className="form-hint">{totpError ? t("No se pudo cargar el estado.") : t("Cargando…")}</p>
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
                <img
                  className="totp-qr"
                  src={totpQr}
                  alt={t("Código QR para configurar la verificación en dos pasos")}
                />
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
              id="delete-password"
              aria-describedby={accountError ? "account-error" : undefined}
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

      <div className="account-settings-footer">
        <button type="button" className="secondary-button" onClick={logout} disabled={pending}>
          <LogOut size={15} /> {pending ? t("Saliendo…") : t("Cerrar sesión")}
        </button>
      </div>
    </div>
  );
}
