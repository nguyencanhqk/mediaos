import { NextRequest } from "next/server";
import { fail, guard, ok } from "@/lib/api";
import { listLibrary } from "@/lib/library/browse";
import { LibraryPathError, libraryRoots } from "@/lib/library/roots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/library?root=<chi so>&dir=<duong dan tuong doi>
 *
 * Duyet kho video doc tu thu muc. Chi DOC — khong sao chep gi vao kho media (viec do o
 * /api/library/import).
 *
 * Cong phien: route nay nam duoi middleware nhu moi route khac (khong co trong PUBLIC_PATHS),
 * nen khong co phien thi middleware da tra 401 truoc khi den day.
 *
 * Client gui CHI SO goc + duong dan TUONG DOI, khong bao gio gui duong dan tuyet doi. Duong dan
 * tuyet doi tren may chu la thong tin bo cuc dia — khong dua ra ngoai, va cung khong nhan vao.
 */
export async function GET(request: NextRequest) {
  return guard(async () => {
    const roots = libraryRoots();
    if (roots.length === 0) {
      // Khong khai bao goc nao = tinh nang tat, KHONG phai loi. Tra danh sach rong de giao dien
      // hien huong dan cau hinh thay vi bao do.
      return ok({
        roots: [],
        rootKey: "",
        relativePath: "",
        breadcrumbs: [],
        directories: [],
        files: [],
      });
    }

    const params = request.nextUrl.searchParams;
    // Khong truyen `root` = kho dau tien. Truyen khoa cua mot goc DA BI XOA thi resolveFromRoot
    // bao "khong hop le hoac da bi xoa" — dung cai nguoi dung can biet, khong am tham nhay sang
    // kho khac roi hien nham noi dung.
    const rootKey = params.get("root") || roots[0].key;

    try {
      return ok(listLibrary(rootKey, params.get("dir") ?? ""));
    } catch (error) {
      // Loi duong dan la loi DAU VAO (400), khong phai su co may chu (500). Tra 500 o day se
      // khien nguoi dung tuong he thong hong trong khi ho chi go sai duong dan.
      if (error instanceof LibraryPathError) return fail(error.message);
      throw error;
    }
  });
}
