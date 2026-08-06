import { describe, expect, it } from "vitest";
import { explainNetError, qualifyUsername, shareRootOf } from "./net-connect";

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
    expect(explainNetError("System error 1326 has occurred.")).toContain("Sai tài khoản hoặc mật khẩu");
  });

  it("tài khoản bị vô hiệu hoá được nói đúng tên vấn đề", () => {
    expect(explainNetError("System error 1331 has occurred.")).toContain("vô hiệu hoá");
  });

  it("mã lạ thì KHÔNG bịa nguyên nhân", () => {
    expect(explainNetError("")).toBe("Không kết nối được tới ổ chia sẻ.");
  });
});
