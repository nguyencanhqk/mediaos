import { describe, expect, it } from "vitest";
import {
  ACCESS_RESTRICTED_CODE,
  cidrSchema,
  emailDomainSchema,
  hhmmSchema,
  timeWindowSchema,
  updateSecurityPolicySchema,
} from "./security-policy";

/**
 * CS-9 contract test (RED-first). Validate CHẶT CIDR / HH:MM / domain — chống fail-OPEN do parse rác
 * (rủi ro §6). Reject-path là chính: rác PHẢI bị từ chối ở biên, KHÔNG lọt vào logic enforce.
 */

describe("ACCESS_RESTRICTED_CODE", () => {
  it("là hằng máy-đọc-được ổn định", () => {
    expect(ACCESS_RESTRICTED_CODE).toBe("ACCESS_RESTRICTED");
  });
});

describe("cidrSchema", () => {
  it.each(["203.0.113.0/24", "10.0.0.0/8", "192.168.1.1/32", "0.0.0.0/0", "2001:db8::/32"])(
    "chấp nhận CIDR hợp lệ %s",
    (v) => {
      expect(cidrSchema.safeParse(v).success).toBe(true);
    },
  );

  it.each([
    "203.0.113.0", // thiếu prefix
    "203.0.113.0/33", // prefix vượt /32
    "999.0.0.0/24", // octet vượt 255
    "abc/24", // không phải IP
    "203.0.113.0/24 ", // (trim sẽ xử lý — nhưng nội dung sau trim vẫn phải hợp lệ)
    "", // rỗng
    "10.0.0.0/-1", // prefix âm
  ])("từ chối CIDR rác %s", (v) => {
    // Lưu ý: "203.0.113.0/24 " sau .trim() là hợp lệ → tách ra test riêng bên dưới.
    if (v.trim() === "203.0.113.0/24") return;
    expect(cidrSchema.safeParse(v).success).toBe(false);
  });

  it("trim khoảng trắng rồi mới validate", () => {
    expect(cidrSchema.safeParse("  203.0.113.0/24  ").success).toBe(true);
  });
});

describe("hhmmSchema", () => {
  it.each(["00:00", "08:30", "23:59"])("chấp nhận giờ hợp lệ %s", (v) => {
    expect(hhmmSchema.safeParse(v).success).toBe(true);
  });

  it.each(["24:00", "08:60", "8:30", "0830", "ab:cd", ""])("từ chối giờ rác %s", (v) => {
    expect(hhmmSchema.safeParse(v).success).toBe(false);
  });
});

describe("timeWindowSchema", () => {
  it("chấp nhận cửa sổ hợp lệ (day 0-6, start≠end)", () => {
    expect(timeWindowSchema.safeParse({ day: 1, start: "08:00", end: "17:00" }).success).toBe(true);
  });

  it("chấp nhận cửa sổ qua nửa đêm (end<start)", () => {
    expect(timeWindowSchema.safeParse({ day: 5, start: "22:00", end: "02:00" }).success).toBe(true);
  });

  it("từ chối day ngoài 0-6", () => {
    expect(timeWindowSchema.safeParse({ day: 7, start: "08:00", end: "17:00" }).success).toBe(false);
  });

  it("từ chối cửa sổ rỗng (start trùng end)", () => {
    expect(timeWindowSchema.safeParse({ day: 1, start: "08:00", end: "08:00" }).success).toBe(false);
  });
});

describe("emailDomainSchema", () => {
  it.each(["company.com", "sub.company.co.uk", "Funtime.VN"])("chấp nhận domain hợp lệ %s", (v) => {
    expect(emailDomainSchema.safeParse(v).success).toBe(true);
  });

  it("chuẩn hoá về lowercase", () => {
    expect(emailDomainSchema.parse("Funtime.VN")).toBe("funtime.vn");
  });

  it.each(["nope", "@company.com", "company", "has space.com", ""])(
    "từ chối domain rác %s",
    (v) => {
      expect(emailDomainSchema.safeParse(v).success).toBe(false);
    },
  );
});

describe("updateSecurityPolicySchema", () => {
  it("chấp nhận partial update rỗng (no-op)", () => {
    expect(updateSecurityPolicySchema.safeParse({}).success).toBe(true);
  });

  it("chấp nhận update đầy đủ hợp lệ", () => {
    const ok = updateSecurityPolicySchema.safeParse({
      autoLogoutMinutes: 30,
      ipRestrictionEnabled: true,
      allowlistCidrs: ["203.0.113.0/24"],
      timeRestrictionEnabled: true,
      timeWindows: [{ day: 1, start: "08:00", end: "17:00" }],
      applyScope: "selected",
      applyAppKeys: ["studio"],
      exemptUserIds: ["11111111-1111-1111-1111-111111111111"],
      emailDomainRestrictionEnabled: true,
      allowedEmailDomains: ["company.com"],
      twoFactorEnforced: true,
    });
    expect(ok.success).toBe(true);
  });

  it("từ chối CIDR rác trong allowlist (fail-fast tại biên)", () => {
    expect(
      updateSecurityPolicySchema.safeParse({ allowlistCidrs: ["not-a-cidr"] }).success,
    ).toBe(false);
  });

  it("từ chối exemptUserIds không phải uuid", () => {
    expect(updateSecurityPolicySchema.safeParse({ exemptUserIds: ["abc"] }).success).toBe(false);
  });

  it("từ chối field lạ (strict — chống ghi cột ngoài ý)", () => {
    expect(
      updateSecurityPolicySchema.safeParse({ companyId: "x", autoLogoutMinutes: 5 }).success,
    ).toBe(false);
  });

  it("chấp nhận autoLogoutMinutes=null (tắt)", () => {
    expect(updateSecurityPolicySchema.safeParse({ autoLogoutMinutes: null }).success).toBe(true);
  });

  it("từ chối autoLogoutMinutes<=0", () => {
    expect(updateSecurityPolicySchema.safeParse({ autoLogoutMinutes: 0 }).success).toBe(false);
  });
});
