import { FormSkeleton } from "@/components/app-skeleton";

/** La cuenta es un formulario: el esqueleto tiene que parecerse a eso. */
export default function Loading() {
  return <FormSkeleton boxes={3} />;
}
