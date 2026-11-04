import { invalidatePublicData } from "@/lib/revalidate";
import { handleApiError, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createClubLoan, returnClubLoan } from "@/lib/repo";
import { guard } from "@/lib/throttle";
import { clubLoanReturnSchema, clubLoanSchema } from "@/lib/validation";

type Context = { params: Promise<{ clubId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { clubId } = await params;
    guard(request, {
      bucket: "club:loan",
      key: user.id,
      limit: 60,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const input = clubLoanSchema.parse(await readJson(request));
    const loan = createClubLoan({
      clubId,
      listingId: input.listingId,
      lenderId: user.id,
      borrowerId: input.borrowerId,
      dueAt: input.dueAt ?? null,
    });
    invalidatePublicData();
    return json({ loan }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    await params;
    guard(request, {
      bucket: "club:loan:return",
      key: user.id,
      limit: 90,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const { loanId } = clubLoanReturnSchema.parse(await readJson(request));
    const loan = returnClubLoan(loanId, user.id);
    invalidatePublicData();
    return json({ loan });
  } catch (error) {
    return handleApiError(error);
  }
}
