"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { api } from "@/lib/client-api";
import { formatWhen } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type SessionInfo = {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  device: string;
  current: boolean;
};

/**
 * Sesiones abiertas de la cuenta.
 *
 * Existe para poder responder a «¿desde dónde se ha entrado con mi cuenta?» y
 * cerrar un acceso concreto sin tener que cerrar todos. Se pide al abrir el
 * bloque: la lista casi nunca se necesita y no debe viajar en el HTML.
 */
export function SessionsPanel() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ sessions: SessionInfo[] }>("/api/account/sessions")
      .then((data) => {
        if (!cancelled) setSessions(data.sessions);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : t("No se pudieron cargar las sesiones."),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function close(session: SessionInfo) {
    setBusy(session.id);
    setError("");
    setFeedback("");
    try {
      const result = await api<{ current: boolean }>(
        `/api/account/sessions?sessionId=${encodeURIComponent(session.id)}`,
        { method: "DELETE" },
      );
      if (result.current) {
        // Era la sesión de este navegador: se sale igual que con «Cerrar sesión».
        router.replace("/");
        router.refresh();
        return;
      }
      setSessions((previous) => previous?.filter((item) => item.id !== session.id) ?? null);
      setFeedback(t("Sesión cerrada."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo cerrar la sesión."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="account-box">
      <details>
        <summary>{t("Sesiones abiertas")}</summary>
        <p className="form-note">
          {t("Dónde has entrado con tu cuenta. Cierra lo que no reconozcas.")}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {feedback && (
          <p className="action-feedback" role="status">
            {feedback}
          </p>
        )}
        {sessions === null && !error && <p className="empty-note">{t("Cargando…")}</p>}
        {sessions !== null && sessions.length === 0 && (
          <p className="empty-note">{t("No hay sesiones abiertas.")}</p>
        )}
        {sessions !== null && sessions.length > 0 && (
          <ul className="session-list">
            {sessions.map((session) => (
              <li key={session.id} className="session-item">
                <span className="session-what">
                  <MonitorSmartphone size={16} aria-hidden="true" />
                  <span>
                    <strong>{session.device || t("Sin datos del navegador")}</strong>{" "}
                    {session.current && <span className="session-current">{t("Este dispositivo")}</span>}
                  </span>
                </span>
                <span className="session-when">
                  {t("Último uso: {when}", {
                    when: formatWhen(session.lastSeenAt ?? session.createdAt, locale),
                  })}
                </span>
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => void close(session)}
                  disabled={busy === session.id}
                >
                  <LogOut size={14} aria-hidden="true" />
                  {busy === session.id ? t("Cerrando…") : t("Cerrar esta sesión")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
