import { redirect } from "next/navigation";

export const instant = false;

// El hub de comunidad vive en el catálogo; /comunidad ya no es el directorio.
export default function Page() {
  redirect("/?view=community");
}
