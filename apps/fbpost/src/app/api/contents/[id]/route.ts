import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { deleteContent, getContent, updateContent } from "@/lib/repo/content-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  label: z.string().trim().max(120, "Nhãn quá dài").nullish(),
  type: z.enum(["text", "photo", "video", "reel"]).optional(),
  message: z.string().optional(),
  link: z.string().trim().url("Link không hợp lệ").or(z.literal("")).nullish(),
  title: z.string().trim().nullish(),
  mediaIds: z.array(z.number().int()).optional(),
});

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const content = getContent(Number(id));
    return content ? ok(content) : fail("Không tìm thấy nội dung.", 404);
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const contentId = Number(id);
    if (!getContent(contentId)) return fail("Không tìm thấy nội dung.", 404);

    const body: unknown = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const updated = updateContent(contentId, {
      ...parsed.data,
      label: parsed.data.label === undefined ? undefined : parsed.data.label || null,
      link: parsed.data.link === undefined ? undefined : parsed.data.link || null,
      title: parsed.data.title === undefined ? undefined : parsed.data.title || null,
    });
    return updated ? ok(updated) : fail("Không cập nhật được nội dung.", 500);
  });
}

/**
 * Xoa noi dung khoi thu vien.
 *
 * Cac bai da xep lich tu noi dung nay van giu nguyen - chung da co ban sao
 * rieng cua noi dung nen khong bi anh huong.
 */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await context.params;
    const contentId = Number(id);
    if (!getContent(contentId)) return fail("Không tìm thấy nội dung.", 404);

    deleteContent(contentId);
    return ok({ id: contentId });
  });
}
