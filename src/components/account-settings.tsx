"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, Lock, LogOut, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client-api";
import { ensureIdentity } from "@/lib/e2e";
import { localePath } from "@/lib/locale";
import type { RequestView, SessionUser } from "@/lib/domain";
import { formatWhen } from "@/lib/text";
import { CityField } from "./city-field";
import { useI18n } from "./i18n-provider";
import { SessionsPanel } from "./sessions-panel";
import { PushPanel } from "./push-panel";

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
type OwnDevice = {
  deviceId: string;
  identityKey?: string;
  signingKey?: string;
  createdAt: string;
  updatedAt: string;
  oneTimeKeys: number;
};

/** Identificador legible de un dispositivo: no hace falta enseñar los 24 caracteres. */
function shortDeviceId(deviceId: string): string {
  return `${deviceId.slice(0, 6)}…${deviceId.slice(-4)}`;
}

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
  const [privacy, setPrivacy] = useState({
    profileVisibility: user.profileVisibility,
    cityPrecision: user.cityPrecision,
    signAs: user.signAs,
    dmPolicy: user.dmPolicy,
    showJourney: user.showJourney,
  });
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyMsg, setPrivacyMsg] = useState("");
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
  const [v2Active, setV2Active] = useState(false);
  const [v2Orphan, setV2Orphan] = useState(false);
  const [v2Busy, setV2Busy] = useState(false);
  const [v2Password, setV2Password] = useState("");
  const [v2NeedsPassword, setV2NeedsPassword] = useState(false);
  const [v2Msg, setV2Msg] = useState("");
  const [v2Error, setV2Error] = useState("");
  const [v2Devices, setV2Devices] = useState<OwnDevice[] | null>(null);
  const [myDeviceId, setMyDeviceId] = useState<string | null>(null);
  const [v2Revoking, setV2Revoking] = useState<string | null>(null);
  const [keyMsg, setKeyMsg] = useState("");
  const [keyError, setKeyError] = useState("");

  const [alertOn, setAlertOn] = useState(alertsOn);
  const [alertBusy, setAlertBusy] = useState(false);

  // El dispositivo v2 no se crea solo: publicar la identidad de este navegador
  // es una decisión (y puede pedir contraseña), así que aquí solo se mira si ya
  // existe para poder decirlo.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const bridge = await import("@/lib/e2e-v2-chat").catch(() => null);
      const active = bridge ? await bridge.hasV2Device(user.id).catch(() => false) : false;
      const mine = bridge ? await bridge.deviceIdFor(user.id).catch(() => null) : null;
      const localKeys = bridge ? await bridge.deviceKeysFor(user.id).catch(() => null) : null;
      if (!cancelled) {
        setV2Active(active);
        setMyDeviceId(mine);
      }
      // La lista se pide dentro del efecto: así no depende de una función que
      // cambia en cada render.
      await api<{ devices: OwnDevice[] }>("/api/account/devices")
        .then((data) => {
          if (cancelled) return;
          setV2Devices(data.devices);
          // El dispositivo local puede haber sido retirado desde otro
          // navegador. Si el servidor ya no lo lista, no se puede seguir
          // diciendo que este navegador está activo.
          const listed = data.devices.find((device) => device.deviceId === mine);
          if (mine && !listed) {
            setV2Active(false);
            setV2Orphan(true);
          } else if (
            listed &&
            localKeys &&
            (listed.identityKey !== localKeys.identityKey ||
              listed.signingKey !== localKeys.signingKey)
          ) {
            // El servidor cambió las claves bajo el mismo id: este navegador ya
            // no puede recibir lo que se cifre con la identidad publicada.
            setV2Active(false);
            setV2Orphan(true);
            setV2Error(
              t("El servidor publica otras claves para este dispositivo. Vuelve a activar el cifrado v2."),
            );
          }
        })
        .catch(() => {
          if (!cancelled) setV2Devices([]);
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await api<StoredKeys>("/api/account/keys");
        // Este bloque es la ranura web: la app móvil tiene la suya y no se
        // toca desde aquí.
        const web = stored.keys?.find((key) => key.platform === "web") ?? null;
        const identity = await ensureIdentity(user.id, { publishedKeyId: web?.keyId ?? null });
        if (cancelled) return;
        setLocalKeyId(identity.keyId);
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
  }, [t, user.id]);

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

  async function savePrivacy(event: FormEvent) {
    event.preventDefault();
    setPrivacyBusy(true);
    setPrivacyMsg("");
    try {
      await api("/api/account/privacy", { method: "POST", body: privacy });
      setPrivacyMsg(t("Privacidad guardada."));
      router.refresh();
    } catch (caught) {
      setPrivacyMsg(caught instanceof Error ? caught.message : t("No se pudo guardar."));
    } finally {
      setPrivacyBusy(false);
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
      const publishedKeyId =
        keys?.keys?.find((key) => key.platform === "web")?.keyId ?? null;
      const identity = await ensureIdentity(user.id, { publishedKeyId });
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

  /** La lista de dispositivos de esta cuenta, con lo justo para gestionarlos. */
  async function loadV2Devices() {
    try {
      const data = await api<{ devices: OwnDevice[] }>("/api/account/devices");
      setV2Devices(data.devices);
    } catch {
      setV2Devices([]);
      setV2Error(t("No se pudieron cargar los dispositivos."));
    }
  }

  /**
   * Retira un dispositivo: deja de recibir claves nuevas.
   *
   * Si es este navegador, además se olvida su estado local: la clave privada no
   * sirve para nada una vez el servidor ya no la publica, y dejarla sería
   * conservar material que nadie va a usar.
   */
  async function revokeV2Device(deviceId: string) {
    setV2Revoking(deviceId);
    setV2Error("");
    setV2Msg("");
    try {
      await api(`/api/account/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
      if (deviceId === myDeviceId) {
        const bridge = await import("@/lib/e2e-v2-chat");
        await bridge.forgetV2Device(user.id);
        setV2Active(false);
        setMyDeviceId(null);
      }
      setV2Msg(t("Dispositivo retirado: ya no recibe claves nuevas."));
      await loadV2Devices();
    } catch (caught) {
      setV2Error(
        caught instanceof Error ? caught.message : t("No se pudo retirar el dispositivo."),
      );
    } finally {
      setV2Revoking(null);
    }
  }

  /**
   * Publica el dispositivo v2 de este navegador.
   *
   * Si el servidor pide contraseña —la cuenta ya tenía identidad— se muestra el
   * campo y se reintenta; no se guarda nada a medias.
   */
  async function activateV2Device() {
    setV2Busy(true);
    setV2Error("");
    setV2Msg("");
    try {
      const activated = await import("@/lib/e2e-v2-chat");
      // Si el servidor ya no lista el dispositivo local, hay que empezar de
      // cero: publicar el mismo id no lo resucita y la clave privada antigua
      // ya no sirve para las sesiones nuevas.
      if (v2Orphan) await activated.forgetV2Device(user.id);
      await activated.activateV2(user.id, v2Password || undefined);
      setV2Orphan(false);
      setV2Active(true);
      setV2NeedsPassword(false);
      setV2Password("");
      setV2Msg(t("Cifrado v2 activado en este navegador."));
      const fresh = await import("@/lib/e2e-v2-chat");
      setMyDeviceId(await fresh.deviceIdFor(user.id).catch(() => null));
      await loadV2Devices();
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status === 428) {
        setV2NeedsPassword(true);
        setV2Error(t("Confirma tu contraseña para publicar este dispositivo."));
      } else {
        setV2Error(
          caught instanceof Error ? caught.message : t("No se pudo activar el cifrado v2."),
        );
      }
    } finally {
      setV2Busy(false);
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
            <label htmlFor="profile-name">{t("Nombre público")}</label>
            <input
              id="profile-name"
              aria-describedby={accountError ? "account-error" : undefined}
              name="name"
              key={user.name}
              defaultValue={user.name}
              autoComplete="nickname"
              minLength={2}
              maxLength={60}
              required
            />
            <p className="form-note">
              {t("Así te ven las demás personas. Puedes usar un seudónimo.")}
            </p>
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
                <dt>{t("Clave de otro dispositivo")}</dt>
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
            <li>{t("Los mensajes nuevos se cifran con la clave publicada de la cuenta: cualquier navegador que la tenga puede leerlos.")}</li>
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
          <div className="v2-device">
            <h4>{t("Cifrado de nueva generación (v2)")}</h4>
            <p className="form-hint">
              {t(
                "Cada dispositivo tiene su propia clave y cada mensaje una clave distinta: si te quitan el aparato hoy, no podrán leer lo de ayer. Hace falta activarlo en cada navegador.",
              )}
            </p>
            {v2Error && (
              <p className="form-error" role="alert">
                {v2Error}
              </p>
            )}
            {v2Msg && (
              <p className="action-feedback" role="status">
                {v2Msg}
              </p>
            )}
            {v2Devices && v2Devices.length > 0 && (
              <div className="v2-devices">
                <h5>{t("Dispositivos de cifrado")}</h5>
                <ul>
                  {v2Devices.map((device) => (
                    <li key={device.deviceId}>
                      <code>{shortDeviceId(device.deviceId)}</code>
                      {device.deviceId === myDeviceId && (
                        <span className="form-hint"> · {t("Este navegador")}</span>
                      )}
                      {device.deviceId !== myDeviceId && (
                        <button
                          type="button"
                          className="secondary-button small"
                          aria-label={`${t("Retirar el dispositivo")} ${shortDeviceId(device.deviceId)}`}
                          disabled={v2Revoking !== null}
                          onClick={() => void revokeV2Device(device.deviceId)}
                        >
                          {v2Revoking === device.deviceId ? t("Retirando…") : t("Retirar dispositivo")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {v2Active ? (
              <p className="action-feedback" role="status">
                {t("Este navegador ya tiene su dispositivo v2.")}
              </p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void activateV2Device();
                }}
              >
                {v2Orphan && (
                  <p className="form-note" role="status">
                    {t(
                      "Este dispositivo ya no está activo en el servidor. Al volver a activar el cifrado se creará uno nuevo en este navegador y se perderá el historial local de v2; los mensajes anteriores no se podrán leer aquí.",
                    )}
                  </p>
                )}
                {v2NeedsPassword && (
                  <label htmlFor="v2-password">
                    {t("Contraseña actual")}
                    <input
                      id="v2-password"
                      type="password"
                      autoComplete="current-password"
                      value={v2Password}
                      onChange={(event) => setV2Password(event.target.value)}
                      required
                    />
                  </label>
                )}
                <button
                  className="secondary-button small"
                  type="submit"
                  disabled={v2Busy || (v2NeedsPassword && !v2Password)}
                >
                  {v2Busy
                    ? t("Activando…")
                    : v2Orphan
                      ? t("Volver a activar el cifrado v2 en este navegador")
                      : t("Activar el cifrado v2 en este navegador")}
                </button>
              </form>
            )}
          </div>
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

      <div className="account-box">
        <details>
          <summary>{t("Privacidad")}</summary>
          <form onSubmit={savePrivacy}>
            <p className="form-note">
              {t("Decides qué ve la comunidad. El correo nunca se enseña.")}
            </p>
            <label htmlFor="privacy-profile">{t("Quién puede ver mi perfil")}</label>
            <select
              id="privacy-profile"
              value={privacy.profileVisibility}
              onChange={(event) =>
                setPrivacy({ ...privacy, profileVisibility: event.target.value as typeof privacy.profileVisibility })
              }
            >
              <option value="members">{t("Toda la comunidad")}</option>
              <option value="followers">{t("Solo a quienes sigo")}</option>
              <option value="private">{t("Solo yo")}</option>
            </select>

            <label htmlFor="privacy-city">{t("Mi ciudad")}</label>
            <select
              id="privacy-city"
              value={privacy.cityPrecision}
              onChange={(event) =>
                setPrivacy({ ...privacy, cityPrecision: event.target.value as typeof privacy.cityPrecision })
              }
            >
              <option value="exact">{t("Mostrar mi ciudad")}</option>
              <option value="hidden">{t("No mostrar mi ciudad")}</option>
            </select>
            <p className="form-note">
              {t("En un intercambio aceptado la otra persona sí ve la ciudad: sin ella no se puede quedar.")}
            </p>

            <label htmlFor="privacy-sign">{t("Firmar reseñas y comentarios")}</label>
            <select
              id="privacy-sign"
              value={privacy.signAs}
              onChange={(event) =>
                setPrivacy({ ...privacy, signAs: event.target.value as typeof privacy.signAs })
              }
            >
              <option value="name">{t("Con mi nombre")}</option>
              <option value="community">{t("Como una persona de la comunidad")}</option>
            </select>

            <label className="checkbox-row" htmlFor="privacy-journey">
              <input
                id="privacy-journey"
                type="checkbox"
                checked={privacy.showJourney}
                onChange={(event) =>
                  setPrivacy({ ...privacy, showJourney: event.target.checked })
                }
              />
              <span>{t("Contar el viaje de mis ejemplares")}</span>
            </label>
            <p className="form-note">
              {t("En la ficha, quien tiene sesión ve las ciudades y los meses por los que ha pasado el libro, nunca las personas. Si lo apagas, el recorrido no se enseña.")}
            </p>

            <label htmlFor="privacy-dm">{t("Quién puede escribirme")}</label>
            <select
              id="privacy-dm"
              value={privacy.dmPolicy}
              onChange={(event) =>
                setPrivacy({ ...privacy, dmPolicy: event.target.value as typeof privacy.dmPolicy })
              }
            >
              <option value="mutual">{t("Quien me sigue y sigo")}</option>
              <option value="exchanged">{t("Solo tras un intercambio")}</option>
            </select>

            {privacyMsg && (
              <p className="action-feedback" role="status">
                {privacyMsg}
              </p>
            )}
            <button className="secondary-button small" type="submit" disabled={privacyBusy}>
              {privacyBusy ? t("Guardando…") : t("Guardar privacidad")}
            </button>
          </form>
        </details>
      </div>

      <div className="account-box">
        <details>
          <summary>{t("Primeros pasos")}</summary>
          <p className="form-note">
            {t("El tour de bienvenida se ofrece a las cuentas que aún no han publicado ni pedido nada. Puedes volver a verlo cuando quieras.")}
          </p>
          <a className="secondary-button small" href={`${localePath(locale, "/")}?tour=1`}>
            {t("Ver el tour otra vez")}
          </a>
        </details>
      </div>

      <PushPanel />

      <SessionsPanel />

      <div className="account-settings-footer">
        <button type="button" className="secondary-button" onClick={logout} disabled={pending}>
          <LogOut size={15} /> {pending ? t("Saliendo…") : t("Cerrar sesión")}
        </button>
      </div>
    </div>
  );
}