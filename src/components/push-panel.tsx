"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

/**
 * Avisos del navegador (Web Push) en este dispositivo.
 *
 * El botón pide permiso, se suscribe con la clave VAPID que sirve la API y
 * guarda la suscripción en la cuenta. Si el navegador no lo admite (o en iPhone
 * sin instalar la app) se dice y no se ofrece nada: un botón que no hace nada es
 * peor que no tenerlo.
 */
type Estado =
  | "cargando"
  | "no-soportado"
  | "sin-configurar"
  | "inactivo"
  | "activo"
  | "denegado";

/** base64url → bytes, que es lo que espera `pushManager.subscribe`. */
function claveBytes(base64: string): Uint8Array {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(normal);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export function PushPanel() {
  const { t } = useI18n();
  const [estado, setEstado] = useState<Estado>("cargando");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelado) setEstado("no-soportado");
        return;
      }
      const info = await api<{ configured: boolean; count: number }>("/api/push").catch(
        () => null,
      );
      if (cancelado) return;
      if (!info?.configured) {
        setEstado("sin-configurar");
        return;
      }
      if (Notification.permission === "denied") {
        setEstado("denegado");
        return;
      }
      const registro = await navigator.serviceWorker.getRegistration().catch(() => undefined);
      const suscripcion = await registro?.pushManager.getSubscription().catch(() => undefined);
      setEstado(suscripcion ? "activo" : "inactivo");
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  async function activar() {
    setBusy(true);
    setAviso("");
    setError("");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado("denegado");
        return;
      }
      const info = await api<{ publicKey: string | null }>("/api/push");
      if (!info.publicKey) {
        setEstado("sin-configurar");
        return;
      }
      const registro = await navigator.serviceWorker.ready;
      const suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveBytes(info.publicKey) as BufferSource,
      });
      const json = suscripcion.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error("suscripción incompleta");
      }
      await api("/api/push", {
        method: "POST",
        body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
      });
      setEstado("activo");
      setAviso(t("Avisos activados en este dispositivo."));
    } catch {
      setError(t("No se pudieron activar los avisos."));
    } finally {
      setBusy(false);
    }
  }

  async function desactivar() {
    setBusy(true);
    setAviso("");
    setError("");
    try {
      const registro = await navigator.serviceWorker.getRegistration().catch(() => undefined);
      const suscripcion = await registro?.pushManager.getSubscription().catch(() => undefined);
      if (suscripcion) {
        const endpoint = suscripcion.endpoint;
        await suscripcion.unsubscribe().catch(() => false);
        await api("/api/push", { method: "DELETE", body: { endpoint } }).catch(() => null);
      }
      setEstado("inactivo");
      setAviso(t("Avisos desactivados en este dispositivo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-box">
      <details>
        <summary>{t("Avisos en este dispositivo")}</summary>
        <p className="form-note">
          {t(
            "Recibe un aviso cuando te pidan un libro o te escriban, aunque no tengas la web abierta.",
          )}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {aviso && (
          <p className="action-feedback" role="status">
            {aviso}
          </p>
        )}
        {estado === "cargando" && <p className="empty-note">{t("Cargando…")}</p>}
        {estado === "no-soportado" && (
          <p className="empty-note">
            {t(
              "Este navegador no admite avisos. En iPhone, añade antes la web a la pantalla de inicio.",
            )}
          </p>
        )}
        {estado === "sin-configurar" && (
          <p className="empty-note">
            {t("Los avisos todavía no están disponibles en esta instancia.")}
          </p>
        )}
        {estado === "denegado" && (
          <p className="form-note">
            {t(
              "Has bloqueado los avisos para este sitio: vuelve a permitirlos en los ajustes del navegador.",
            )}
          </p>
        )}
        {estado === "inactivo" && (
          <button
            type="button"
            className="secondary-button small"
            onClick={() => void activar()}
            disabled={busy}
          >
            <BellRing size={15} aria-hidden="true" /> {t("Activar avisos")}
          </button>
        )}
        {estado === "activo" && (
          <button
            type="button"
            className="secondary-button small"
            onClick={() => void desactivar()}
            disabled={busy}
          >
            {t("Desactivar avisos")}
          </button>
        )}
      </details>
    </div>
  );
}
