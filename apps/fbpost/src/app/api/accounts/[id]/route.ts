import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { deleteAccount, getAccount, renameAccount, toPublicAccount } from "@/lib/repo/account-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1, "Tên tài khoản không được để trống").max(120, "Tên quá dài"),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const accountId = Number(id);
    if (!getAccount(accountId)) return fail("Không tìm thấy tài khoản.", 404);

    const body: unknown = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const updated = renameAccount(accountId, parsed.data.name);
    return updated ? ok(toPublicAccount(updated)) : fail("Không tìm thấy tài khoản.", 404);
  });
}

/**
 * Go tai khoan khoi phan mem.
 *
 * Page cua tai khoan do bi go theo vi khong con cach lam moi token.
 * Bai da dang van con trong danh sach kem ten Page de xem lai lich su,
 * nhung bai chua gui di se khong dang duoc nua.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const accountId = Number(id);
    const account = getAccount(accountId);
    if (!account) return fail("Không tìm thấy tài khoản.", 404);

    const force = request.nextUrl.searchParams.get("force") === "1";
    if (account.pageCount > 0 && !force) {
      return fail(
        `Tài khoản "${account.name}" đang giữ ${account.pageCount} Page. Gỡ tài khoản sẽ gỡ luôn số Page đó — xác nhận để tiếp tục.`,
        409,
      );
    }

    const result = deleteAccount(accountId);
    return ok({ id: accountId, name: account.name, removedPages: result.removedPages });
  });
}
