import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { LibraryPathError } from "@/lib/library/roots";
import { importMediaFromLibrary } from "@/lib/media-service";
import type { MediaFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/library/import — nap cac file DA CHON tu kho video vao kho media cua app.
 *
 * Day la duong thay cho upload qua trinh duyet doi voi video nang: file di thang tu o chia se vao
 * dia may chu, khong qua HTTP, nen khong dinh tran 10MB cua middleware Next lan tran 100MB cua
 * Cloudflare. Voi LAN 1 Gbps, mot video 2 GB mat khoang 20 giay.
 *
 * Chi nap file DUOC CHON — khong dong bo ca kho. Kho hien tai 686 GB / 1.618 file; dong bo toan bo
 * la nhan doi dung luong ma khong dung den.
 */

const schema = z.object({
  items: z
    .array(
      z.object({
        /** Khoa goc kho (`env:0` / `cfg:3`) — on dinh, khong xe dich khi them/xoa goc khac. */
        root: z.string().min(1),
        /** Duong dan TUONG DOI so voi goc. Khong nhan duong dan tuyet doi o duong nay. */
        path: z.string().min(1),
      }),
    )
    .min(1, "Chưa chọn file nào.")
    // Chan mot lan bam nap hang nghin file: moi file la mot lan chep qua LAN, request se treo
    // rat lau va nguoi dung khong biet chuyen gi dang xay ra. Chia nho o phia giao dien.
    .max(50, "Mỗi lần chỉ nạp tối đa 50 file. Hãy chọn ít hơn rồi lặp lại."),
});

export interface LibraryImportResult {
  path: string;
  media: MediaFile | null;
  error: string | null;
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ.");
    }

    // Nap TUAN TU: chep song song nhieu file GB qua cung mot duong LAN chi lam ca hai cham hon,
    // va lam thanh tien do nhay lung tung. Loi cua mot file KHONG lam hong ca me — nguoi dung
    // thay dung file nao hong va vi sao.
    const results: LibraryImportResult[] = [];
    for (const item of parsed.data.items) {
      try {
        results.push({
          path: item.path,
          media: importMediaFromLibrary(item.root, item.path),
          error: null,
        });
      } catch (error) {
        results.push({
          path: item.path,
          media: null,
          error:
            error instanceof LibraryPathError || error instanceof Error
              ? error.message
              : "Lỗi không xác định",
        });
      }
    }

    return ok(results, 201);
  });
}
