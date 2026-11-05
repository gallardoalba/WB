import { AppSkeleton } from "@/components/app-skeleton";

/** Mientras llega el contenido: el armazón se pinta ya. */
export default function Loading() {
  return <AppSkeleton rows={3} />;
}
