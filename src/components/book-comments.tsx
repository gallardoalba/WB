"use client";

import { useActionState, useLayoutEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyeOff, Heart, MessageCircle, Reply, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client-api";
import { REPORT_REASONS, type BookCommentView } from "@/lib/domain";
import { formatWhen, initialsOf, toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type Props = {
  bookId: string;
  initialComments: BookCommentView[];
  initialHasMore: boolean;
  total: number;
  isAuthenticated: boolean;
};

type CommentPage = { comments: BookCommentView[]; hasMore: boolean; total: number };

const MAX_LENGTH = 800;

/** Un comentario se pinta igual en el hilo principal y en las respuestas. */
function CommentBody({ comment }: { comment: BookCommentView }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(!comment.spoiler);
  const [spoilerText, setSpoilerText] = useState("");
  const [spoilerError, setSpoilerError] = useState("");

  async function reveal() {
    setRevealed(true);
    if (comment.body || spoilerText) return;
    try {
      const data = await api<{ body: string }>(`/api/comments/${comment.id}/body`);
      setSpoilerText(data.body);
    } catch (caught) {
      setSpoilerError(caught instanceof Error ? caught.message : t("No se pudo cargar el texto."));
    }
  }

  if (comment.deleted) {
    return <p className="comment-deleted">{t("Comentario eliminado por quien lo escribió.")}</p>;
  }

  return (
    <>
      {comment.spoiler && !revealed ? (
        <button type="button" className="spoiler-cover" onClick={reveal}>
          <TriangleAlert size={14} /> {t("Contiene spoilers. Pulsa para leerlo.")}
        </button>
      ) : (
        <p className="comment-text">{comment.body || spoilerText}</p>
      )}
      {revealed && !comment.body && !spoilerText && !spoilerError && (
        <p className="comment-text">{t("Cargando…")}</p>
      )}
      {spoilerError && (
        <p className="form-error" role="alert">
          {spoilerError}
        </p>
      )}
      {comment.hidden && (
        <p className="comment-hidden">
          <EyeOff size={13} /> {t("Oculto por moderación: solo lo ves tú.")}
        </p>
      )}
    </>
  );
}

/** Denuncia de un comentario concreto, plegada para no ensuciar el hilo. */
function CommentReport({ commentId }: { commentId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Los campos van sin controlar y los lee la propia acción: así el formulario
  // no necesita un estado por campo ni un `pending` que apagar a mano.
  const [estado, denunciar, enviando] = useActionState(
    async (_previo: { error: string; enviada: boolean }, formData: FormData) => {
      try {
        await api("/api/reports", {
          method: "POST",
          body: {
            targetType: "comment",
            targetId: commentId,
            reason: String(formData.get("reason") ?? REPORT_REASONS[0]),
            details: String(formData.get("details") ?? ""),
          },
        });
        return { error: "", enviada: true };
      } catch (caught) {
        return {
          error: caught instanceof Error ? caught.message : t("No se pudo enviar la denuncia."),
          enviada: false,
        };
      }
    },
    { error: "", enviada: false },
  );

  if (estado.enviada) {
    return <span className="comment-action">{t("Denuncia enviada, gracias")}</span>;
  }

  return (
    <div className="comment-report">
      <button
        type="button"
        className="comment-action"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <TriangleAlert size={13} /> {t("Denunciar")}
      </button>
      {open && (
        <form action={denunciar}>
          <label className="sr-only" htmlFor={`reason-${commentId}`}>
            {t("Motivo de la denuncia")}
          </label>
          <select id={`reason-${commentId}`} name="reason" defaultValue={REPORT_REASONS[0]}>
            {REPORT_REASONS.map((option) => (
              <option key={option} value={option}>
                {t(option)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor={`details-${commentId}`}>
            {t("Detalles")}
          </label>
          <input
            id={`details-${commentId}`}
            name="details"
            maxLength={500}
            placeholder={t("¿Qué ocurre? (opcional)")}
          />
          <button type="submit" className="secondary-button small" disabled={enviando}>
            {t("Enviar")}
          </button>
          {estado.error && (
            <span className="form-error" role="alert">
              {estado.error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

export function BookComments({
  bookId,
  initialComments,
  initialHasMore,
  total,
  isAuthenticated,
}: Props) {
  const { t, locale } = useI18n();  const pathname = usePathname();  const [comments, setComments] = useState(initialComments);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [count, setCount] = useState(total);
  const [body, setBody] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const reset = () => {
    setError("");
    setFeedback("");
  };

  // Next mantiene vivas hasta tres rutas con `<Activity>`: al volver a la
  // ficha, el aviso de la visita anterior («Comentario publicado.») seguía en
  // pantalla, y el hueco de respuesta abierto. Se limpian al ocultarse; lo
  // escrito en el formulario se queda, que para eso está guardado.
  useLayoutEffect(() => {
    return () => {
      setError("");
      setFeedback("");
      setReplyTo(null);
      setReplyBody("");
    };
  }, []);

  /**
   * Publicar es una acción de formulario: React la envuelve en una transición y
   * da el «publicando» sin un `pending` a mano (antes había un `finally` que, si
   * se olvidaba, dejaba el botón muerto). El estado que devuelve no se usa
   * porque los avisos van a `feedback`/`error`, que comparte con borrar y con
   * «me gusta».
   */
  const [, publicar, publicando] = useActionState(async () => {
    const text = body.trim();
    if (text.length < 2) {
      setError(t("Escribe al menos 2 caracteres."));
      return null;
    }
    reset();
    try {
      const data = await api<{ comment: BookCommentView }>(`/api/books/${bookId}/comments`, {
        method: "POST",
        body: { body: text, spoiler },
      });
      setComments((current) => [data.comment, ...current]);
      setCount((current) => current + 1);
      setBody("");
      setSpoiler(false);
      setFeedback(t("Comentario publicado."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo publicar el comentario."));
    }
    return null;
  }, null);

  async function submitReply(event: FormEvent<HTMLFormElement>, parentId: string) {
    event.preventDefault();
    const text = replyBody.trim();
    if (text.length < 2) {
      setError(t("Escribe al menos 2 caracteres."));
      return;
    }
    setPending(true);
    reset();
    try {
      const data = await api<{ comment: BookCommentView }>(`/api/books/${bookId}/comments`, {
        method: "POST",
        body: { body: text, parentId },
      });
      setComments((current) =>
        current.map((item) =>
          item.id === parentId ? { ...item, replies: [...item.replies, data.comment] } : item,
        ),
      );
      setReplyBody("");
      setReplyTo(null);
      setFeedback(t("Respuesta publicada."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo responder."));
    } finally {
      setPending(false);
    }
  }

  async function remove(commentId: string, parentId: string | null) {
    setPending(true);
    reset();
    try {
      await api(`/api/comments/${commentId}`, { method: "DELETE" });
      setComments((current) =>
        parentId
          ? current.map((item) =>
              item.id === parentId
                ? { ...item, replies: item.replies.filter((reply) => reply.id !== commentId) }
                : item,
            )
          : current.filter((item) => item.id !== commentId),
      );
      if (!parentId) setCount((current) => Math.max(0, current - 1));
      setFeedback(t("Comentario borrado."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo borrar el comentario."));
    } finally {
      setPending(false);
    }
  }

  async function toggleLike(target: BookCommentView, parentId: string | null) {
    const next = !target.likedByMe;
    reset();
    try {
      const data = await api<{ likes: number; likedByMe: boolean }>(
        `/api/comments/${target.id}/like`,
        { method: "POST", body: { liked: next } },
      );
      const patch = (item: BookCommentView): BookCommentView =>
        item.id === target.id ? { ...item, likes: data.likes, likedByMe: data.likedByMe } : item;
      setComments((current) =>
        parentId
          ? current.map((item) =>
              item.id === parentId ? { ...item, replies: item.replies.map(patch) } : item,
            )
          : current.map(patch),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo guardar el me gusta."));
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    reset();
    try {
      const last = comments[comments.length - 1];
      const data = await api<CommentPage>(
        `/api/books/${bookId}/comments?before=${encodeURIComponent(last?.id ?? "")}`,
      );
      setComments((current) => [...current, ...data.comments]);
      setHasMore(data.hasMore);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudieron cargar más comentarios."));
    } finally {
      setLoadingMore(false);
    }
  }

  const renderComment = (comment: BookCommentView, parentId: string | null) => (
    <article className="comment" id={`c-${comment.id}`} key={comment.id}>
      <span className={`avatar comment-avatar tone-${toneForId(comment.author.id || comment.id)}`}>
        {initialsOf(comment.author.name || "?")}
      </span>
      <div className="comment-copy">
        <div className="comment-head">
          {comment.authorAnonymous ? (
            <span className="comment-author">{t("Una persona de la comunidad")}</span>
          ) : (
            <Link href={`/u/${comment.author.id}`} className="comment-author">
              {comment.author.name}
            </Link>
          )}
          <span>
            {comment.author.city && <>{comment.author.city} · </>}
            {formatWhen(comment.createdAt, locale)}
          </span>
        </div>
        <CommentBody comment={comment} />
        <div className="comment-actions">
          <button
            type="button"
            className={comment.likedByMe ? "comment-action liked" : "comment-action"}
            disabled={!isAuthenticated}
            onClick={() => toggleLike(comment, parentId)}
            aria-pressed={comment.likedByMe}
          >
            <Heart size={13} /> {comment.likes > 0 ? comment.likes : ""} {t("Me gusta")}
          </button>
          {isAuthenticated && !parentId && !comment.deleted && (
            <button
              type="button"
              className="comment-action"
              onClick={() => {
                setReplyTo(replyTo === comment.id ? null : comment.id);
                setReplyBody("");
              }}
            >
              <Reply size={13} /> {t("Responder")}
            </button>
          )}
          {comment.canDelete && (
            <button
              type="button"
              className="comment-action danger"
              disabled={pending}
              onClick={() => remove(comment.id, parentId)}
            >
              <Trash2 size={13} /> {t("Borrar")}
            </button>
          )}
          {isAuthenticated && !comment.isMine && !comment.deleted && (
            <CommentReport commentId={comment.id} />
          )}
        </div>

        {replyTo === comment.id && (
          <form className="comment-reply" onSubmit={(event) => submitReply(event, comment.id)}>
            <label className="sr-only" htmlFor={`reply-${comment.id}`}>
              {t("Responder a {name}", { name: comment.author.name })}
            </label>
            <textarea
              id={`reply-${comment.id}`}
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              maxLength={MAX_LENGTH}
              rows={2}
              placeholder={t("Responde a {name}", { name: comment.author.name })}
              required
            />
            <div className="comment-reply-actions">
              <button type="submit" className="secondary-button small" disabled={pending}>
                {t("Enviar respuesta")}
              </button>
              <button
                type="button"
                className="comment-action"
                onClick={() => setReplyTo(null)}
                disabled={pending}
              >
                {t("Cancelar")}
              </button>
            </div>
          </form>
        )}

        {comment.replies.length > 0 && (
          <div className="comment-replies">
            {comment.replies.map((reply) => (
              <article className="comment comment-reply-item" key={reply.id} id={`c-${reply.id}`}>
                <span className={`avatar comment-avatar tone-${toneForId(reply.author.id || reply.id)}`}>
                  {initialsOf(reply.author.name || "?")}
                </span>
                <div className="comment-copy">
                  <div className="comment-head">
                    {reply.authorAnonymous ? (
                      <span className="comment-author">{t("Una persona de la comunidad")}</span>
                    ) : (
                      <Link href={`/u/${reply.author.id}`} className="comment-author">
                        {reply.author.name}
                      </Link>
                    )}
                    <span>
                      {reply.author.city && <>{reply.author.city} · </>}
                      {formatWhen(reply.createdAt, locale)}
                    </span>
                  </div>
                  <CommentBody comment={reply} />
                  <div className="comment-actions">
                    <button
                      type="button"
                      className={reply.likedByMe ? "comment-action liked" : "comment-action"}
                      disabled={!isAuthenticated}
                      onClick={() => toggleLike(reply, comment.id)}
                      aria-pressed={reply.likedByMe}
                    >
                      <Heart size={13} /> {reply.likes > 0 ? reply.likes : ""} {t("Me gusta")}
                    </button>
                    {reply.canDelete && (
                      <button
                        type="button"
                        className="comment-action danger"
                        disabled={pending}
                        onClick={() => remove(reply.id, comment.id)}
                      >
                        <Trash2 size={13} /> {t("Borrar")}
                      </button>
                    )}
                    {isAuthenticated && !reply.isMine && !reply.deleted && (
                      <CommentReport commentId={reply.id} />
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </article>
  );

  return (
    <section className="comments" id="comentarios" aria-labelledby="comments-title">
      <div className="comments-head">
        <h2 id="comments-title">
          <MessageCircle size={18} /> {t("Conversación sobre este libro")}
        </h2>
        <span className="comments-count">
          {count === 1 ? t("1 comentario") : t("{n} comentarios", { n: count })}
        </span>
      </div>

      {isAuthenticated ? (
        <form className="comment-form" action={publicar}>
          <label className="sr-only" htmlFor="comment-body">
            {t("Tu comentario")}
          </label>
          <textarea
            id="comment-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={MAX_LENGTH}
            rows={3}
            placeholder={t("¿Lo has leído? Cuenta qué te pareció, sin destripar el final.")}
            required
          />
          <div className="comment-form-footer">
            <label className="comment-spoiler">
              <input
                type="checkbox"
                checked={spoiler}
                onChange={(event) => setSpoiler(event.target.checked)}
              />{" "}
              {t("Contiene spoilers")}
            </label>
            <span className="comment-remaining">
              {t("{n} caracteres", { n: MAX_LENGTH - body.length })}
            </span>
            <button className="share-button small" type="submit" disabled={publicando}>
              {t("Publicar comentario")}
            </button>
          </div>
        </form>
      ) : (
        <p className="comments-signin">
          <Link href={`/?auth=1&next=${encodeURIComponent(pathname || "/")}`}>
            {t("Entra en tu cuenta")}
          </Link>{" "}
          {t("para comentar este libro.")}
        </p>
      )}

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

      {comments.length === 0 ? (
        <p className="empty-note">
          {t("Todavía no hay comentarios sobre este libro. Tu opinión puede abrir la conversación.")}
        </p>
      ) : (
        <div className="comment-list">{comments.map((comment) => renderComment(comment, null))}</div>
      )}

      {hasMore && (
        <button
          type="button"
          className="secondary-button small load-more"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? t("Cargando…") : t("Ver comentarios anteriores")}
        </button>
      )}
    </section>
  );
}
