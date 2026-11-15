"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Scale, Check, X } from "lucide-react";
import { api } from "@/lib/client-api";
import type { AppealView } from "@/lib/repo";
import { formatWhen } from "@/lib/text";
import { useI18n } from "./i18n-provider";

function Pager({
  page,
  total,
  pageSize,
}: {
  page: number;
  total: number;
  pageSize: number;
}) {
  const { t } = useI18n();
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  return (
    <nav className="pager" aria-label={t("Paginación de apelaciones")}>
      {page <= 1 ? (
        <span className="secondary-button small is-disabled" aria-disabled="true">
          {t("Anterior")}
        </span>
      ) : (
        <Link className="secondary-button small" href={`/admin?appealsPage=${page - 1}`}>
          {t("Anterior")}
        </Link>
      )}
      <span>{t("Página {page} de {total}", { page, total: last })}</span>
      {page >= last ? (
        <span className="secondary-button small is-disabled" aria-disabled="true">
          {t("Siguiente")}
        </span>
      ) : (
        <Link className="secondary-button small" href={`/admin?appealsPage=${page + 1}`}>
          {t("Siguiente")}
        </Link>
      )}
    </nav>
  );
}

function AppealReview({ appeal }: { appeal: AppealView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  async function resolve(outcome: "upheld" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/appeals/${appeal.id}`, {
        method: "POST",
        body: { outcome, resolution },
      });
      setFeedback(t("Apelación resuelta."));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo resolver la apelación."));
    } finally {
      setBusy(false);
    }
  }

  if (!appeal.canReview) {
    return (
      <p className="form-hint">
        {t("Esta apelación la impuso tu cuenta: debe revisarla otra persona del equipo.")}
      </p>
    );
  }

  return (
    <div className="admin-actions">
      <label htmlFor={`appeal-${appeal.id}`} className="sr-only">
        {t("Respuesta para la persona")}
      </label>
      <textarea
        id={`appeal-${appeal.id}`}
        value={resolution}
        onChange={(event) => setResolution(event.target.value)}
        placeholder={t("Respuesta para la persona")}
        minLength={10}
        maxLength={2000}
        rows={2}
      />
      <button
        type="button"
        className="secondary-button small"
        disabled={busy || resolution.trim().length < 10}
        onClick={() => void resolve("upheld")}
      >
        <Check size={14} /> {t("Estimar")}
      </button>
      <button
        type="button"
        className="secondary-button small danger"
        disabled={busy || resolution.trim().length < 10}
        onClick={() => void resolve("rejected")}
      >
        <X size={14} /> {t("Mantener")}
      </button>
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
    </div>
  );
}

export function AdminAppeals({
  appeals,
  page,
  total,
  pageSize,
}: {
  appeals: AppealView[];
  page: number;
  total: number;
  pageSize: number;
}) {
  const { t, locale } = useI18n();
  return (
    <section>
      <h2 className="admin-title">
        <Scale size={16} /> {t("Apelaciones abiertas")}
      </h2>
      {appeals.length === 0 ? (
        <p className="admin-empty">{t("No hay apelaciones pendientes.")}</p>
      ) : (
        <div className="admin-list">
          {appeals.map((appeal) => (
            <article className="admin-item" key={appeal.id}>
              <div className="admin-copy">
                <strong>{appeal.userName}</strong>
                <span>
                  {appeal.userEmail}
                  {appeal.sanctionAt
                    ? ` · ${t("sanción del {date}", { date: formatWhen(appeal.sanctionAt, locale) })}`
                    : ""}
                </span>
                <span>
                  {t("Motivo de la sanción")}: {appeal.sanctionReason}
                </span>
                <p>{appeal.message}</p>
              </div>
              <AppealReview appeal={appeal} />
            </article>
          ))}
        </div>
      )}
      <Pager page={page} total={total} pageSize={pageSize} />
    </section>
  );
}
