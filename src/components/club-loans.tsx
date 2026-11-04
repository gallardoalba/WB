"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, RotateCcw } from "lucide-react";
import type { ClubLoanView } from "@/lib/repo";
import type { ListingView } from "@/lib/domain";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

export function ClubLoans({
  clubId,
  loans,
  copies,
  members,
  viewerId,
}: {
  clubId: string;
  loans: ClubLoanView[];
  copies: ListingView[];
  members: { id: string; name: string }[];
  viewerId: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const active = loans.filter((loan) => !loan.returnedAt);
  const myCopies = copies.filter((copy) => copy.owner.id === viewerId);
  const otherMembers = members.filter((member) => member.id !== viewerId);

  async function lend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await api(`/api/clubs/${clubId}/loans`, {
        method: "POST",
        body: {
          listingId: data.get("listingId"),
          borrowerId: data.get("borrowerId"),
          dueAt: data.get("dueAt") || null,
        },
      });
      form.reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo crear el préstamo."));
    } finally {
      setBusy(false);
    }
  }

  async function giveBack(loanId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/clubs/${clubId}/loans`, {
        method: "PATCH",
        body: { loanId },
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo marcar la devolución."));
    } finally {
      setBusy(false);
    }
  }

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "es-ES", {
      day: "numeric",
      month: "short",
    }).format(new Date(`${value}T12:00:00`));

  return (
    <div className="club-loans">
      <h3>
        <BookMarked size={15} /> {t("Préstamos del club")}
      </h3>
      {active.length === 0 ? (
        <p className="empty-note">{t("No hay préstamos activos.")}</p>
      ) : (
        <ul className="club-loan-list">
          {active.map((loan) => (
            <li key={loan.id}>
              <span>
                <strong>{loan.title}</strong>
                <small>
                  {t("De {lender} a {borrower}", {
                    lender: loan.lender.name,
                    borrower: loan.borrower.name,
                  })}
                  {loan.dueAt && ` · ${t("Devolver antes del {date}", { date: date(loan.dueAt) })}`}
                </small>
              </span>
              {(loan.lender.id === viewerId || loan.borrower.id === viewerId) && (
                <button
                  type="button"
                  className="secondary-button small"
                  disabled={busy}
                  onClick={() => void giveBack(loan.id)}
                >
                  <RotateCcw size={14} aria-hidden /> {t("Marcar devuelto")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {myCopies.length > 0 && otherMembers.length > 0 && (
        <form className="club-loan-form" onSubmit={lend}>
          <strong>{t("Prestar un ejemplar a alguien del club")}</strong>
          <label>
            {t("Ejemplar")}
            <select name="listingId" required>
              {myCopies.map((copy) => (
                <option key={copy.id} value={copy.id}>
                  {copy.title} · {t(copy.condition)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Quién lo recibe")}
            <select name="borrowerId" required>
              {otherMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Fecha de devolución (opcional)")}
            <input type="date" name="dueAt" />
          </label>
          <button type="submit" className="share-button small" disabled={busy}>
            {t("Prestar")}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
