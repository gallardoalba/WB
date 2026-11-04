"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronDown,
  LogIn,
  LogOut,
  MapPin,
  ShieldCheck,
  User,
} from "lucide-react";
import type { SessionUser } from "@/lib/domain";
import { api } from "@/lib/client-api";
import { initialsOf, toneForId } from "@/lib/text";
import { useI18n } from "./i18n-provider";

type Props = {
  user: SessionUser | null;
  unreadNotifications?: number;
  onOpenProfile?: () => void;
  onOpenNotifications?: () => void;
  onOpenAuth?: () => void;
  onLoggedOut?: () => void;
  variant?: "sidebar" | "topbar";
};

/**
 * Punto único de cuenta: perfil, ciudad/ajustes, avisos, administración y
 * salida. En la app abre los diálogos existentes; en las páginas internas
 * enlaza a la portada con el diálogo solicitado.
 */
export function AccountMenu({
  user,
  unreadNotifications = 0,
  onOpenProfile,
  onOpenNotifications,
  onOpenAuth,
  onLoggedOut,
  variant = "sidebar",
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const authHref = `/?auth=1&next=${encodeURIComponent(pathname || "/")}`;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function logout() {
    setPending(true);
    setError("");
    try {
      await api("/api/auth/logout", { method: "POST" });
      setOpen(false);
      if (onLoggedOut) {
        onLoggedOut();
      } else {
        router.replace("/");
        router.refresh();
      }
    } catch (caught) {
      // Sin este aviso el menú se quedaba abierto sin explicar por qué.
      setError(caught instanceof Error ? caught.message : t("No se pudo cerrar la sesión."));
    } finally {
      setPending(false);
    }
  }

  const triggerClass =
    variant === "topbar" ? "top-avatar account-trigger" : "profile-row account-trigger";

  if (!user) {
    if (variant === "topbar") {
      return onOpenAuth ? (
        <button type="button" className="secondary-button small" onClick={onOpenAuth}>
          {t("Entrar")}
        </button>
      ) : (
        <Link className="secondary-button small" href={authHref}>
          {t("Entrar")}
        </Link>
      );
    }
    const guestBody = (
      <>
        <span className="avatar avatar-you">
          <LogIn size={15} />
        </span>
        <span className="profile-copy">
          <strong>{t("Iniciar sesión")}</strong>
          <small>{t("Guarda y solicita libros")}</small>
        </span>
      </>
    );
    return onOpenAuth ? (
      <button type="button" className="profile-row" onClick={onOpenAuth}>
        {guestBody}
      </button>
    ) : (
      <Link className="profile-row" href={authHref}>
        {guestBody}
      </Link>
    );
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={variant === "topbar" ? t("Abrir menú de cuenta") : undefined}
        onClick={() => {
          setError("");
          setOpen((value) => !value);
        }}
      >
        <span className={`avatar tone-${toneForId(user.id)}`}>{initialsOf(user.name)}</span>
        {variant === "sidebar" && (
          <span className="profile-copy">
            <strong>{user.name}</strong>
            <small>{user.city}</small>
          </span>
        )}
        {variant === "sidebar" && <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="account-menu-panel" role="menu" aria-label={t("Cuenta")}>
          <Link
            className="account-menu-item"
            role="menuitem"
            href={`/u/${user.id}`}
            onClick={() => setOpen(false)}
          >
            <User size={15} /> {t("Mi perfil")}
          </Link>
          {onOpenProfile ? (
            <button
              type="button"
              className="account-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenProfile();
              }}
            >
              <MapPin size={15} /> {t("Cuenta y ciudad")}
            </button>
          ) : (
            <Link
              className="account-menu-item"
              role="menuitem"
              href="/?profile=1"
              onClick={() => setOpen(false)}
            >
              <MapPin size={15} /> {t("Cuenta y ciudad")}
            </Link>
          )}
          {onOpenNotifications ? (
            <button
              type="button"
              className="account-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenNotifications();
              }}
            >
              <Bell size={15} /> {t("Avisos")}
              {unreadNotifications > 0 && (
                <span className="account-menu-badge">{unreadNotifications}</span>
              )}
            </button>
          ) : (
            <Link
              className="account-menu-item"
              role="menuitem"
              href="/?notifications=1"
              onClick={() => setOpen(false)}
            >
              <Bell size={15} /> {t("Avisos")}
              {unreadNotifications > 0 && (
                <span className="account-menu-badge">{unreadNotifications}</span>
              )}
            </Link>
          )}
          {user.isAdmin && (
            <Link
              className="account-menu-item"
              role="menuitem"
              href="/admin"
              onClick={() => setOpen(false)}
            >
              <ShieldCheck size={15} /> {t("Moderación")}
            </Link>
          )}
          <span className="account-menu-separator" />
          {error && (
            <p className="account-menu-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="account-menu-item danger"
            role="menuitem"
            onClick={() => void logout()}
            disabled={pending}
          >
            <LogOut size={15} /> {pending ? t("Saliendo…") : t("Cerrar sesión")}
          </button>
        </div>
      )}
    </div>
  );
}
