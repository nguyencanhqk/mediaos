import fs from "node:fs";
import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { isAdminEmail } from "@/lib/auth/admin";
import { currentSession } from "@/lib/auth/current-user";
import {
  ensureShareConnection,
  forgetShareConnection,
  NetConnectError,
  shareRootOf,
} from "@/lib/library/net-connect";
import { addStoredRoot, credentialFor, removeStoredRoot } from "@/lib/library/roots-store";
import { findRoot, libraryRoots, normalizeRootPath } from "@/lib/library/roots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cau hinh cac thu muc goc cua kho video.
 *
 * ĐOC (GET) mo cho moi phien: giao dien can biet co nhung kho nao de duyet.
 * GHI (POST/DELETE) chi cho email trong `SOCIAL_ADMIN_EMAILS` — them mot goc la tu mo rong pham vi
 * file may chu duoc doc, khong phai thao tac thuong ngay. Xem `lib/auth/admin.ts`.
 *
 * MAT KHAU o dia chia se: nhan vao, bao mat bang secret-box roi cat; KHONG BAO GIO tra ra. Response
 * chi noi CO hay KHONG co tai khoan, va ten tai khoan.
 */

const addSchema = z.object({
  label: z.string().max(80).default(""),
  path: z.string().min(2, "Chưa nhập đường dẫn."),
  username: z.string().max(120).default(""),
  password: z.string().max(200).default(""),
});

interface RootView {
  key: string;
  label: string;
  path: string | null;
  source: "env" | "config";
  username: string | null;
  /** Doc duoc hay khong, kiem NGAY luc goi — cau hinh dung chua chac quyen da du. */
  status: "ok" | "denied" | "missing";
  fileCount: number | null;
  /** Chi co nghia voi duong dan mang: dang nhap duoc chua. */
  connectError: string | null;
}

/**
 * Do trang thai that cua mot goc, co dang nhap o dia chia se neu kho do co tai khoan.
 *
 * Ba ket qua tach bach vi ba viec phai lam khac nhau:
 *   ok      — dung het
 *   denied  — duong dan dung nhung khong duoc doc (thieu tai khoan, hoac tai khoan khong du quyen)
 *   missing — duong dan sai / may chua bat / share chua chia se
 */
function probe(
  dirPath: string,
  credential: { username: string; password: string } | null,
  options: { verify?: boolean } = {},
): { status: RootView["status"]; fileCount: number | null; connectError: string | null } {
  let connectError: string | null = null;
  if (credential) {
    try {
      // `force` CHI khi dang kiem chung tai khoan (luc them kho). O duong DOC (GET), `force` bien
      // moi lan tai trang thanh mot `execFileSync("net", timeout 30s)` DONG BO cho tung kho — may
      // chia se tat vao buoi toi la ca app dung hang chuc giay, va bat ky ai co phien chi can F5
      // lien tuc la ha duoc dich vu. Cache trong tien trinh la du cho duong doc.
      ensureShareConnection(dirPath, credential, { force: options.verify === true });
    } catch (error) {
      connectError = error instanceof NetConnectError ? error.message : "Không kết nối được.";
    }
  }

  try {
    const entries = fs.readdirSync(fs.realpathSync.native(dirPath), { withFileTypes: true });
    // GIU `connectError` ngay ca khi doc duoc. Dat `null` o day tung lam vo hieu hoa toan bo viec
    // kiem chung tai khoan: dang nhap that bai (sai mat khau) nhung `readdirSync` van chay duoc
    // nho mot phien SMB con song tu truoc ⇒ POST tuong la "ok" va luu kho voi mat khau SAI, den
    // lan khoi dong sau moi chet.
    return { status: "ok", fileCount: entries.length, connectError };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // `UNKNOWN` = o dia mang khong toi duoc (do duoc tren Windows). Thieu no thi moi su co mang
    // deu hien ra la "sai duong dan".
    const status =
      code === "EPERM" || code === "EACCES" || code === "UNKNOWN" ? "denied" : "missing";
    return { status, fileCount: null, connectError };
  }
}

