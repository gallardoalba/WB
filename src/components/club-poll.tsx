"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Vote, X } from "lucide-react";
import { api } from "@/lib/client-api";
import type { ClubPollView } from "@/lib/domain";
import { BookPicker } from "./book-picker";
import { useI18n } from "./i18n-provider";

type Book = { id: string; title: string; author: string };

/**
 * Votación de la próxima lectura.
 *
 * Quien creó el club propone entre dos y cinco obras del catálogo; los miembros
 * votan una y pueden cambiar el voto mientras siga abierta. Los resultados se
 * ven con nombres: es una decisión del grupo, no una urna secreta.
 */
export function ClubPoll({
  clubId,
  initialPoll,
  canManage,
}: {
  clubId: string;
  initialPoll: ClubPollView | null;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [poll, setPoll] = useState(initialPoll);
  const [creando, setCreando] = useState(false);
  const [pregunta, setPregunta] = useState("");
  const [propuestas, setPropuestas] = useState<Book[]>([]);
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState("");

  async function votar(optionId: string) {
    if (!poll) return;
    setPendiente(true);
    setError("");
    try {
      const data = await api<{ poll: ClubPollView }>(`/api/clubs/${clubId}/polls/${poll.id}/vote`, {
        method: "POST",
        body: { optionId },
      });
      setPoll(data.poll);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo registrar el voto."));
    } finally {
      setPendiente(false);
    }
  }

  async function cerrar() {
    if (!poll) return;
    setPendiente(true);
    setError("");
    try {
      const data = await api<{ poll: ClubPollView }>(
        `/api/clubs/${clubId}/polls/${poll.id}/close`,
        { method: "POST", body: {} },
      );
      setPoll(data.poll);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo cerrar la votación."));
    } finally {
      setPendiente(false);
    }
  }

  async function crear() {
    setPendiente(true);
    setError("");
    try {
      const data = await api<{ poll: ClubPollView }>(`/api/clubs/${clubId}/polls`, {
        method: "POST",
        body: {
          question: pregunta.trim() || t("¿Qué leemos ahora?"),
          bookIds: propuestas.map((book) => book.id),
        },
      });
      setPoll(data.poll);
      setCreando(false);
      setPropuestas([]);
      setPregunta("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo abrir la votación."));
    } finally {
      setPendiente(false);
    }
  }

  const total = poll?.totalVotes ?? 0;

  return (
    <section className="club-panel club-poll" id="votacion">
      <h2>
        <Vote size={16} /> {t("Próxima lectura")}
      </h2>

      {poll ? (
        <>
          <p className="club-poll-question">{poll.question}</p>
          <ul className="club-poll-options">
            {poll.options.map((option) => {
              const votado = poll.votedOptionId === option.id;
              const porcentaje = total > 0 ? Math.round((option.votes / total) * 100) : 0;
              return (
                <li key={option.id} className={votado ? "is-voted" : undefined}>
                  <button
                    type="button"
                    className="club-poll-option"
                    disabled={poll.closed || pendiente}
                    aria-pressed={votado}
                    onClick={() => void votar(option.id)}
                  >
                    <span className="club-poll-bar" aria-hidden>
                      <span style={{ width: `${porcentaje}%` }} />
                    </span>
                    <span className="club-poll-book">
                      <strong>{option.book.title}</strong>
                      <small>{option.book.author}</small>
                    </span>
                    <span className="club-poll-count">
                      {votado && <Check size={13} aria-hidden />} {option.votes}
                    </span>
                  </button>
                  {option.voters.length > 0 && (
                    <small className="club-poll-voters">{option.voters.join(" · ")}</small>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="club-poll-footer">
            <span className="club-meta">
              {total === 1 ? t("1 voto") : t("{n} votos", { n: total })}
              {poll.closed && ` · ${t("Votación cerrada")}`}
            </span>
            {canManage && !poll.closed && (
              <button
                type="button"
                className="secondary-button small"
                disabled={pendiente}
                onClick={() => void cerrar()}
              >
                <X size={14} /> {t("Cerrar votación")}
              </button>
            )}
          </div>
        </>
      ) : canManage ? (
        <div className="club-poll-empty">
          <p className="empty-note">
            {t("Nadie ha propuesto lecturas todavía. Abre una votación con dos o cinco libros.")}
          </p>
          {creando ? (
            <div className="club-poll-form">
              <label>
                {t("Pregunta")}
                <input
                  value={pregunta}
                  onChange={(event) => setPregunta(event.target.value)}
                  maxLength={120}
                  placeholder={t("¿Qué leemos ahora?")}
                />
              </label>
              <BookPicker
                onSelect={(book) =>
                  setPropuestas((current) =>
                    current.some((item) => item.id === book.id) || current.length >= 5
                      ? current
                      : [...current, book],
                  )
                }
              />
              {propuestas.length > 0 && (
                <ul className="club-poll-proposals">
                  {propuestas.map((book) => (
                    <li key={book.id}>
                      <span>
                        <strong>{book.title}</strong>
                        <small>{book.author}</small>
                      </span>
                      <button
                        type="button"
                        className="comment-action danger"
                        onClick={() =>
                          setPropuestas((current) => current.filter((item) => item.id !== book.id))
                        }
                      >
                        <X size={13} /> {t("Quitar")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="club-poll-form-actions">
                <button
                  type="button"
                  className="share-button small"
                  disabled={pendiente || propuestas.length < 2}
                  onClick={() => void crear()}
                >
                  <Plus size={14} /> {t("Abrir votación")}
                </button>
                <button
                  type="button"
                  className="comment-action"
                  onClick={() => {
                    setCreando(false);
                    setPropuestas([]);
                  }}
                >
                  {t("Cancelar")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="secondary-button small"
              onClick={() => setCreando(true)}
            >
              <Plus size={14} /> {t("Proponer lecturas")}
            </button>
          )}
        </div>
      ) : (
        <p className="empty-note">{t("Todavía no hay ninguna votación abierta.")}</p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
