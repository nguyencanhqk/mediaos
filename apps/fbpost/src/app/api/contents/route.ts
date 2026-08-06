import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { countScheduledByContent, createContent, listContents } from "@/lib/repo/content-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thu vien noi dung: danh sach bai co the dem rai len nhieu Page.
 * Noi dung o day chua gan voi Page hay thoi diem nao ca.
 */

const contentSchema = z
  .object({
    label: z.string().trim().max(120, "Nhãn quá dài").nullish(),
    type: z.enum(["text", "photo", "video", "reel"]),
    message: z.string().default(""),
    link: z.string().trim().url("Link không hợp lệ").or(z.literal("")).nullish(),
    title: z.string().trim().nullish(),
    mediaIds: z.array(z.number().int()).default([]),
  })
  .refine((input) => input.type !== "text" || input.message.trim() !== "" || Boolean(input.link), {
    message: "Nội dung chữ phải có nội dung hoặc link.",
  })
  .refine((input) => input.type === "text" || input.mediaIds.length > 0, {
    message: "Nội dung ảnh/video/Reels phải có file đính kèm.",
  })
  .refine((input) => !["video", "reel"].includes(input.type) || input.mediaIds.length === 1, {
    message: "Nội dung video/Reels chỉ nhận đúng một file.",
  });

export async function GET() {
  return guard(async () => {
    const scheduledCounts = countScheduledByContent();
    return ok({
      contents: listContents(),
      scheduledCounts,
    });
  });
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = contentSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        parsed.error.issues
          .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
          .join("; "),
      );
    }

    const input = parsed.data;
    return ok(
      createContent({
        label: input.label || null,
        type: input.type,
        message: input.message,
        link: input.link || null,
        title: input.title || null,
        mediaIds: input.mediaIds,
      }),
      201,
    );
  });
}
