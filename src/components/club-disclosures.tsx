"use client";

/**
 * Lo que se ha revelado a quien modera el club.
 *
 * Moderar sin leer todo el club tiene un precio: los mensajes denunciados solo
 * llegan si quien denuncia los comparte. Aquí se ven esas revelaciones con su
 * motivo, quién las hizo y el texto que esa persona decidió mostrar, descifrado
 * en este navegador con el dispositivo del moderador.
 *
 * No hay forma de pedir más: si algo no se ha revelado, esta pantalla no lo
 * enseña porque el servidor tampoco lo tiene.
 */
import { useEffect, useState } from "react";
import { Eye, TriangleAlert } from "lucide-react";

import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

type Disclosure = {
  id: string;
  postId: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  createdAt: string;
  readAt: string | null;
  envelopes: { type: number | null; body: string }[];
};

export function ClubDisclosures({ clubId, userId }: { clubId: string; userId: string }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Disclosure[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [needsDevice, setNeedsDevice] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const bridge = await import("@/lib/e2e-v2-chat").catch(() => null);
        const device = bridge ? await bridge.deviceIdFor(userId) : null;
        const data = await api<{ disclosures: Disclosure[]; needsDevice: boolean }>(
          `/api/clubs/${clubId}/disclosures${device ? `?device=${encodeURIComponent(device)}` : ""}`,
        );
        if (cancelled) return;
        setItems(data.disclosures);
        setNeedsDevice(data.needsDevice);
        if (data.disclosures.length === 0 || !bridge) return;
        const decoded = await bridge.decryptClubDisclosures({
          userId,
          clubId,
          disclosures: data.disclosures.map((item) => ({
            id: item.id,
            reporterId: item.reporterId,
            envelopes: item.envelopes,
          })),
        });
        if (!cancelled) setTexts(decoded);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : t("No se pudieron cargar las revelaciones."),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, userId, t]);

  async function markRead(id: string) {
    try {
      await api(`/api/clubs/${clubId}/disclosures/${id}`, { method: "POST" });
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
    } catch {
      // Marcar como leída es cortesía: si falla, no impide moderar.
    }
  }

  if (error) {
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  }

  if (needsDevice) {
    return (
      <p className="empty-note">
        {t(
          "Activa el cifrado v2 en este navegador desde «Mi cuenta» para poder leer lo que se revela.",
        )}
      </p>
    );
  }

  if (items.length === 0) {
    return <p className="empty-note">{t("Nadie ha revelado ningún mensaje.")}</p>;
  }

  return (
    <ul className="disclosure-list">
      {items.map((item) => (
        <li key={item.id} className={item.readAt ? "disclosure read" : "disclosure"}>
          <p className="disclosure-meta">
            <Eye size={13} aria-hidden />{" "}
            {t("Revelado por {name}", { name: item.reporterName })}{" "}
            <time dateTime={item.createdAt}>
              {new Date(item.createdAt).toLocaleDateString(locale)}
            </time>
          </p>
          <p className="disclosure-reason">
            <TriangleAlert size={13} aria-hidden /> {item.reason}
          </p>
          <blockquote>{texts[item.id] ?? t("No se pudo abrir en este dispositivo.")}</blockquote>
          {!item.readAt && (
            <button
              className="secondary-button small"
              type="button"
              onClick={() => void markRead(item.id)}
            >
              {t("Marcar como leída")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
