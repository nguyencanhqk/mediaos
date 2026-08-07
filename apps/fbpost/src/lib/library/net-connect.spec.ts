import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ensureShareConnection,
  explainNetError,
  forgetShareConnection,
  NetConnectError,
  qualifyUsername,
  shareRootOf,
} from "./net-connect";

/**
 * Cat duong dan mang thanh "goc share".
 *
 * SMB xac thuc o cap SHARE, khong phai cap thu muc con: goi `net use` voi ca duong dan sau se bao
 * loi 67 (khong tim thay ten mang) — mot loi rat kho lan ra vi no trong giong nhu go sai ten may.
 */

describe("shareRootOf", () => {
  it("cat dung hai doan dau cua duong dan UNC", () => {
    expect(shareRootOf("\\\\DESKTOP-KTNA4B6\\Banh xe\\BÁNH XE\\Hồng")).toBe(
      "\\\\DESKTOP-KTNA4B6\\Banh xe",
    );
  });

  it("nhan ca dang gach xuoi (dang khuyen dung o o nhap)", () => {
    expect(shareRootOf("//MAY-A/share/thu-muc")).toBe("\\\\MAY-A\\share");
  });

  it("duong dan chi co ten may, chua co share thi khong dung duoc", () => {
    expect(shareRootOf("\\\\MAY-A")).toBeNull();
    expect(shareRootOf("\\\\MAY-A\\")).toBeNull();
  });

  it("chinh goc share tra ve chinh no", () => {
    expect(shareRootOf("\\\\MAY-A\\share")).toBe("\\\\MAY-A\\share");
  });

  it("duong dan CUC BO tra ve null — khong dang nhap gi ca", () => {
    expect(shareRootOf("D:\\kho-video")).toBeNull();
    expect(shareRootOf("D:/kho-video/con")).toBeNull();
    expect(shareRootOf("/srv/video")).toBeNull();
  });
});

describe("qualifyUsername — ghep ten may vao ten tai khoan", () => {
  const SHARE = "\\\\DESKTOP-KTNA4B6\\Banh xe";

  it("ten tran duoc ghep them ten MAY DICH", () => {
    // Thieu buoc nay, Windows gui kem domain la ten MAY CHU ⇒ may workgroup dich tra 1326
    // "sai tai khoan hoac mat khau" DU mat khau dung. Thong bao noi sai hoan toan ve nguyen nhan.
    expect(qualifyUsername(SHARE, "ADMIN")).toBe("DESKTOP-KTNA4B6\\ADMIN");
  });

  it("cat khoang trang thua truoc khi ghep", () => {
    expect(qualifyUsername(SHARE, "  ADMIN  ")).toBe("DESKTOP-KTNA4B6\\ADMIN");
  });

  it("ten DA co phan may thi GIU NGUYEN", () => {
    expect(qualifyUsername(SHARE, "MAY-KHAC\\ADMIN")).toBe("MAY-KHAC\\ADMIN");
  });

  it("ten dang email/mien thi GIU NGUYEN", () => {
    expect(qualifyUsername(SHARE, "admin@cty.com")).toBe("admin@cty.com");
  });

  it("khong co share thi khong ghep gi", () => {
    expect(qualifyUsername("", "ADMIN")).toBe("ADMIN");
  });
});

