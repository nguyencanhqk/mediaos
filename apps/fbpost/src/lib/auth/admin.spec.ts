import { afterEach, describe, expect, it } from "vitest";
import { isAdminEmail } from "./admin";

/**
 * Cong CAU HINH kho video.
 *
 * Bai quan trong nhat la ca "khong dat bien": fbpost khong co vai tro trong app, nen neu cong nay
 * mo mac dinh thi bat ky ai vao duoc app cung tu them duoc thu muc goc — tuc tu cap cho minh
 * quyen doc file bat ky tren may chu, dung thu ma whitelist sinh ra de chan.
 */

afterEach(() => {
  delete process.env.SOCIAL_ADMIN_EMAILS;
});

describe("isAdminEmail", () => {
  it("KHONG dat SOCIAL_ADMIN_EMAILS = KHONG AI cau hinh duoc (fail-closed)", () => {
    delete process.env.SOCIAL_ADMIN_EMAILS;
    expect(isAdminEmail("ai-do@example.com")).toBe(false);
  });

  it("dat rong cung KHONG mo cong", () => {
    process.env.SOCIAL_ADMIN_EMAILS = "   ";
    expect(isAdminEmail("ai-do@example.com")).toBe(false);
  });

  it("nhan email trong danh sach, khong phan biet hoa thuong va khoang trang", () => {
    process.env.SOCIAL_ADMIN_EMAILS = "admin@example.com, sep@example.com";
    expect(isAdminEmail("ADMIN@Example.com")).toBe(true);
    expect(isAdminEmail("  sep@example.com  ")).toBe(true);
  });

  it("tu choi email ngoai danh sach", () => {
    process.env.SOCIAL_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail("seo@example.com")).toBe(false);
  });

  it("tu choi khi phien khong co email", () => {
    process.env.SOCIAL_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  it("KHONG khop theo tien to/hau to — chi khop tron ven", () => {
    process.env.SOCIAL_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail("admin@example.com.evil.net")).toBe(false);
    expect(isAdminEmail("xadmin@example.com")).toBe(false);
  });
});
