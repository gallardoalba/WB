import { json } from "@/lib/api";
import { createReadingList, listReadingLists } from "@/lib/repo";
import { DIA, route } from "@/lib/route";
import { readingListSchema } from "@/lib/validation";

export const POST = route(
  {
    body: readingListSchema,
    limit: { bucket: "list:create", limit: 12, windowMs: DIA },
  },
  ({ user, body }) => json({ list: createReadingList(user.id, body) }, 201),
);

/** Listas propias (para el selector de «añadir a una lista»). */
export const GET = route(
  {
    limit: {
      bucket: "lists:list",
      limit: 240,
      windowMs: 60 * 60 * 1000,
      mode: "hit",
    },
  },
  ({ user }) => json({ lists: listReadingLists(user.id, user.id) }),
);
