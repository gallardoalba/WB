import { AppSkeleton } from "@/components/app-skeleton";

/** La ficha pública resuelve la obra y su portada: el armazón se pinta ya. */
export default function Loading() {
  return <AppSkeleton rows={2} />;
}
