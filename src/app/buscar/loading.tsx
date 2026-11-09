import { AppSkeleton } from "@/components/app-skeleton";

/** La búsqueda global consulta cuatro secciones: el armazón se pinta ya. */
export default function Loading() {
  return <AppSkeleton rows={2} />;
}
