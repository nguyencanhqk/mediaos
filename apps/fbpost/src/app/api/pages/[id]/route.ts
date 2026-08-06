import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import {
  countPendingPostsOfPage,
  deletePage,
  getPage,
  renamePage,
  setPageActive,
  toPublic,
} from "@/lib/repo/page-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1, "Tên Page không được để trống").optional(),
});

/** Bat/tat Page hoac doi ten hien thi. Tat Page thi khong con duoc chon khi rai bai. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const pageRef = Number(id);
    if (!getPage(pageRef)) return fail("Không tìm thấy Page.", 404);

    const body: unknown = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    if (parsed.data.name !== undefined) renamePage(pageRef, parsed.data.name);
    if (parsed.data.isActive !== undefined) setPageActive(pageRef, parsed.data.isActive);

    const updated = getPage(pageRef);
    return updated ? ok(toPublic(updated)) : fail("Không tìm thấy Page.", 404);
  });
}

/**
 * Go Page khoi phan mem.
 *
 * Cac bai da dang van con trong danh sach kem ten Page de xem lai lich su.
 * Bai chua gui di se khong dang duoc nua nen phai canh bao truoc.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const pageRef = Number(id);
    const page = getPage(pageRef);
    if (!page) return fail("Không tìm thấy Page.", 404);

    const pending = countPendingPostsOfPage(pageRef);
    const force = request.nextUrl.searchParams.get("force") === "1";
    if (pending > 0 && !force) {
      return fail(
        `Page "${page.name}" còn ${pending} bài chưa gửi đi. Huỷ hoặc đăng hết số bài đó trước, hoặc xác nhận gỡ để bỏ luôn.`,
        409,
      );
    }

    deletePage(pageRef);
    return ok({ id: pageRef, name: page.name, abandonedPosts: pending });
  });
}
