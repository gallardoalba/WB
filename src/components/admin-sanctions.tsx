"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { History, Eye, EyeOff, UserCheck } from "lucide-react";
import { api } from "@/lib/client-api";
import type { MessageKey } from "@/lib/i18n";
import type { AuditView, HiddenCommentView, SuspendedUserView } from "@/lib/repo";
import { formatWhen } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type Props = {
  suspended: SuspendedUserView[];
  hiddenComments: HiddenCommentView[];
  audit: AuditView[];
  canSanction: boolean;
  showAudit: boolean;
  pageSize: number;
  pagination: Record<"suspended" | "comments" | "audit", { page: number; total: number }>;
};

/** Página de una sección del panel, conservando solo su propio parámetro. */
function ListPager({
  param,
  page,
  total,
  pageSize,
  label,
}: {
  param: string;
  page: number;
  total: number;
  pageSize: number;
  label: string;
}) {
  const { t } = useI18n();
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      {page <= 1 ? (
        <span className="secondary-button small is-disabled" aria-disabled="true">
          {t("Anterior")}
        </span>
      ) : (
        <Link className="secondary-button small" href={`/admin?${param}=${page - 1}`}>
          {t("Anterior")}
        </Link>
      )}
      <span>{t("Página {page} de {total}", { page, total: last })}</span>
      {page >= last ? (
        <span className="secondary-button small is-disabled" aria-disabled="true">
          {t("Siguiente")}
        </span>
      ) : (
        <Link className="secondary-button small" href={`/admin?${param}=${page + 1}`}>
          {t("Siguiente")}
        </Link>
      )}
    </nav>
  );
}

const ACTION_LABELS: Record<string, MessageKey> = {
  suspend_user: "Cuenta suspendida",
  unsuspend_user: "Cuenta reactivada",
  hide_listing: "Ejemplar retirado",
  restore_listing: "Ejemplar restablecido",
  hide_comment: "Comentario oculto",
  restore_comment: "Comentario restablecido",
  dismiss: "Denuncia descartada",
  appeal_upheld: "Apelación estimada",
  appeal_rejected: "Apelación rechazada",
};

export function AdminSanctions({
  suspended,
  hiddenComments,
  audit,
  canSanction,
  showAudit,
  pageSize,
  pagination,
}: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  async function reactivate(userId: string, name: string) {
    setBusyId(userId);
    setError("");
    setFeedback("");
    try {
      await api("/api/admin/moderation", {
        method: "POST",
        body: { action: "unsuspend_user", targetType: "user", targetId: userId },
      });
      setFeedback(t("{name} puede volver a entrar.", { name }));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo reactivar la cuenta."));
    } finally {
      setBusyId(null);
    }
  }

  async function restoreComment(commentId: string) {
    setBusyId(commentId);
    setError("");
    setFeedback("");
    try {
      await api("/api/admin/moderation", {
        method: "POST",
        body: { action: "restore_comment", targetType: "comment", targetId: commentId },
      });
      setFeedback(t("El comentario vuelve a estar visible."));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo restablecer el comentario."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-sections">
      {canSanction && (
      <section>
        <h2 className="admin-title">{t("Cuentas suspendidas")}</h2>
        {feedback && (
          <p className="action-feedback" role="status">
            {feedback}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {suspended.length === 0 ? (
          <p className="admin-empty">{t("No hay ninguna cuenta suspendida.")}</p>
        ) : (
          <div className="admin-list">
            {suspended.map((person) => (
              <article className="admin-item" key={person.id}>
                <div className="admin-copy">
                  <strong>{person.name}</strong>
                  <span>
                    {person.city}
                    {person.suspendedAt ? ` · ${t("suspendida")} ${formatWhen(person.suspendedAt, locale)}` : ""}
                  </span>
                  <span>{person.email}</span>
                  {person.suspendedUntil && (
                    <span>
                      {t("hasta el {date}", {
                        date: formatWhen(person.suspendedUntil, locale),
                      })}
                    </span>
                  )}
                  {person.reason && (
                    <span>
                      {t("Motivo de la sanción")}: {person.reason}
                    </span>
                  )}
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="secondary-button small"
                    disabled={busyId === person.id}
                    onClick={() => reactivate(person.id, person.name)}
                  >
                    <UserCheck size={14} /> {t("Reactivar")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        <ListPager
          param="suspendedPage"
          page={pagination.suspended.page}
          total={pagination.suspended.total}
          pageSize={pageSize}
          label={t("Paginación de cuentas suspendidas")}
        />
      </section>
      )}

      <section>
        <h2 className="admin-title">
          <EyeOff size={16} /> {t("Comentarios ocultos")}
        </h2>
        {hiddenComments.length === 0 ? (
          <p className="admin-empty">{t("No hay comentarios ocultos.")}</p>
        ) : (
          <div className="admin-list">
            {hiddenComments.map((comment) => (
              <article className="admin-item" key={comment.id}>
                <div className="admin-copy">
                  <strong>{comment.authorName}</strong>
                  <span>
                    {comment.bookTitle} · {formatWhen(comment.createdAt, locale)}
                  </span>
                  <p>{comment.body}</p>
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="secondary-button small"
                    disabled={busyId === comment.id}
                    onClick={() => restoreComment(comment.id)}
                  >
                    <Eye size={14} /> {t("Restablecer")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        <ListPager
          param="commentsPage"
          page={pagination.comments.page}
          total={pagination.comments.total}
          pageSize={pageSize}
          label={t("Paginación de comentarios ocultos")}
        />
      </section>

      {showAudit && (
      <section>
        <h2 className="admin-title">
          <History size={16} /> {t("Últimas acciones")}
        </h2>
        {audit.length === 0 ? (
          <p className="admin-empty">{t("Todavía no hay acciones registradas.")}</p>
        ) : (
          <ul className="audit-list">
            {audit.map((entry) => (
              <li key={entry.id}>
                <strong>{t(ACTION_LABELS[entry.action] ?? entry.action)}</strong>
                <span>
                  {entry.targetId} · {entry.adminName} · {formatWhen(entry.createdAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ListPager
          param="auditPage"
          page={pagination.audit.page}
          total={pagination.audit.total}
          pageSize={pageSize}
          label={t("Paginación de auditoría")}
        />
      </section>
      )}
    </div>
  );
}
