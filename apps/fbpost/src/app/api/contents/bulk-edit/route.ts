import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { BULK_EDIT_FIELDS, MAX_BULK_CONTENTS, MAX_BULK_RULES } from "@/lib/bulk-edit";
import { applyBulkEdit, previewBulkEdit } from "@/lib/bulk-edit-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sua hang loat mot doan van ban giong nhau trong nhieu noi dung.
 *
 * Mot endpoint lam ca hai viec, tach nhau bang `dryRun`: xem truoc va ap dung chay CUNG mot
 * duong code nen ket qua khong the lech. Mac dinh la XEM TRUOC — muon ghi that thi phai noi ro
 * `dryRun: false`, de mot lan bam nham khong doi hang tram bai.
 */

const bulkEditSchema = z.object({
  contentIds: z
    .array(z.number().int())
    .min(1, "Chưa chọn nội dung nào")
    .max(MAX_BULK_CONTENTS, `Mỗi lần chỉ sửa tối đa ${MAX_BULK_CONTENTS} nội dung`),
  rules: z
    .array(
      z.object({
        find: z.string().min(1, "Chưa nhập đoạn cần tìm"),
        replace: z.string().default(""),
      }),
    )
    .min(1, "Chưa nhập cặp thay thế nào")
    .max(MAX_BULK_RULES, `Mỗi lần chỉ nhận tối đa ${MAX_BULK_RULES} cặp thay thế`),
  fields: z.array(z.enum(BULK_EDIT_FIELDS)).min(1, "Chưa chọn ô nào để sửa"),
  caseSensitive: z.boolean().default(false),
  includePendingPosts: z.boolean().default(false),
  /** Mac dinh true: khong ghi gi neu nguoi goi khong noi ro. */
  dryRun: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = bulkEditSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        parsed.error.issues
          .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
          .join("; "),
      );
    }

    const { dryRun, ...input } = parsed.data;
    // Bo cac o trung nhau de khong dem hai lan cung mot thay doi.
    const payload = { ...input, fields: [...new Set(input.fields)] };

    return ok(dryRun ? previewBulkEdit(payload) : applyBulkEdit(payload));
  });
}
