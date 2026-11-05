import { AppSkeleton } from "@/components/app-skeleton";

/** Mientras llega la lista paginada. */
export default function Loading() {
  return <AppSkeleton rows={4} />;
}
