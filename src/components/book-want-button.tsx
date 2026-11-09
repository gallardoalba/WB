"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Bell, BellRing } from "lucide-react";
import { api } from "@/lib/client-api";
import { useI18n } from "./i18n-provider";

/**
 * «Avísame de nuevos ejemplares». Con `useOptimistic` el botón y el contador
 * cambian al instante y se deshacen solos si el servidor dice que no: el
 * visitante no espera a una ida y vuelta para ver que su pulsación contó.
 *
 * La base del estado optimista es lo último que confirmó el servidor; por eso
 * al terminar la transición no hay salto: si la petición fue bien se actualiza
 * la base con las cifras reales (que pueden no ser las que suponíamos, porque
 * otra persona pudo pedir el mismo libro entre medias) y si falló se vuelve a
 * lo que había.
 */
export function BookWantButton({
  bookId,
  initialWanted,
  initialCount,
}: {
  bookId: string;
  initialWanted: boolean;
  initialCount: number;
}) {
  const { t } = useI18n();
  const [servidor, setServidor] = useState({ wanted: initialWanted, count: initialCount });
  const [estado, aplicar] = useOptimistic(
    servidor,
    (actual, siguiente: boolean) => ({
      wanted: siguiente,
      // Se mueve de uno en uno mientras no llega la respuesta; el número bueno
      // lo pone el servidor al confirmar.
      count: Math.max(0, actual.count + (siguiente ? 1 : -1)),
    }),
  );
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  function toggle() {
    const siguiente = !estado.wanted;
    setError("");
    iniciar(async () => {
      aplicar(siguiente);
      try {
        const result = await api<{ wanted: boolean; count: number }>(
          `/api/books/${bookId}/want`,
          { method: "POST", body: { enabled: siguiente } },
        );
        setServidor({ wanted: result.wanted, count: result.count });
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : t("No se pudo guardar el aviso."),
        );
      }
    });
  }

  return (
    <div className="book-want">
      <button
        type="button"
        className={estado.wanted ? "secondary-button small book-want-on" : "secondary-button small"}
        aria-pressed={estado.wanted}
        aria-busy={pendiente || undefined}
        disabled={pendiente}
        onClick={toggle}
      >
        {estado.wanted ? <BellRing size={15} aria-hidden /> : <Bell size={15} aria-hidden />}
        {estado.wanted ? t("Te avisaremos de nuevos ejemplares") : t("Avísame de nuevos ejemplares")}
      </button>
      {estado.count > 0 && (
        <small>
          {estado.count === 1
            ? t("1 persona lo busca en tu ciudad")
            : t("{n} personas lo buscan en tu ciudad", { n: estado.count })}
        </small>
      )}
      {error && (
        <small className="form-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
