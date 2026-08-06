import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { nowSeconds } from "@/lib/db";
import { mapRows } from "@/lib/import/map-rows";
import { readTable } from "@/lib/import/read-table";
import { decideScheduleMode } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Doc file CSV/Excel va tra ve ban xem truoc, kem loi cua tung dong.
 * Khong ghi gi vao CSDL - nguoi dung xac nhan o buoc commit.
 */
export async function POST(request: NextRequest) {
  return guard(async () => {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("Chưa chọn file.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await readTable(file.name, buffer);
    if (rows.length === 0) {
      return fail("File không có dòng dữ liệu nào (dòng đầu tiên phải là tiêu đề cột).");
    }

    const now = nowSeconds();
    const mapped = mapRows(rows).map((row) => ({
      ...row,
      scheduleMode: decideScheduleMode(row.scheduledAt, row.type, now).mode,
    }));

    return ok({
      total: mapped.length,
      validCount: mapped.filter((r) => !r.error).length,
      rows: mapped,
    });
  });
}
