import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AdminReports } from "@/components/admin-reports";
import { AdminSanctions } from "@/components/admin-sanctions";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import {
  countAudit,
  countHiddenClubs,
  countHiddenComments,
  countOpenReports,
  countSuspendedUsers,
  getCommunityMetrics,
  getTotpState,
  listAudit,
  listHiddenClubs,
  listHiddenComments,
  listReports,
  listSuspendedUsers,
} from "@/lib/repo";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Moderación"),
    robots: { index: false, follow: false },
  };
}

const PAGE_SIZE = 25;

const firstValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPage({ searchParams }: PageProps) {
  await connection();
  const user = await requirePageUser("/admin");
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  if (!user?.isAdmin) notFound();
  if (process.env.NODE_ENV === "production" && !getTotpState(user.id).enabled) {
    notFound();
  }

  const raw = await searchParams;
  const page = Math.max(1, Number.parseInt(firstValue(raw.page) ?? "1", 10) || 1);
  // Cada sección pagina por separado: el contenido antiguo sigue siendo
  // alcanzable sin tapar la lista de denuncias.
  const auditPage = Math.max(1, Number.parseInt(firstValue(raw.auditPage) ?? "1", 10) || 1);
  const suspendedPage = Math.max(
    1,
    Number.parseInt(firstValue(raw.suspendedPage) ?? "1", 10) || 1,
  );
  const commentsPage = Math.max(
    1,
    Number.parseInt(firstValue(raw.commentsPage) ?? "1", 10) || 1,
  );
  const clubsPage = Math.max(1, Number.parseInt(firstValue(raw.clubsPage) ?? "1", 10) || 1);

  const total = countOpenReports();
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reports = listReports({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const suspendedTotal = countSuspendedUsers();
  const suspended = listSuspendedUsers(PAGE_SIZE, (suspendedPage - 1) * PAGE_SIZE);
  const commentsTotal = countHiddenComments();
  const hiddenComments = listHiddenComments(PAGE_SIZE, (commentsPage - 1) * PAGE_SIZE);
  const clubsTotal = countHiddenClubs();
  const hiddenClubs = listHiddenClubs(PAGE_SIZE, (clubsPage - 1) * PAGE_SIZE);
  const auditTotal = countAudit();
  const audit = listAudit(PAGE_SIZE, (auditPage - 1) * PAGE_SIZE);
  const metrics = getCommunityMetrics();

  return (
    <SiteShell user={user} section="admin" title={t("Moderación")}>
      <PageHeader
        overline={t("SOLO ADMINISTRACIÓN")}
        title={t("Denuncias abiertas")}
        description={t("Revisa las denuncias, sanciona cuentas y restablece contenido oculto.")}
        aside={<span className="shelf-count">{t("{n} pendientes", { n: total })}</span>}
      />

      <section className="admin-metrics" aria-label={t("Métricas de comunidad")}>
        <dl className="aside-stats">
          <div>
            <dt>{t("Clubes")}</dt>
            <dd>{metrics.clubs}</dd>
          </div>
          <div>
            <dt>{t("Membresías")}</dt>
            <dd>{metrics.memberships}</dd>
          </div>
          <div>
            <dt>{t("Solicitudes pendientes")}</dt>
            <dd>{metrics.pendingRequests}</dd>
          </div>
          <div>
            <dt>{t("Conversaciones")}</dt>
            <dd>{metrics.conversations}</dd>
          </div>
          <div>
            <dt>{t("Vistas de club (7 d)")}</dt>
            <dd>{metrics.views7d}</dd>
          </div>
          <div>
            <dt>{t("Altas en clubes (7 d)")}</dt>
            <dd>{metrics.joins7d}</dd>
          </div>
          <div>
            <dt>{t("Con actividad en su 2.ª semana")}</dt>
            <dd>{metrics.retention7d}</dd>
          </div>
          <div>
            <dt>{t("Libros disponibles")}</dt>
            <dd>{metrics.availableListings}</dd>
          </div>
          <div>
            <dt>{t("Solicitudes (30 d)")}</dt>
            <dd>{metrics.requests30d}</dd>
          </div>
          <div>
            <dt>{t("Completados (30 d)")}</dt>
            <dd>{metrics.completed30d}</dd>
          </div>
          <div>
            <dt>{t("Completados por usuario activo (30 d)")}</dt>
            <dd>
              {metrics.activeUsers30d > 0
                ? (metrics.completed30d / metrics.activeUsers30d).toFixed(2)
                : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <AdminReports reports={reports} />

      {lastPage > 1 && (
        <nav className="pager" aria-label={t("Paginación de denuncias")}>
          {page <= 1 ? (
            <span className="secondary-button small is-disabled" aria-disabled="true">
              <ChevronLeft size={15} /> {t("Anterior")}
            </span>
          ) : (
            <Link className="secondary-button small" href={`/admin?page=${page - 1}`}>
              <ChevronLeft size={15} /> {t("Anterior")}
            </Link>
          )}
          <span>
            {t("Página {page} de {total}", { page, total: lastPage })}
          </span>
          {page >= lastPage ? (
            <span className="secondary-button small is-disabled" aria-disabled="true">
              {t("Siguiente")} <ChevronRight size={15} />
            </span>
          ) : (
            <Link className="secondary-button small" href={`/admin?page=${page + 1}`}>
              {t("Siguiente")} <ChevronRight size={15} />
            </Link>
          )}
        </nav>
      )}

      <AdminSanctions
        suspended={suspended}
        hiddenComments={hiddenComments}
        hiddenClubs={hiddenClubs}
        audit={audit}
        pageSize={PAGE_SIZE}
        pagination={{
          suspended: { page: suspendedPage, total: suspendedTotal },
          comments: { page: commentsPage, total: commentsTotal },
          clubs: { page: clubsPage, total: clubsTotal },
          audit: { page: auditPage, total: auditTotal },
        }}
      />
    </SiteShell>
  );
}
