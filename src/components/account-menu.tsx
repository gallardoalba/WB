"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronDown,
  LogIn,
  LogOut,
  Settings,
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
  onOpenNotifications?: () => void;
  onOpenAuth?: () => void;
  onLoggedOut?: () => void;
  variant?: "sidebar" | "topbar";
};

/**
 * Punto único de cuenta: perfil, ajustes, avisos, administración y salida.
 * La cuenta tiene página propia (`/cuenta`); aquí solo se enlaza.
 */
export function AccountMenu({
  user,
  unreadNotifications = 0,
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const authHref = `/?auth=1&next=${encodeURIComponent(pathname || "/")}`;

  // Al abrir, el foco entra en el primer elemento: el menú es operable con
  // teclado y los lectores de pantalla anuncian el rol correcto.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (position: number) =>
      items[(position + items.length) % items.length]?.focus();

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(current < 0 ? items.length - 1 : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(items.length - 1);
    } else if (event.key === "Tab") {
      // Un menú no se recorre con Tab: se cierra y el foco sigue su camino.
      setOpen(false);
    }
  }

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
          <strong>{t("Entrar")}</strong>
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
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={variant === "topbar" ? t("Abrir menú de cuenta") : undefined}
        onClick={() => {
          setError("");
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
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
        <div
          ref={panelRef}
          className="account-menu-panel"
          role="menu"
          aria-label={t("Cuenta")}
          onKeyDown={handleMenuKeyDown}
        >
          <Link
            className="account-menu-item"
            role="menuitem"
            href={`/u/${user.id}`}
            onClick={() => setOpen(false)}
          >
            <User size={15} /> {t("Mi perfil")}
          </Link>
          <Link
            className="account-menu-item"
            role="menuitem"
            href="/cuenta"
            onClick={() => setOpen(false)}
          >
            <Settings size={15} /> {t("Cuenta")}
          </Link>
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
