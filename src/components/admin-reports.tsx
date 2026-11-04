"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, ShieldOff, Check, X } from "lucide-react";
import { api } from "@/lib/client-api";
import type { AdminReportView } from "@/lib/domain";
import type { MessageKey } from "@/lib/i18n";
import { formatWhen } from "@/lib/text";
import { ConfirmDialog } from "./confirm-dialog";
import { useI18n } from "./i18n-provider";

type Action = "dismiss" | "hide_listing" | "suspend_user" | "hide_comment" | "hide_club";

const UNDO: Partial<Record<Action, string>> = {
  hide_listing: "restore_listing",
  suspend_user: "unsuspend_user",
  hide_comment: "restore_comment",
  hide_club: "restore_club",
};

const CONFIRM_TITLE: Partial<Record<Action, MessageKey>> = {
  hide_listing: "¿Retirar este ejemplar?",
  suspend_user: "¿Suspender esta cuenta?",
  hide_comment: "¿Ocultar este comentario?",
  hide_club: "¿Ocultar este club?",
};

const CONFIRM_TEXT: Partial<Record<Action, MessageKey>> = {
  hide_listing: "Dejará de aparecer en el catálogo y se cancelarán los intercambios aceptados.",
  suspend_user: "La persona no podrá entrar ni publicar hasta que se reactive.",
  hide_comment: "Solo su autor podrá verlo.",
  hide_club: "Desaparecerá del directorio y del perfil de sus miembros.",
};

export function AdminReports({ reports }: { reports: AdminReportView[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<{ report: AdminReportView; action: Action } | null>(null);
  const [last, setLast] = useState<{ action: Action; targetType: string; targetId: string } | null>(null);

  async function act(reportId: string, action: Action, report?: AdminReportView) {
    setBusyId(reportId);
    setError("");
    setFeedback("");
    try {
      await api(`/api/admin/reports/${reportId}`, { method: "POST", body: { action } });
      setFeedback(
        action === "dismiss" ? t("Denuncia descartada.") : t("Acción aplicada. Puedes deshacerla."),
      );
      setLast(
        report && UNDO[action]
          ? { action, targetType: report.targetType, targetId: report.targetId }
          : null,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo resolver la denuncia."));
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  async function undo() {
    if (!last || !UNDO[last.action]) return;
    setError("");
    try {
      await api("/api/admin/moderation", {
        method: "POST",
        body: {
          action: UNDO[last.action],
          targetType: last.targetType,
          targetId: last.targetId,
        },
      });
      setFeedback(t("Acción deshecha."));
      setLast(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo deshacer la acción."));
    }
  }

  function requestAction(report: AdminReportView, action: Action) {
    if (UNDO[action]) {
      setConfirming({ report, action });
    } else {
      void act(report.id, action, report);
    }
  }

  if (reports.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <Check size={22} />
        </span>
        <h3>{t("Sin denuncias abiertas")}</h3>
        <p>{t("Todo revisado por ahora.")}</p>
      </div>
    );
  }

  return (
    <div className="admin-list">
      {feedback && (
        <p className="action-feedback" role="status">
          {feedback}{" "}
          {last && (
            <button type="button" className="text-link" onClick={() => void undo()}>
              {t("Deshacer")}
            </button>
          )}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {reports.map((report) => (
        <article className="admin-item" key={report.id}>
          <div className="admin-copy">
            <span className="book-category">
              {report.targetType === "listing"
                ? t("Ejemplar")
                : report.targetType === "user"
                  ? t("Perfil")
                  : report.targetType === "comment"
                    ? t("Comentario")
                    : report.targetType === "club"
                      ? t("Club")
                      : report.targetType === "request"
                        ? t("Intercambio")
                        : t("Mensaje")}
            </span>
            <strong>{report.targetLabel}</strong>
            <span>
              {report.reason} · {report.reporter.name} · {formatWhen(report.createdAt, locale)}
            </span>
            {report.details && <p>{report.details}</p>}
          </div>
          <div className="admin-actions">
            <button
              type="button"
              className="secondary-button small"
              disabled={busyId === report.id}
              onClick={() => requestAction(report, "dismiss")}
            >
              <X size={14} /> {t("Descartar")}
            </button>
            {report.targetType === "listing" && (
              <button
                type="button"
                className="secondary-button small danger"
                disabled={busyId === report.id}
                onClick={() => requestAction(report, "hide_listing")}
              >
                <EyeOff size={14} /> {t("Retirar ejemplar")}
              </button>
            )}
            {report.targetType === "user" && (
              <button
                type="button"
                className="secondary-button small danger"
                disabled={busyId === report.id}
                onClick={() => requestAction(report, "suspend_user")}
              >
                <ShieldOff size={14} /> {t("Suspender cuenta")}
              </button>
            )}
            {report.targetType === "comment" && (
              <button
                type="button"
                className="secondary-button small danger"
                disabled={busyId === report.id}
                onClick={() => requestAction(report, "hide_comment")}
              >
                <EyeOff size={14} /> {t("Ocultar comentario")}
              </button>
            )}
            {report.targetType === "club" && (
              <button
                type="button"
                className="secondary-button small danger"
                disabled={busyId === report.id}
                onClick={() => requestAction(report, "hide_club")}
              >
                <EyeOff size={14} /> {t("Ocultar club")}
              </button>
            )}
          </div>
        </article>
      ))}

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) void act(confirming.report.id, confirming.action, confirming.report);
        }}
        title={t(CONFIRM_TITLE[confirming?.action ?? "dismiss"] ?? "¿Confirmas la acción?")}
        description={t(
          "{label} · {text}",
          {
            label: confirming?.report.targetLabel ?? "",
            text: CONFIRM_TEXT[confirming?.action ?? "dismiss"] ?? "",
          },
        )}
        confirmLabel={t("Confirmar")}
        pending={Boolean(confirming && busyId === confirming.report.id)}
      />
    </div>
  );
}
