"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  Check,
  Copy,
  Pencil,
  Plus,
  Share2,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { BookPicker } from "./book-picker";
import { CityField } from "./city-field";
import { ConfirmDialog } from "./confirm-dialog";
import { Dialog } from "./dialog";
import {
  REPORT_REASONS,
  type ClubPostReportView,
  type ClubRequestView,
  type ClubView,
} from "@/lib/domain";
import { formatWhen } from "@/lib/text";
import { useI18n } from "./i18n-provider";

/** Alta de un club de lectura: la conversación vive en el hilo del libro. */
export function ClubCreate({
  defaultCity,
  book,
}: {
  defaultCity: string;
  book?: { id: string; title: string; author: string } | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(Boolean(book));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setFeedback("");
    try {
      await api("/api/clubs", {
        method: "POST",
        body: {
          name: form.get("name"),
          city: form.get("city"),
          description: form.get("description") ?? "",
          meetsOn: form.get("meetsOn") ?? "",
          meetsAt: form.get("meetsAt") ?? "",
          joinPolicy: form.get("joinPolicy") ?? "open",
          bookId: book?.id,
          meetsPlace: form.get("meetsPlace") ?? "",
          meetsLink: form.get("meetsLink") ?? "",
        },
      });
      setFeedback(t("Club creado. Ya aparece en la lista."));
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo crear el club."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="club-create">
      <button type="button" className="share-button small" onClick={() => setOpen((v) => !v)}>
        <Plus size={15} /> {t("Crear un club")}
      </button>
      {feedback && (
        <p className="action-feedback" role="status">
          {feedback}
        </p>
      )}
      {open && (
        <form className="club-form" onSubmit={submit}>
          <label>
            {t("Nombre")}
            <input name="name" required minLength={3} maxLength={60} placeholder={t("Club de los martes")} />
          </label>
          <div className="field">
            <label htmlFor="club-city">{t("Ciudad")}</label>
            <CityField id="club-city" name="city" defaultValue={defaultCity} required />
          </div>
          <label>
            {t("Horario habitual (opcional)")}
            <input name="meetsOn" maxLength={80} placeholder={t("Último jueves de mes, 19:00")} />
            <small className="form-hint">
              {t("Texto libre para el día y la hora que soléis quedar.")}
            </small>
          </label>
          <label>
            {t("Próximo encuentro (opcional)")}
            <input name="meetsAt" type="datetime-local" />
            <small className="form-hint">
              {t("Fecha y hora concretas; se avisa a quienes asisten.")}
            </small>
          </label>
          <label>
            {t("Dónde os veis (opcional)")}
            <input name="meetsPlace" maxLength={120} placeholder={t("Cafetería Central, sala 2")} />
          </label>
          <label>
            {t("Enlace del encuentro (opcional)")}
            <input name="meetsLink" type="url" maxLength={300} placeholder="https://meet.example.com/…" />
            <small className="form-hint">{t("Para quien no pueda venir en persona.")}</small>
          </label>
          <label>
            {t("Quién puede entrar")}
            <select name="joinPolicy" defaultValue="open">
              <option value="open">{t("Cualquier lector")}</option>
              <option value="approval">{t("Con mi aprobación")}</option>
            </select>
          </label>
          <label>
            {t("Descripción")}
            <textarea name="description" rows={2} maxLength={280} placeholder={t("¿Qué os gusta leer?")} />
          </label>
          {book && (
            <p className="club-book-note">
              {t("Lectura inicial")}: <strong>{book.title}</strong> {t("de")} {book.author}
            </p>
          )}
          <button type="submit" className="share-button small" disabled={pending}>
            {t("Crear club")}
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

/** Unirse, pedir entrada o salir de un club. */
export function ClubJoin({ club }: { club: ClubView }) {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = useState<ClubView["myStatus"]>(club.myStatus);
  const [members, setMembers] = useState(club.members);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function toggle() {
    const next = status === "none";
    setPending(true);
    setError("");
    try {
      const data = await api<{
        member: boolean;
        status: ClubView["myStatus"];
        members: number;
      }>(`/api/clubs/${club.id}/membership`, { method: "POST", body: { joined: next } });
      setStatus(data.status);
      setMembers(data.members);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPending(false);
    }
  }

  // Quien creó el club no puede salir: antes se le ofrecía el mismo botón que a
  // los demás y al pulsarlo recibía un 409.
  if (club.isMine) {
    return (
      <div className="club-join">
        {/* El número de miembros ya está en la cabecera: aquí no se repite. */}
        <span className="club-owner">
          <UserCheck size={14} /> {t("Lo diriges tú")}
        </span>
      </div>
    );
  }

  const label =
    status === "member"
      ? `${t("En el club")} · ${members}`
      : status === "pending"
        ? t("Solicitud enviada")
        : club.joinPolicy === "approval"
          ? `${t("Pedir entrar")} · ${members}`
          : `${t("Unirme")} · ${members}`;

  return (
    <div className="club-join">
      <button
        type="button"
        className={status === "none" ? "secondary-button small" : "secondary-button small following"}
        disabled={pending}
        aria-pressed={status !== "none"}
        onClick={() => (status === "member" ? setConfirmLeave(true) : void toggle())}
      >
        {status === "none" ? <UserPlus size={14} /> : <UserCheck size={14} />}
        {label}
      </button>
      {status === "pending" && <span className="club-owner">{t("Espera aprobación")}</span>}
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
      {/* Salir deja de ser un clic accidental: se pierde el acceso al foro. */}
      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          void toggle();
        }}
        title={t("Salir del club")}
        description={t(
          "Dejarás de ver el foro y la votación de «{name}». Podrás volver a pedir entrada si hay sitio.",
          { name: club.name },
        )}
        confirmLabel={t("Salir del club")}
        pending={pending}
      />
    </div>
  );
}

/**
 * Moderación del club: los mensajes del foro que alguien ha denunciado.
 *
 * Quien lleva el club no tenía dónde ver esto —solo el panel de administración
 * se enteraba—, así que un mensaje denunciado se quedaba ahí sin que nadie del
 * club pudiera quitarlo. Aquí se decide en el sitio: se lee el mensaje y, si
 * procede, se borra (lo que además cierra la denuncia).
 */
export function ClubReports({
  clubId,
  reports,
}: {
  clubId: string;
  reports: ClubPostReportView[];
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [borrando, setBorrando] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function borrar(postId: string) {
    setPending(true);
    setError("");
    try {
      await api(`/api/clubs/${clubId}/posts/${postId}`, { method: "DELETE" });
      setBorrando(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo borrar el mensaje."));
    } finally {
      setPending(false);
    }
  }

  if (reports.length === 0) {
    return <p className="empty-note">{t("Ningún mensaje denunciado ahora mismo.")}</p>;
  }

  return (
    <div className="club-reports">
      <ul>
        {reports.map((report) => (
          <li key={report.id}>
            <blockquote>
              {report.post.body.length > 160
                ? `${report.post.body.slice(0, 159)}…`
                : report.post.body}
            </blockquote>
            <p className="club-report-meta">
              {t("Escrito por {name}", { name: report.post.author })} ·{" "}
              {t("denunciado por {name}", { name: report.reporter.name })} ·{" "}
              {t(report.reason)} · {formatWhen(report.createdAt, locale)}
            </p>
            {borrando === report.post.id ? (
              <div className="club-report-confirm">
                <p>{t("¿Seguro que quieres borrar este mensaje? No se puede deshacer.")}</p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary-button small"
                    onClick={() => setBorrando(null)}
                    disabled={pending}
                  >
                    {t("No, dejarlo")}
                  </button>
                  <button
                    type="button"
                    className="share-button small danger"
                    onClick={() => void borrar(report.post.id)}
                    disabled={pending}
                  >
                    <Trash2 size={14} /> {t("Sí, borrar el mensaje")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="club-report-actions">
                <Link href={`/clubes/${clubId}#c-${report.post.id}`} className="comment-action">
                  {t("Ver en el foro")}
                </Link>
                <button
                  type="button"
                  className="comment-action danger"
                  onClick={() => setBorrando(report.post.id)}
                >
                  <Trash2 size={14} /> {t("Borrar el mensaje")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Ajustes del club en una ventana propia.
 *
 * Antes eran un formulario plegable al final de la página y el cierre del club
 * vivía en un botón aparte, a su lado: dos acciones del mismo dueño separadas y
 * fuera de la vista al entrar. Ahora hay **un solo botón, arriba**, que abre un
 * diálogo con todo —incluida la zona de peligro, en dos pasos— para que cerrar
 * el club no esté a un clic accidental ni escondido al pie.
 */
export function ClubSettings({ club }: { club: ClubView }) {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // La lectura se elige del catálogo entero, no solo de los libros que ya tiene
  // publicados quien creó el club.
  const [lectura, setLectura] = useState(club.book);

  function cerrar() {
    setOpen(false);
    setConfirming(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bookId = String(form.get("bookId") ?? "");
    setPending(true);
    setError("");
    try {
      await api(`/api/clubs/${club.id}`, {
        method: "PATCH",
        body: {
          name: form.get("name"),
          description: form.get("description") ?? "",
          meetsOn: form.get("meetsOn") ?? "",
          meetsAt: form.get("meetsAt") ?? "",
          meetsPlace: form.get("meetsPlace") ?? "",
          meetsLink: form.get("meetsLink") ?? "",
          joinPolicy: form.get("joinPolicy") ?? "open",
          progress: Number(form.get("progress") ?? 0),
          progressNote: form.get("progressNote") ?? "",
          bookId: bookId || null,
        },
      });
      setDone(true);
      cerrar();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo guardar el club."));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    setError("");
    try {
      await api(`/api/clubs/${club.id}`, { method: "DELETE" });
      router.push("/clubes");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo cerrar el club."));
      setPending(false);
    }
  }

  return (
    <div className="club-settings">
      <button type="button" className="secondary-button small" onClick={() => setOpen(true)}>
        <Pencil size={14} /> {t("Editar club")}
      </button>
      {done && (
        <p className="action-feedback" role="status">
          {t("Club actualizado.")}
        </p>
      )}

      <Dialog
        open={open}
        onClose={cerrar}
        title={t("Editar club")}
        description={t("Nombre, encuentros, lectura en curso y quién puede entrar.")}
        overline={club.name}
        wide
      >
        <form className="club-form is-dialog" onSubmit={submit}>
          <label>
            {t("Nombre")}
            <input name="name" defaultValue={club.name} required minLength={3} maxLength={60} />
          </label>
          <label>
            {t("Descripción")}
            <textarea name="description" defaultValue={club.description} rows={2} maxLength={280} />
          </label>
          <label>
            {t("Cuándo os veis")}
            <input name="meetsOn" defaultValue={club.meetsOn} maxLength={80} />
          </label>
          <label>
            {t("Próximo encuentro")}
            <input
              name="meetsAt"
              type="datetime-local"
              defaultValue={club.meetsAt ? club.meetsAt.slice(0, 16) : ""}
            />
          </label>
          <label>
            {t("Dónde os veis")}
            <input
              name="meetsPlace"
              defaultValue={club.meetsPlace}
              maxLength={120}
              placeholder={t("Cafetería Central, sala 2")}
            />
          </label>
          <label>
            {t("Enlace del encuentro (opcional)")}
            <input
              name="meetsLink"
              type="url"
              defaultValue={club.meetsLink}
              maxLength={300}
              placeholder="https://meet.example.com/…"
            />
            <small className="form-hint">{t("Para quien no pueda venir en persona.")}</small>
          </label>
          <label>
            {t("Quién puede entrar")}
            <select name="joinPolicy" defaultValue={club.joinPolicy}>
              <option value="open">{t("Cualquier lector")}</option>
              <option value="approval">{t("Con mi aprobación")}</option>
            </select>
          </label>
          <div className="club-field">
            <span className="club-field-label">{t("Lectura en curso")}</span>
            <input type="hidden" name="bookId" value={lectura?.id ?? ""} />
            {lectura ? (
              <p className="club-selected-book">
                <span>
                  <strong>{lectura.title}</strong>
                  <small>{lectura.author}</small>
                </span>
                <button
                  type="button"
                  className="comment-action danger"
                  onClick={() => setLectura(null)}
                >
                  <X size={13} /> {t("Quitar")}
                </button>
              </p>
            ) : (
              <p className="empty-note">{t("Sin lectura por ahora.")}</p>
            )}
            <BookPicker onSelect={setLectura} />
          </div>
          <label>
            {t("Progreso de la lectura")} ({club.progress}%)
            <input
              name="progress"
              type="range"
              min={0}
              max={100}
              step={5}
              defaultValue={club.progress}
            />
          </label>
          <label>
            {t("Nota de progreso")}
            <input
              name="progressNote"
              defaultValue={club.progressNote}
              maxLength={80}
              placeholder={t("Capítulo 6 de 12")}
            />
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={cerrar} disabled={pending}>
              {t("Cancelar")}
            </button>
            <button type="submit" className="share-button small" disabled={pending}>
              {t("Guardar cambios")}
            </button>
          </div>

          {/* Zona de peligro: cerrar el club vive aquí, en dos pasos, y no en un
              botón suelto junto a «Editar». */}
          <div className="club-danger">
            <div>
              <strong>{t("Cerrar el club")}</strong>
              <p>
                {t(
                  "Desaparece del directorio y se pierden su foro y sus votaciones. Sus miembros no podrán volver a entrar.",
                )}
              </p>
            </div>
            {confirming ? (
              <div className="club-danger-confirm">
                <p>
                  {t("¿Seguro que quieres cerrar «{name}»? No se puede deshacer.", {
                    name: club.name,
                  })}
                </p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary-button small"
                    onClick={() => setConfirming(false)}
                    disabled={pending}
                  >
                    {t("No, dejarlo")}
                  </button>
                  <button
                    type="button"
                    className="share-button small danger"
                    onClick={() => void remove()}
                    disabled={pending}
                  >
                    <Trash2 size={14} /> {t("Sí, cerrar el club")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="secondary-button small danger"
                onClick={() => setConfirming(true)}
                disabled={pending}
              >
                <Trash2 size={14} /> {t("Cerrar el club")}
              </button>
            )}
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Asistencia al próximo encuentro: solo miembros y solo si hay fecha. */
export function ClubAttendance({ club }: { club: ClubView }) {
  const router = useRouter();
  const { t } = useI18n();
  const [attending, setAttending] = useState(club.attending);
  const [attendees, setAttendees] = useState(club.attendees);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const hasMeeting = Boolean(club.meetsAt || club.meetsOn);

  async function toggle() {
    setPending(true);
    setError("");
    try {
      const data = await api<{ attending: boolean; attendees: number }>(
        `/api/clubs/${club.id}/attendance`,
        { method: "POST", body: { attending: !attending } },
      );
      setAttending(data.attending);
      setAttendees(data.attendees);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo confirmar la asistencia."));
    } finally {
      setPending(false);
    }
  }

  if (!club.isMember) {
    return (
      <p className="club-meta">
        {attendees === 1 ? t("1 persona va a ir") : t("{n} personas van a ir", { n: attendees })}
      </p>
    );
  }

  return (
    <div className="club-attendance">
      <button
        type="button"
        className={attending ? "share-button small" : "secondary-button small"}
        disabled={pending || !hasMeeting}
        aria-pressed={attending}
        onClick={toggle}
      >
        <CalendarCheck size={14} />
        {attending ? `${t("Voy")} · ${attendees}` : `${t("Voy a ir")} · ${attendees}`}
      </button>
      {!hasMeeting && <span className="club-meta">{t("Aún no hay fecha confirmada.")}</span>}
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Compartir el club por enlace o con alguien a quien sigues. */
export function ClubShare({
  club,
  following,
  extra,
}: {
  club: ClubView;
  following: { id: string; name: string }[];
  /** Controles que acompañan a «Copiar enlace» (gestión de miembros). */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [invitee, setInvitee] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function share() {
    const url = `${window.location.origin}/clubes/${club.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: club.name,
          text: t("Te invito a «{name}»", { name: club.name }),
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      setFeedback(t("Enlace copiado."));
    } catch {
      setError(t("No se pudo compartir. Copia la dirección del navegador."));
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitee) return;
    setPending(true);
    setError("");
    setFeedback("");
    try {
      await api(`/api/clubs/${club.id}/invite`, {
        method: "POST",
        body: { userId: invitee },
      });
      setFeedback(t("Invitación enviada."));
      setInvitee("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo invitar."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="club-share">
      <div className="club-share-actions">
        <button type="button" className="secondary-button small" onClick={() => void share()}>
          <Share2 size={14} /> {t("Compartir club")}
        </button>
        <button
          type="button"
          className="secondary-button small"
          onClick={() =>
            void navigator.clipboard
              .writeText(`${window.location.origin}/clubes/${club.id}`)
              .then(() => setFeedback(t("Enlace copiado.")))
              .catch(() => setError(t("No se pudo copiar el enlace.")))
          }
        >
          <Copy size={14} /> {t("Copiar enlace")}
        </button>
        {extra}
      </div>
      {following.length > 0 && (
        <form className="club-invite" onSubmit={invite}>
          <label>
            {t("Invitar a alguien que sigues")}
            <select value={invitee} onChange={(event) => setInvitee(event.target.value)}>
              <option value="">{t("Elige una persona")}</option>
              {following.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary-button small" disabled={pending || !invitee}>
            <UserPlus size={14} /> {t("Invitar")}
          </button>
        </form>
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
    </div>
  );
}

/** Solicitudes de entrada pendientes: aprobar o rechazar. */
export function ClubRequests({
  clubId,
  requests,
}: {
  clubId: string;
  requests: ClubRequestView[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(userId: string, approve: boolean) {
    setPending(userId);
    setError("");
    try {
      await api(`/api/clubs/${clubId}/requests/${userId}`, {
        method: "POST",
        body: { approve },
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo resolver la solicitud."));
    } finally {
      setPending(null);
    }
  }

  if (requests.length === 0) {
    return <p className="empty-note">{t("No hay solicitudes pendientes.")}</p>;
  }

  return (
    <div className="club-requests">
      <ul>
        {requests.map((request) => (
          <li key={request.user.id}>
            <span>
              <strong>{request.user.name}</strong>
              <small>{request.user.city}</small>
            </span>
            <span className="club-request-actions">
              <button
                type="button"
                className="share-button small"
                disabled={pending === request.user.id}
                onClick={() => void decide(request.user.id, true)}
              >
                <Check size={14} /> {t("Aceptar")}
              </button>
              <button
                type="button"
                className="secondary-button small"
                disabled={pending === request.user.id}
                onClick={() => void decide(request.user.id, false)}
              >
                <X size={14} /> {t("Rechazar")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Gestión de miembros, en un solo sitio: los botones dejaron de repetirse en
 * cada fila de la lista y viven junto a «Copiar enlace», que es donde se busca
 * lo de administrar el club.
 */
export function ClubMembersMenu({
  clubId,
  members,
}: {
  clubId: string;
  members: { id: string; name: string; isModerator: boolean }[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [elegido, setElegido] = useState("");
  const [pendiente, setPendiente] = useState(false);
  const [confirmando, setConfirmando] = useState<null | "quitar" | "ceder">(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const persona = members.find((member) => member.id === elegido);
  const yaModera = Boolean(persona?.isModerator);

  /**
   * Nombra o retira a un moderador sin diálogo: es reversible y no saca a
   * nadie del club, así que confirmarlo sería ruido.
   */
  async function alternarModerador() {
    if (!persona) return;
    setPendiente(true);
    setError("");
    setAviso("");
    try {
      await api(`/api/clubs/${clubId}/moderators`, {
        method: "POST",
        body: { userId: persona.id, moderator: !persona.isModerator },
      });
      setAviso(
        persona.isModerator
          ? t("{name} ya no modera el club.", { name: persona.name })
          : t("{name} ahora modera el club.", { name: persona.name }),
      );
      // La lista de nombres deja de incluir a quien cambia de rol: se recarga.
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPendiente(false);
    }
  }

  async function ejecutar() {
    const accion = confirmando;
    setConfirmando(null);
    if (!persona) return;
    setPendiente(true);
    setError("");
    setAviso("");
    try {
      if (accion === "quitar") {
        await api(`/api/clubs/${clubId}/requests/${persona.id}`, { method: "DELETE" });
        setAviso(t("{name} ya no está en el club.", { name: persona.name }));
      } else {
        await api(`/api/clubs/${clubId}/transfer`, {
          method: "POST",
          body: { userId: persona.id },
        });
        setAviso(t("El club pasa a {name}.", { name: persona.name }));
      }
      setElegido("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPendiente(false);
    }
  }

  return (
    <div className="club-members-menu">
      <button
        type="button"
        className="secondary-button small"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <UserCog size={14} /> {t("Gestionar miembros")}
      </button>
      {open && (
        <div className="club-members-menu-panel">
          <label>
            {t("Elige a quién gestionar")}
            <select value={elegido} onChange={(event) => setElegido(event.target.value)}>
              <option value="">{t("Elige una persona")}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <div className="club-members-menu-actions">
            <button
              type="button"
              className="secondary-button small"
              disabled={!elegido || pendiente}
              onClick={() => void alternarModerador()}
            >
              <ShieldCheck size={14} />{" "}
              {yaModera ? t("Quitar moderador") : t("Hacer moderador")}
            </button>
            <button
              type="button"
              className="secondary-button small danger"
              disabled={!elegido || pendiente}
              onClick={() => setConfirmando("quitar")}
            >
              <Trash2 size={14} /> {t("Retirar del club")}
            </button>
            <button
              type="button"
              className="secondary-button small"
              disabled={!elegido || pendiente}
              onClick={() => setConfirmando("ceder")}
            >
              {t("Ceder el club")}
            </button>
          </div>
          {aviso && (
            <p className="action-feedback" role="status">
              {aviso}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmando !== null}
        onClose={() => setConfirmando(null)}
        onConfirm={() => void ejecutar()}
        title={confirmando === "ceder" ? t("Ceder el club") : t("Retirar del club")}
        description={
          persona && confirmando === "ceder"
            ? t("«{name}» pasará a llevar el club y tú dejarás de poder editarlo.", { name: persona.name })
            : persona
              ? t("«{name}» saldrá del club y dejará de ver el foro.", { name: persona.name })
              : t("Elige primero a una persona.")
        }
        confirmLabel={confirmando === "ceder" ? t("Ceder el club") : t("Retirar del club")}
        pending={pendiente}
      />
    </div>
  );
}

/** Denunciar un club: el nombre y la descripción son contenido público. */
export function ClubReport({ clubId }: { clubId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await api("/api/reports", {
        method: "POST",
        body: {
          targetType: "club",
          targetId: clubId,
          reason: form.get("reason"),
          details: form.get("details") ?? "",
        },
      });
      setDone(true);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar la denuncia."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="report-box">
      <button
        type="button"
        className="secondary-button small"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t("Denunciar club")}
      </button>
      {done && (
        <p className="action-feedback" role="status">
          {t("Gracias. La moderación revisará el club.")}
        </p>
      )}
      {open && (
        <form onSubmit={submit}>
          <label>
            {t("Motivo")}
            <select name="reason" required>
              {REPORT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Detalle (opcional)")}
            <textarea name="details" rows={2} maxLength={500} />
          </label>
          <button type="submit" className="secondary-button small" disabled={pending}>
            {t("Enviar denuncia")}
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
