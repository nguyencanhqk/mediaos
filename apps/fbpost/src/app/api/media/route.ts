import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { saveMediaBuffer } from "@/lib/media-service";
import type { MediaFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nhan file tu form upload cua giao dien va luu vao kho media cuc bo. */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const form = await request.formData();
    const entries = form.getAll("files");

    if (entries.length === 0) {
      return fail("Chưa chọn file nào.");
    }

    const saved: MediaFile[] = [];
    for (const entry of entries) {
      if (!(entry instanceof File)) continue;
      const buffer = Buffer.from(await entry.arrayBuffer());
      saved.push(saveMediaBuffer(entry.name, entry.type, buffer));
    }

    if (saved.length === 0) {
      return fail("Không đọc được file tải lên.");
    }

    return ok(saved, 201);
  });
}
