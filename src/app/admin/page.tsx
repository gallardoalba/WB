import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { AdminAppeals } from "@/components/admin-appeals";
import { AdminReports } from "@/components/admin-reports";
import { AdminSanctions } from "@/components/admin-sanctions";
import { PageHeader, SiteShell } from "@/components/site-shell";
import { requirePageUser } from "@/lib/page-auth";
import { canModerate, canSanction } from "@/lib/permissions";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { localePath } from "@/lib/locale";
import {
  countAudit,
  countOpenAppeals,
  countHiddenComments,
  countOpenReports,
  countSuspendedUsers,
  getCommunityMetrics,
  getTotpState,
  listAudit,
  listHiddenComments,
  listOpenAppeals,
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
  if (!user || !canModerate(user)) notFound();
  // Moderar mueve cuentas y contenido de otras personas, así que en producción
  // exige segundo factor. Antes esto era un `notFound()`: el enlace «Moderación»
  // del menú de cuenta llevaba a «Esta página no existe», que parece un fallo.
  // Ahora se explica el requisito y se ofrece el camino para activarlo.
  if (process.env.NODE_ENV === "production" && !getTotpState(user.id).enabled) {
    return (
      <SiteShell user={user} section="admin" title={t("Moderación")}>
        <PageHeader
          overline={t("EQUIPO DE MODERACIÓN")}
          title={t("Moderación de la comunidad")}
          description={t(
            "Aquí se revisan las denuncias, se modera el contenido y se atienden las apelaciones.",
          )}
        />
        {/* Estado bloqueado: se explica el paso que falta, no se disfraza de
            página de cuenta. */}
        <section className="admin-gate">
          <div className="admin-gate-head">
            <span className="admin-gate-icon" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h2>{t("Falta un paso: verificación en dos pasos")}</h2>
              <p>
                {t(
                  "El panel no se abre hasta que tu cuenta tenga un segundo factor, porque desde aquí se mueven cuentas y contenido de otras personas.",
                )}
              </p>
            </div>
          </div>
          <h3>{t("Cómo activarla")}</h3>
          <ol className="admin-steps">
            <li>{t("Abre tu cuenta y despliega «Verificación en dos pasos».")}</li>
            <li>{t("Escanea el código QR con una aplicación de códigos (o guarda la clave).")}</li>
            <li>{t("Escribe el código de seis cifras que te muestre la aplicación.")}</li>
          </ol>
          <p className="admin-gate-note">
            {t("Cuando esté activa, «Moderación» abrirá el panel completo.")}
          </p>
          <Link href={localePath(locale, "/cuenta")} className="primary-button small">
            {t("Ir a mi cuenta")}
          </Link>
        </section>
      </SiteShell>
    );
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
  const appealsPage = Math.max(1, Number.parseInt(firstValue(raw.appealsPage) ?? "1", 10) || 1);

  const total = countOpenReports();
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reports = listReports({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  // Solo se cargan los datos que ese rol puede ver: un moderador no recibe en
  // el HTML ni en el payload de React la lista de cuentas suspendidas ni la
  // auditoría completa.
  const seesSanctions = canSanction(user);
  const suspendedTotal = seesSanctions ? countSuspendedUsers() : 0;
  const suspended = seesSanctions
    ? listSuspendedUsers(PAGE_SIZE, (suspendedPage - 1) * PAGE_SIZE)
    : [];
  const commentsTotal = countHiddenComments();
  const hiddenComments = listHiddenComments(PAGE_SIZE, (commentsPage - 1) * PAGE_SIZE);
  const auditTotal = user.isAdmin ? countAudit() : 0;
  const audit = user.isAdmin ? listAudit(PAGE_SIZE, (auditPage - 1) * PAGE_SIZE) : [];
  const appealsTotal = countOpenAppeals();
  const appeals = listOpenAppeals(user.id, PAGE_SIZE, (appealsPage - 1) * PAGE_SIZE);
  const metrics = getCommunityMetrics();

  return (
    <SiteShell user={user} section="admin" title={t("Moderación")}>
      <PageHeader
        overline={t("EQUIPO DE MODERACIÓN")}
        title={t("Denuncias abiertas")}
        description={t("Revisa las denuncias, modera el contenido y atiende las apelaciones.")}
        aside={<span className="shelf-count">{t("{n} pendientes", { n: total })}</span>}
      />

      {user.isAdmin ? (
        <p className="admin-nav">
          <Link
            className="text-link"
            href={localePath(locale, "/admin/estadisticas")}
          >
            {t("Ver estadísticas")}
          </Link>
        </p>
      ) : null}

      <section className="admin-metrics" aria-label={t("Métricas de comunidad")}>
        <dl className="aside-stats">
          <div>
            <dt>{t("Conversaciones")}</dt>
            <dd>{metrics.conversations}</dd>
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

      <AdminReports reports={reports} canSanction={canSanction(user)} />

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

      <AdminAppeals
        appeals={appeals}
        page={appealsPage}
        total={appealsTotal}
        pageSize={PAGE_SIZE}
      />

      <AdminSanctions
        suspended={suspended}
        canSanction={canSanction(user)}
        showAudit={user.isAdmin}
        hiddenComments={hiddenComments}
        audit={audit}
        pageSize={PAGE_SIZE}
        pagination={{
          suspended: { page: suspendedPage, total: suspendedTotal },
          comments: { page: commentsPage, total: commentsTotal },
          audit: { page: auditPage, total: auditTotal },
        }}
      />
    </SiteShell>
  );
}
