"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  Check,
  Copy,
  Pencil,
  Plus,
  Share2,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { CityField } from "./city-field";
import { ConfirmDialog } from "./confirm-dialog";
import { REPORT_REASONS, type ClubRequestView, type ClubView } from "@/lib/domain";
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
          <label>
            {t("Ciudad")}
            <CityField name="city" defaultValue={defaultCity} required />
          </label>
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
        onClick={toggle}
      >
        {status === "none" ? <UserPlus size={14} /> : <UserCheck size={14} />}
        {label}
      </button>
      {club.isMine && <span className="club-owner">{t("Lo creaste tú")}</span>}
      {status === "pending" && <span className="club-owner">{t("Espera aprobación")}</span>}
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Ajustes del club: solo quien lo creó puede cambiar la lectura o borrarlo. */
export function ClubSettings({
  club,
  books,
}: {
  club: ClubView;
  books: { id: string; title: string; author: string }[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
          joinPolicy: form.get("joinPolicy") ?? "open",
          progress: Number(form.get("progress") ?? 0),
          progressNote: form.get("progressNote") ?? "",
          bookId: bookId || null,
        },
      });
      setDone(true);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo guardar el club."));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setConfirming(false);
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
      <div className="club-settings-actions">
        <button type="button" className="secondary-button small" onClick={() => setOpen((v) => !v)}>
          <Pencil size={14} /> {t("Editar club")}
        </button>
        <button
          type="button"
          className="secondary-button small danger"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={14} /> {t("Cerrar club")}
        </button>
      </div>
      {done && (
        <p className="action-feedback" role="status">
          {t("Club actualizado.")}
        </p>
      )}
      {open && (
        <form className="club-form" onSubmit={submit}>
          <label>
            {t("Nombre")}
            <input name="name" defaultValue={club.name} required minLength={3} maxLength={60} />
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
            {t("Quién puede entrar")}
            <select name="joinPolicy" defaultValue={club.joinPolicy}>
              <option value="open">{t("Cualquier lector")}</option>
              <option value="approval">{t("Con mi aprobación")}</option>
            </select>
          </label>
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
          <label>
            {t("Descripción")}
            <textarea name="description" defaultValue={club.description} rows={2} maxLength={280} />
          </label>
          <label>
            {t("Lectura en curso")}
            <select name="bookId" defaultValue={club.book?.id ?? ""}>
              <option value="">{t("Sin lectura por ahora")}</option>
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title} · {book.author}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="share-button small" disabled={pending}>
            {t("Guardar cambios")}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      {!open && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void remove()}
        title={t("Cerrar el club")}
        description={t("«{name}» dejará de aparecer en el directorio y sus miembros no podrán volver a entrar.", { name: club.name })}
        confirmLabel={t("Cerrar club")}
        pending={pending}
      />
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
}: {
  club: ClubView;
  following: { id: string; name: string }[];
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
        await navigator.share({ title: club.name, text: t("Te invito a «{name}»", { name: club.name }), url });
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

/** Acciones del dueño sobre un miembro concreto: retirar o ceder el club. */
export function ClubMemberAdmin({
  clubId,
  userId,
  name,
}: {
  clubId: string;
  userId: string;
  name: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function call(path: string, body?: Record<string, unknown>) {
    setPending(true);
    setError("");
    try {
      await api(path, { method: body ? "POST" : "DELETE", body });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="club-member-admin">
      <button
        type="button"
        className="secondary-button small"
        disabled={pending}
        onClick={() => void call(`/api/clubs/${clubId}/requests/${userId}`)}
      >
        {t("Quitar")}
      </button>
      <button
        type="button"
        className="secondary-button small"
        disabled={pending}
        onClick={() => void call(`/api/clubs/${clubId}/transfer`, { userId })}
      >
        {t("Ceder club a {name}", { name })}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </span>
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
