"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ShieldOff, ShieldCheck, TriangleAlert, UserCheck, UserPlus } from "lucide-react";
import { api } from "@/lib/client-api";
import { REPORT_REASONS } from "@/lib/domain";
import { useI18n } from "./i18n-provider";
import { ConfirmDialog } from "./confirm-dialog";
import { DirectMessageButton } from "./direct-message-button";

export function ProfileActions({
  userId,
  userName,
  isBlocked,
  isFollowing,
  followers,
  isAuthenticated,
  canFollow,
  canMessage = false,
  openMessages = false,
}: {
  userId: string;
  userName: string;
  isBlocked: boolean;
  isFollowing: boolean;
  followers: number;
  isAuthenticated: boolean;
  canFollow: boolean;
  canMessage?: boolean;
  openMessages?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [blocked, setBlocked] = useState(isBlocked);
  const [following, setFollowing] = useState(isFollowing);
  const [followerCount, setFollowerCount] = useState(followers);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [confirmingBlock, setConfirmingBlock] = useState(false);

  async function toggleFollow() {
    const next = !following;
    setPending(true);
    setError("");
    setFeedback("");
    try {
      const data = await api<{ following: boolean; followers: number }>(
        `/api/users/${userId}/follow`,
        { method: "POST", body: { follow: next } },
      );
      setFollowing(data.following);
      setFollowerCount(data.followers);
      setFeedback(
        data.following
          ? t("Sigues a {name}. Sus novedades aparecerán en «Siguiendo».", { name: userName })
          : t("Has dejado de seguir a {name}.", { name: userName }),
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPending(false);
    }
  }

  async function toggleBlock() {
    setPending(true);
    setError("");
    try {
      if (blocked) {
        await api(`/api/blocks?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
        setBlocked(false);
        setFeedback(t("{name} vuelve a ser visible para ti.", { name: userName }));
      } else {
        await api("/api/blocks", { method: "POST", body: { userId } });
        setBlocked(true);
        setFeedback(t("Has bloqueado a {name}. No podréis contactaros.", { name: userName }));
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo completar la acción."));
    } finally {
      setPending(false);
    }
  }

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await api("/api/reports", {
        method: "POST",
        body: {
          targetType: "user",
          targetId: userId,
          reason: form.get("reason"),
          details: form.get("details") ?? "",
        },
      });
      setFeedback(t("Denuncia registrada. Gracias por avisar."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("No se pudo enviar la denuncia."));
    } finally {
      setPending(false);
    }
  }

  if (!isAuthenticated) return null;

  return (
    <div className="profile-actions">
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
      {canFollow && (
        <button
          type="button"
          className={following ? "secondary-button small following" : "share-button small"}
          disabled={pending}
          aria-pressed={following}
          onClick={toggleFollow}
        >
          {following ? <UserCheck size={14} /> : <UserPlus size={14} />}
          {following
            ? t("Siguiendo · {n}", { n: followerCount })
            : t("Seguir · {n}", { n: followerCount })}
        </button>
      )}
      {canMessage && !blocked && (
        <DirectMessageButton
          peerId={userId}
          peerName={userName}
          autoOpen={openMessages}
        />
      )}
      <button
        type="button"
        className="secondary-button small"
        disabled={pending}
        onClick={() => (blocked ? void toggleBlock() : setConfirmingBlock(true))}
      >
        {blocked ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
        {blocked ? t("Desbloquear") : t("Bloquear")}
      </button>
      <details className="report-box">
        <summary>
          <TriangleAlert size={14} /> {t("Denunciar perfil")}
        </summary>
        <form onSubmit={report}>
          <label htmlFor="profile-report-reason">{t("Motivo")}</label>
          <select id="profile-report-reason" name="reason" defaultValue={REPORT_REASONS[0]}>
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(reason)}
              </option>
            ))}
          </select>
          <label htmlFor="profile-report-details">{t("Detalles (opcional)")}</label>
          <textarea id="profile-report-details" name="details" rows={2} maxLength={500} />
          <button type="submit" className="secondary-button small" disabled={pending}>
            {t("Enviar denuncia")}
          </button>
        </form>
      </details>
      <ConfirmDialog
        open={confirmingBlock}
        onClose={() => setConfirmingBlock(false)}
        onConfirm={() => {
          setConfirmingBlock(false);
          void toggleBlock();
        }}
        title={t("Bloquear a {name}", { name: userName })}
        description={t("No volveréis a ver vuestros perfiles ni podréis contactaros. Puedes deshacerlo desde este mismo perfil.")}
        confirmLabel={t("Bloquear")}
        pending={pending}
      />
    </div>
  );
}
