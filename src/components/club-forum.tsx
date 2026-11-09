"use client";

import { useActionState, useLayoutEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Heart, MessagesSquare, Reply, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/client-api";
import { REPORT_REASONS, type ClubPostView } from "@/lib/domain";
import { formatWhen, initialsOf, toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type Props = {
  clubId: string;
  initialPosts: ClubPostView[];
  initialHasMore: boolean;
  total: number;
};

type Page = { posts: ClubPostView[]; hasMore: boolean; total: number };

/** Denuncia de un mensaje del foro, plegada para no ensuciar la conversación. */
function PostReport({ postId }: { postId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Campos sin controlar: los lee la acción del formulario, así que no hace
  // falta un estado por campo ni apagar el botón a mano.
  const [estado, denunciar, enviando] = useActionState(
    async (_previo: { error: string; enviada: boolean }, formData: FormData) => {
      try {
        await api("/api/reports", {
          method: "POST",
          body: {
            targetType: "club_post",
            targetId: postId,
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

  if (estado.enviada) return <span className="comment-action">{t("Denuncia enviada, gracias")}</span>;

  return (
    <div className="comment-report">
      <button
        type="button"
        className="comment-action"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <TriangleAlert size={13} /> {t("Denunciar")}
      </button>
      {open && (
        <form action={denunciar}>
          <label className="sr-only" htmlFor={`motivo-${postId}`}>
            {t("Motivo de la denuncia")}
          </label>
          <select id={`motivo-${postId}`} name="reason" defaultValue={REPORT_REASONS[0]}>
            {REPORT_REASONS.map((option) => (
              <option key={option} value={option}>
                {t(option)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor={`detalle-${postId}`}>
            {t("Detalles")}
          </label>
          <input
            id={`detalle-${postId}`}
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

const MAX_LENGTH = 800;

/**
 * Foro del club: un tablón que solo ven sus miembros, con las mismas piezas que
 * el hilo de un libro (un nivel de respuestas y «me gusta») pero sin mensajes
 * privados: todo lo escrito aquí lo lee el club entero.
 */
export function ClubForum({ clubId, initialPosts, initialHasMore, total }: Props) {
  const { t, locale } = useI18n();
  const [posts, setPosts] = useState(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [count, setCount] = useState(total);
  const [body, setBody] = useState("");
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

  // Al volver al club, los avisos de la visita anterior seguían puestos (Next
  // conserva hasta tres rutas vivas). Se limpian al ocultarse el foro.
  useLayoutEffect(() => {
    return () => {
      setError("");
      setFeedback("");
      setReplyTo(null);
      setReplyBody("");
    };
  }, []);

  /**
   * Publicar es una acción de formulario: la transición y el «publicando» los
   * lleva React. El estado devuelto no se usa porque los avisos van a
   * `feedback`/`error`, compartidos con responder y borrar.
   */
  const [, publicar, publicando] = useActionState(async () => {
    const text = body.trim();
    if (text.length < 2) {
      setError(t("Escribe al menos 2 caracteres."));
      return null;
    }
    reset();
    try {
      const data = await api<{ post: ClubPostView }>(`/api/clubs/${clubId}/posts`, {
        method: "POST",
        body: { body: text },
      });
      setPosts((current) => [data.post, ...current]);
      setCount((current) => current + 1);
      setBody("");
      setFeedback(t("Mensaje publicado."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo publicar el mensaje."));
    }
    return null;
  }, null);

  async function publishReply(event: FormEvent<HTMLFormElement>, parentId: string) {
    event.preventDefault();
    const text = replyBody.trim();
    if (text.length < 2) {
      setError(t("Escribe al menos 2 caracteres."));
      return;
    }
    setPending(true);
    reset();
    try {
      const data = await api<{ post: ClubPostView }>(`/api/clubs/${clubId}/posts`, {
        method: "POST",
        body: { body: text, parentId },
      });
      setPosts((current) =>
        current.map((item) =>
          item.id === parentId ? { ...item, replies: [...item.replies, data.post] } : item,
        ),
      );
      setCount((current) => current + 1);
      setReplyBody("");
      setReplyTo(null);
      setFeedback(t("Respuesta publicada."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo responder."));
    } finally {
      setPending(false);
    }
  }

  async function remove(postId: string, parentId: string | null) {
    setPending(true);
    reset();
    try {
      await api(`/api/clubs/${clubId}/posts/${postId}`, { method: "DELETE" });
      setPosts((current) =>
        parentId
          ? current.map((item) =>
              item.id === parentId
                ? { ...item, replies: item.replies.filter((reply) => reply.id !== postId) }
                : item,
            )
          : current.filter((item) => item.id !== postId),
      );
      setCount((current) => Math.max(0, current - 1));
      setFeedback(t("Mensaje borrado."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo borrar el mensaje."));
    } finally {
      setPending(false);
    }
  }

  async function toggleLike(target: ClubPostView, parentId: string | null) {
    const next = !target.likedByMe;
    reset();
    try {
      const data = await api<{ likes: number; likedByMe: boolean }>(
        `/api/clubs/${clubId}/posts/${target.id}/like`,
        { method: "POST", body: { liked: next } },
      );
      const patch = (item: ClubPostView): ClubPostView =>
        item.id === target.id ? { ...item, likes: data.likes, likedByMe: data.likedByMe } : item;
      setPosts((current) =>
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
      const last = posts[posts.length - 1];
      const page = await api<Page>(
        `/api/clubs/${clubId}/posts?before=${encodeURIComponent(last?.id ?? "")}`,
      );
      setPosts((current) => [...current, ...page.posts]);
      setHasMore(page.hasMore);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudieron cargar más mensajes."));
    } finally {
      setLoadingMore(false);
    }
  }

  const actions = (post: ClubPostView, parentId: string | null) => (
    <div className="comment-actions">
      {/* A tu propio mensaje no se le puede dar me gusta: mejor no ofrecer el
          botón que devolver un error al pulsarlo. */}
      {post.isMine ? (
        <span className="comment-action">
          <Heart size={13} /> {post.likes > 0 ? post.likes : ""} {t("Me gusta")}
        </span>
      ) : (
        <button
          type="button"
          className={post.likedByMe ? "comment-action liked" : "comment-action"}
          onClick={() => void toggleLike(post, parentId)}
          aria-pressed={post.likedByMe}
        >
          <Heart size={13} /> {post.likes > 0 ? post.likes : ""} {t("Me gusta")}
        </button>
      )}
      {!parentId && !post.deleted && (
        <button
          type="button"
          className="comment-action"
          onClick={() => {
            setReplyTo(replyTo === post.id ? null : post.id);
            setReplyBody("");
          }}
        >
          <Reply size={13} /> {t("Responder")}
        </button>
      )}
      {post.canDelete && (
        <button
          type="button"
          className="comment-action danger"
          disabled={pending}
          onClick={() => void remove(post.id, parentId)}
        >
          <Trash2 size={13} /> {t("Borrar")}
        </button>
      )}
      {!post.isMine && !post.deleted && <PostReport postId={post.id} />}
    </div>
  );

  const renderPost = (post: ClubPostView) => (
    <article className="comment" id={`c-${post.id}`} key={post.id}>
      <span className={`avatar comment-avatar tone-${toneForId(post.author.id)}`}>
        {initialsOf(post.author.name)}
      </span>
      <div className="comment-copy">
        <div className="comment-head">
          <Link href={`/u/${post.author.id}`} className="comment-author">
            {post.author.name}
          </Link>
          <span>
            {post.author.city} · {formatWhen(post.createdAt, locale)}
          </span>
        </div>
        {post.deleted ? (
          <p className="comment-deleted">{t("Mensaje eliminado por quien lo escribió.")}</p>
        ) : (
          <p className="comment-text">{post.body}</p>
        )}
        {actions(post, null)}

        {replyTo === post.id && (
          <form className="comment-reply" onSubmit={(event) => void publishReply(event, post.id)}>
            <label className="sr-only" htmlFor={`reply-${post.id}`}>
              {t("Responder a {name}", { name: post.author.name })}
            </label>
            <textarea
              id={`reply-${post.id}`}
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              maxLength={MAX_LENGTH}
              rows={2}
              placeholder={t("Responde a {name}", { name: post.author.name })}
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

        {post.replies.length > 0 && (
          <div className="comment-replies">
            {post.replies.map((reply) => (
              <article className="comment comment-reply-item" key={reply.id} id={`c-${reply.id}`}>
                <span className={`avatar comment-avatar tone-${toneForId(reply.author.id)}`}>
                  {initialsOf(reply.author.name)}
                </span>
                <div className="comment-copy">
                  <div className="comment-head">
                    <Link href={`/u/${reply.author.id}`} className="comment-author">
                      {reply.author.name}
                    </Link>
                    <span>
                      {reply.author.city} · {formatWhen(reply.createdAt, locale)}
                    </span>
                  </div>
                  {reply.deleted ? (
                    <p className="comment-deleted">{t("Mensaje eliminado por quien lo escribió.")}</p>
                  ) : (
                    <p className="comment-text">{reply.body}</p>
                  )}
                  {actions(reply, post.id)}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </article>
  );

  return (
    <section className="comments club-forum" id="foro" aria-labelledby="club-forum-title">
      <div className="comments-head">
        <h2 id="club-forum-title">
          <MessagesSquare size={18} /> {t("Foro del club")}
        </h2>
        <span className="comments-count">
          {count === 1 ? t("1 mensaje") : t("{n} mensajes", { n: count })}
        </span>
      </div>

      <form className="comment-form" action={publicar}>
        <label className="sr-only" htmlFor="club-post-body">
          {t("Tu mensaje para el club")}
        </label>
        <textarea
          id="club-post-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={MAX_LENGTH}
          rows={3}
          placeholder={t("¿Qué queréis comentar de la lectura, del próximo encuentro o del club?")}
          required
        />
        <div className="comment-form-footer">
          <span className="comment-remaining">
            {t("{n} caracteres", { n: MAX_LENGTH - body.length })}
          </span>
          <button className="share-button small" type="submit" disabled={publicando}>
            {t("Publicar mensaje")}
          </button>
        </div>
      </form>

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

      {posts.length === 0 ? (
        <p className="empty-note">
          {t("Todavía no hay mensajes. Abre la conversación con lo que estés leyendo o con una propuesta para el próximo encuentro.")}
        </p>
      ) : (
        <div className="comment-list">{posts.map(renderPost)}</div>
      )}

      {hasMore && (
        <button
          type="button"
          className="secondary-button small load-more"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? t("Cargando…") : t("Ver mensajes anteriores")}
        </button>
      )}
    </section>
  );
}