describe("explainNetError — dich ma loi cua net", () => {
  it("mã 86 nói RIÊNG về mật khẩu, không gộp với sai tài khoản", () => {
    // Do duoc that tren PROD: net tra "System error 86" khi mat khau sai. Truoc khi vá, mã này
    // khong duoc nhan ra nen nguoi dung thay nguyen dong tieng Anh, va buoc thu lai voi ten day
    // du cung bi bo qua.
    const msg = explainNetError("System error 86 has occurred.");
    expect(msg).toContain("Mật khẩu không đúng");
    expect(msg).not.toContain("System error");
  });

  it("mã 1326 vẫn là thông báo mơ hồ hơn (tên HOẶC mật khẩu)", () => {
    expect(explainNetError("System error 1326 has occurred.")).toContain(
      "Sai tài khoản hoặc mật khẩu",
    );
  });

  it("tài khoản bị vô hiệu hoá được nói đúng tên vấn đề", () => {
    expect(explainNetError("System error 1331 has occurred.")).toContain("vô hiệu hoá");
  });

  it("tài khoản bị KHOÁ nói rõ là phải ngừng thử, không phải sửa mật khẩu", () => {
    // Do duoc tren PROD 07/08: sau vai lan sai mat khau, may dich tra 1909. Truoc khi vá, mã này
    // roi xuong nhanh cuoi va nguoi dung nhan nguyen dong "System error 1909 has occurred." —
    // khong biet la phai DUNG LAI, nen bam tiep va tu keo dai thoi gian khoa cua chinh minh.
    const msg = explainNetError(
      "System error 1909 has occurred.\n\nThe referenced account is currently locked out and may not be logged on to.",
    );
    expect(msg).toContain("KHOÁ");
    expect(msg).toContain("Đừng thử thêm");
    expect(msg).not.toContain("System error");
  });

  it("KHOÁ được xét TRƯỚC mã sai mật khẩu — không bị nuốt vào nhánh 86/1326", () => {
    // `net` in ca hai y trong mot lan xuat khi tai khoan vua sai mat khau vua bi khoa. Neu thu tu
    // dao lai, nguoi dung duoc bao "kiem tra lai mat khau" trong khi go dung mat khau cung van bi
    // tu choi — dung kieu chan doan sai huong ma cac nhanh nay sinh ra de tranh.
    const msg = explainNetError(
      "System error 1909 has occurred. The specified network password is not correct.",
    );
    expect(msg).toContain("KHOÁ");
  });

  it("mã lạ thì KHÔNG bịa nguyên nhân", () => {
    expect(explainNetError("")).toBe("Không kết nối được tới ổ chia sẻ.");
  });

  it("lỗi KHÔNG chạy được PowerShell không bị nhận nhầm thành sai mật khẩu", () => {
    // Nhanh nay tra ve cau tieng Viet KHONG chua "System error", nen no phai roi xuong nhanh cuoi va
    // duoc giu nguyen. Neu no lot vao mot nhanh dang nhap nao do thi nguoi dung se doi mat khau ca
    // buoi trong khi loi that nam o may chu — dung kieu chan doan sai huong da xay ra mot lan roi.
    const msg = explainNetError("Không chạy được bước đăng nhập ổ chia sẻ trên máy chủ.");
    expect(msg).toContain("Không chạy được bước đăng nhập");
  });
});

/**
 * Bai KIEM CHUNG THAT — noi toi mot o chia se song, bang tai khoan that.
 *
 * Vi sao phai co: toan bo cac bai tren chi do phan DICH LOI, va chung van XANH ruc trong suot thoi
 * gian co che dang nhap KHONG dang nhap duoc lan nao. Do duoc tren PROD 07/08/2026: `net use * ` doc
 * mat khau tu console chu khong tu stdin, nen no luon dang nhap voi mat khau RONG — mot loi khong
 * bai test thuan-ham-so nao bat duoc, vi cho hong nam o ranh gioi voi Windows.
 *
 * Mac dinh BO QUA (khong co may chia se trong CI). Chay that:
 *   SMB_TEST_SHARE='//TÊN-MÁY/tên-share' SMB_TEST_USER='TÊN-MÁY\tài-khoản' SMB_TEST_PASSWORD='...' \
 *     pnpm --filter @mediaos/fbpost test net-connect
 */
const liveShare = process.env.SMB_TEST_SHARE;
const liveUser = process.env.SMB_TEST_USER;
const livePassword = process.env.SMB_TEST_PASSWORD;
const hasLiveShare = Boolean(liveShare && liveUser && livePassword);

describe.skipIf(!hasLiveShare)("ensureShareConnection — đăng nhập THẬT vào ổ chia sẻ", () => {
  it("đăng nhập được và đọc được thư mục sau đó", () => {
    const dirPath = liveShare!.replace(/\//g, "\\");

    // `force` de khong an theo mot phien SMB con song tu truoc — do la dung cai bay da lam bai kiem
    // chung cu vo nghia: doc duoc nho phien cu, nen ket luan "dang nhap thanh cong" hoan toan sai.
    forgetShareConnection(dirPath);
    expect(() =>
      ensureShareConnection(
        dirPath,
        { username: liveUser!, password: livePassword! },
        { force: true },
      ),
    ).not.toThrow();

    const entries = fs.readdirSync(fs.realpathSync.native(dirPath), { withFileTypes: true });
    expect(entries.length).toBeGreaterThan(0);
  });

  // 45s chu khong phai mac dinh 5s: do duoc 07/08/2026, mat khau DUNG bi tu choi sau ~0,5s con mat
  // khau SAI mat toi ~23s. De mac dinh thi bai nay do vi HET GIO — mot ket qua trong y het nhu code
  // hong, va nguoi doc se di sua nham cho.
  it(
    "mật khẩu SAI bị từ chối — chứng minh phép thử trên không phải xanh oan",
    { timeout: 45_000 },
    () => {
      // Thieu bai nay thi bai tren khong chung minh duoc gi: mot ham `ensureShareConnection` rong
      // tuech cung lam no xanh, mien la co san phien SMB tu truoc.
      const dirPath = liveShare!.replace(/\//g, "\\");
      forgetShareConnection(dirPath);
      expect(() =>
        ensureShareConnection(
          dirPath,
          { username: liveUser!, password: `${livePassword!}-sai-co-y` },
          { force: true },
        ),
      ).toThrow(NetConnectError);
    },
  );
});
