import { json } from "@/lib/api";
import { listReports } from "@/lib/repo";
import { route } from "@/lib/route";

export const GET = route({ auth: "admin" }, () =>
  json({ reports: listReports() }, 200, { "cache-control": "no-store" }),
);
