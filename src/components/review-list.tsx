"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { api } from "@/lib/client-api";
import type { ReviewView } from "@/lib/domain";
import { formatWhen } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type Props = {
  reviews: ReviewView[];
  targetName: string;
  canReport: boolean;
  viewerId: string | null;
};

export function ReviewList({ reviews, targetName, canReport, viewerId }: Props) {
  const { t, locale } = useI18n();
  const [reported, setReported] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function report(reviewId: string) {
    setBusy(reviewId);
    setError("");
    try {
      await api("/api/reports", {
        method: "POST",
        body: {
          targetType: "review",
          targetId: reviewId,
          reason: "Contenido inapropiado",
          details: "Valoración denunciada desde el perfil.",
        },
      });
      setReported((current) => [...current, reviewId]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar la denuncia."));
    } finally {
      setBusy(null);
    }
  }

  if (reviews.length === 0) {
    return <p className="empty-note">{t("Todavía no hay valoraciones de {name}.", { name: targetName })}</p>;
  }

  return (
    <div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ul className="review-list">
        {reviews.map((review) => (
          <li key={review.id} className="review-row">
            <span className="review-score" aria-label={t("{n} de 5", { n: review.rating })}>
              <Star size={14} aria-hidden="true" /> {review.rating}/5
            </span>
            <div>
              <strong>{review.authorName}</strong>
              <span className="review-when">{formatWhen(review.createdAt, locale)}</span>
              {review.comment && <p>{review.comment}</p>}
              {canReport &&
                review.authorId !== viewerId &&
                (reported.includes(review.id) ? (
                  <span className="review-footnote">{t("Denuncia enviada. Gracias.")}</span>
                ) : (
                  <button
                    type="button"
                    className="message-report"
                    disabled={busy === review.id}
                    onClick={() => report(review.id)}
                  >
                    {t("Denunciar valoración")}
                  </button>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
