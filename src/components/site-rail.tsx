"use client";

import Link from "next/link";
import { ArrowDownUp, BookOpen, Compass, Heart, Lock, Users } from "lucide-react";
import type { SessionUser } from "@/lib/domain";
import { BRAND_FIRST, BRAND_SECOND } from "@/lib/brand";
import { AccountMenu } from "./account-menu";
import { useI18n } from "./i18n-provider";

export type RailSection = "clubes" | "listas" | "lectores" | "obra" | "perfil" | "admin";

/**
 * Barra lateral de las páginas que no viven dentro del catálogo. Mantiene la
 * misma navegación y el mismo lenguaje visual que la app para que cambiar de
 * sección no parezca cambiar de producto.
 */
export function SiteRail({ user, section }: { user: SessionUser | null; section: RailSection }) {
  const { t } = useI18n();
  const itemClass = (active: boolean) => (active ? "nav-item active" : "nav-item");

  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">
          <BookOpen size={20} strokeWidth={2.2} />
        </span>
        <span>
          {BRAND_FIRST}
          <b>{BRAND_SECOND}</b>
        </span>
      </Link>

      <nav className="primary-nav" aria-label={t("Navegación principal")}>
        <Link className={itemClass(false)} href="/descubrir">
          <Compass size={18} />
          <span>{t("Descubrir")}</span>
        </Link>
        <Link className={itemClass(false)} href="/estanteria">
          {user ? <Heart size={18} /> : <Lock size={18} />}
          <span>{t("Mi estantería")}</span>
        </Link>
        <Link className={itemClass(false)} href="/intercambios">
          {user ? <ArrowDownUp size={18} /> : <Lock size={18} />}
          <span>{t("Intercambios")}</span>
        </Link>
      </nav>

      <nav className="primary-nav" aria-label={t("Comunidad")}>
        <Link
          className={itemClass(
            section === "clubes" || section === "listas" || section === "lectores"
          )}
          href="/comunidad"
        >
          {user ? <Users size={18} /> : <Lock size={18} />}
          <span>{t("Comunidad")}</span>
        </Link>
      </nav>

      <AccountMenu user={user} />
    </aside>
  );
}