export async function GET(request: NextRequest) {
  return guard(async () => {
    const session = await currentSession(request);
    const canManage = isAdminEmail(session?.email);

    const roots: RootView[] = libraryRoots().map((r) => {
      const state = probe(r.path, credentialFor(r.key));
      return {
        key: r.key,
        label: r.label,
        // Duong dan tuyet doi va ten tai khoan la thong tin bo cuc dia + danh tinh cua may chu:
        // chi nguoi duoc phep cau hinh moi can thay. Nguoi chi duyet kho khong can, va khong nen.
        path: canManage ? r.path : null,
        source: r.source,
        username: canManage ? (r.username ?? null) : null,
        ...state,
        connectError: canManage ? state.connectError : null,
      };
    });

    // Tra ve email dang dung khi KHONG duoc phep cau hinh: khong co no thi nguoi dung chi thay nut
    // bien mat ma khong biet vi sao, va cach duy nhat de biet la doc file .env tren may chu.
    return ok({
      roots,
      canManage,
      signedInAs: canManage ? null : (session?.email ?? null),
    });
  });
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const session = await currentSession(request);
    if (!isAdminEmail(session?.email)) {
      return fail("Bạn không có quyền cấu hình kho video. Liên hệ quản trị hệ thống.", 403);
    }

    const parsed = addSchema.safeParse(await request.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ.");

    const { label, username, password } = parsed.data;
    const normalized = normalizeRootPath(parsed.data.path);
    const isNetworkPath = shareRootOf(normalized) !== null;

    if (username !== "" && !isNetworkPath) {
      return fail("Chỉ ổ chia sẻ trong mạng mới cần tài khoản đăng nhập. Thư mục trên máy chủ thì để trống.");
    }
    if (username === "" && password !== "") {
      return fail("Đã nhập mật khẩu thì phải nhập cả tài khoản.");
    }
    // Chieu nguoc lai cung phai chan: `sealSecret("")` tra ve "" ⇒ `credentialFor` coi nhu KHONG co
    // tai khoan ⇒ ten tai khoan duoc luu con mat khau bien mat khong mot loi nao, va kho bao "khong
    // co quyen doc" — dan nguoi dung di sai huong dung nhu thu ma ba trang thai o day sinh ra de tranh.
    if (username !== "" && password === "") {
      return fail("Đã nhập tài khoản thì phải nhập cả mật khẩu.");
    }

    // Nhap tai khoan moi thi dung no; de trong thi giu tai khoan da luu cua kho cung duong dan
    // (cho phep doi nhan ma khong phai go lai mat khau).
    const existing = libraryRoots().find(
      (r) => r.source === "config" && r.path.toLowerCase() === normalized.toLowerCase(),
    );
    const credential =
      username !== "" ? { username, password } : existing ? credentialFor(existing.key) : null;

    const state = probe(normalized, credential, { verify: true });
    if (state.connectError) return fail(state.connectError);
    if (state.status === "missing") {
      return fail(
        `Không mở được "${normalized}". Kiểm tra lại đường dẫn — ổ chia sẻ trong mạng hãy ghi dạng //MÁY/share/thư-mục.`,
      );
    }
    if (state.status === "denied") {
      // VAN KHONG LUU. Luu mot goc khong doc duoc chi de lai mot dong hong trong danh sach, roi
      // moi lan duyet lai bao loi — nguoi dung tuong minh da cau hinh xong.
      return fail(
        isNetworkPath
          ? `Đăng nhập được nhưng tài khoản "${username || existing?.username || "(chưa nhập)"}" không được phép đọc "${normalized}".`
          : `Tài khoản đang chạy dịch vụ không có quyền đọc "${normalized}".`,
      );
    }

    // `username === ""` tren duong dan cuc bo ⇒ xoa tai khoan cu (neu co). Tren duong dan mang ma
    // de trong ⇒ giu nguyen (undefined).
    const credentialArg = username !== "" ? { username, password } : isNetworkPath ? undefined : null;
    return ok(addStoredRoot(label, normalized, credentialArg), 201);
  });
}

export async function DELETE(request: NextRequest) {
  return guard(async () => {
    const session = await currentSession(request);
    if (!isAdminEmail(session?.email)) {
      return fail("Bạn không có quyền cấu hình kho video. Liên hệ quản trị hệ thống.", 403);
    }

    const key = request.nextUrl.searchParams.get("key") ?? "";
    if (!key.startsWith("cfg:")) {
      return fail("Kho này do cấu hình máy chủ đặt (SOCIAL_MEDIA_LIBRARY_DIRS), không xoá được ở đây.");
    }

    const root = findRoot(key);
    if (!removeStoredRoot(key)) return fail("Không tìm thấy kho cần xoá.", 404);
    if (root) forgetShareConnection(root.path);

    // Media DA NAP van con nguyen: file da nam trong kho media cua app, khong phu thuoc goc nua.
    return ok({ removed: key });
  });
}
