import { json } from "@/lib/api";
import { getTotpState } from "@/lib/repo";
import { route } from "@/lib/route";

export const GET = route(
  {},
  ({ user }) => {
    return json(getTotpState(user.id));
  },
);
