import { AppSkeleton } from "@/components/app-skeleton";

/** Mientras llega la vista: el armazón (barra lateral y panel) se pinta ya. */
export default function Loading() {
  return <AppSkeleton rows={4} />;
}
