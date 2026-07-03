import { describe, expect, it } from "vitest";
import { AuditMaskerService } from "./audit-masker.service";

/**
 * RED #1 (BE-3, BẤT BIẾN #3) — AuditMaskerService.mask() phải:
 *   - mask 8 khóa nhạy cảm (password/password_hash/token/secret/secret_ref/identity_number/
 *     bank_account/storage_path/signed_url) → value thành "***", GIỮ key.
 *   - match case-insensitive cả snake_case lẫn camelCase.
 *   - đệ quy qua nested object + array (KHÔNG bỏ sót lớp sâu).
 *   - IMMUTABLE: trả object MỚI, KHÔNG mutate input nghiệp vụ.
 *   - KHÔNG vỡ cấu trúc diff (key non-secret giữ nguyên value).
 *   - an toàn với null/undefined/primitive/Date.
 *
 * GHI CHÚ: mọi value bên dưới là placeholder vô hại (KHÔNG phải secret thật) — chỉ để khẳng định
 * masker thay VALUE bất kể nội dung. Dùng "PLACEHOLDER_*" để không trip guard-secrets.
 */
describe("AuditMaskerService.mask (bất biến #3)", () => {
  const masker = new AuditMaskerService();
  const MASK = "***";
  const SAMPLE = "PLACEHOLDER_VALUE";

  it("mask khóa snake_case nhạy cảm → '***', giữ key", () => {
    const out = masker.mask({ password: SAMPLE, password_hash: SAMPLE, email: "a@b.c" }) as Record<
      string,
      unknown
    >;
    expect(out["password"]).toBe(MASK);
    expect(out["password_hash"]).toBe(MASK);
    expect(out["email"]).toBe("a@b.c");
  });

  it("mask khóa camelCase nhạy cảm (passwordHash/secretRef/identityNumber/bankAccount/storagePath/signedUrl)", () => {
    const out = masker.mask({
      passwordHash: SAMPLE,
      secretRef: SAMPLE,
      identityNumber: SAMPLE,
      bankAccount: SAMPLE,
      storagePath: SAMPLE,
      signedUrl: SAMPLE,
      keep: "ok",
    }) as Record<string, unknown>;
    expect(out["passwordHash"]).toBe(MASK);
    expect(out["secretRef"]).toBe(MASK);
    expect(out["identityNumber"]).toBe(MASK);
    expect(out["bankAccount"]).toBe(MASK);
    expect(out["storagePath"]).toBe(MASK);
    expect(out["signedUrl"]).toBe(MASK);
    expect(out["keep"]).toBe("ok");
  });

  it("mask biến thể GHÉP theo stem (access_token/refreshToken/api_secret/clientSecret/secretKey/tokenHash) — chống D-i-D gap", () => {
    const out = masker.mask({
      access_token: SAMPLE,
      refreshToken: SAMPLE,
      api_secret: SAMPLE,
      clientSecret: SAMPLE,
      secretKey: SAMPLE,
      tokenHash: SAMPLE,
      email: "a@b.c",
      keep: "ok",
    }) as Record<string, unknown>;
    expect(out["access_token"]).toBe(MASK);
    expect(out["refreshToken"]).toBe(MASK);
    expect(out["api_secret"]).toBe(MASK);
    expect(out["clientSecret"]).toBe(MASK);
    expect(out["secretKey"]).toBe(MASK);
    expect(out["tokenHash"]).toBe(MASK);
    expect(out["email"]).toBe("a@b.c");
    expect(out["keep"]).toBe("ok");
  });

  it("mask token + secret (snake/single)", () => {
    const out = masker.mask({
      token: SAMPLE,
      secret: SAMPLE,
      secret_ref: SAMPLE,
      name: "keep",
    }) as Record<string, unknown>;
    expect(out["token"]).toBe(MASK);
    expect(out["secret"]).toBe(MASK);
    expect(out["secret_ref"]).toBe(MASK);
    expect(out["name"]).toBe("keep");
  });

  // S2-FND-BE-6 (BE-11 §12.5) — mở rộng stem: otp · salaryamount · health · idcard. Phủ biến thể GHÉP
  // snake_case + camelCase (salary_amount↔salaryAmount, id_card_number↔idCardNumber, otp_secret↔otpCode,
  // personal_health_info). FAIL TOWARD REDACTION (BẤT BIẾN #3). Stem lương THU HẸP thành 'salaryamount'
  // (FIX-1) — base_salary passthrough kiểm ở test REGRESSION riêng bên dưới.
  it("mask stem MỚI salaryamount/health/idcard (salary_amount/salaryAmount/id_card_number/idCardNumber/personal_health_info)", () => {
    const out = masker.mask({
      salary_amount: SAMPLE,
      salaryAmount: SAMPLE,
      id_card_number: SAMPLE,
      idCardNumber: SAMPLE,
      personal_health_info: SAMPLE,
      name: "keep",
      email: "a@b.c",
    }) as Record<string, unknown>;
    expect(out["salary_amount"]).toBe(MASK);
    expect(out["salaryAmount"]).toBe(MASK);
    expect(out["id_card_number"]).toBe(MASK);
    expect(out["idCardNumber"]).toBe(MASK);
    expect(out["personal_health_info"]).toBe(MASK);
    expect(out["name"]).toBe("keep");
    expect(out["email"]).toBe("a@b.c");
  });

  // S2-FND-BE-6-FIX-1 (REGRESSION KHÓA — audit crown-jewel) — stem lương ĐÃ THU HẸP 'salary'→'salaryamount'.
  // LÝ DO: 'salary' trần khớp SUBSTRING trong normalizeKey('base_salary')='basesalary' ⇒ che LUÔN
  // base_salary, PHÁ audit trail 'update-salary' đã SHIP (S2-QA-1): before/after={base_salary:<number>}
  // PHẢI là giá trị THẬT cho compliance — luồng update-salary có permission gate riêng (view-salary/
  // update-salary is_sensitive) + audit kiểm soát riêng, KHÔNG mask cào bằng. Khóa hợp đồng:
  // base_salary/baseSalary PASSTHROUGH; biến thể *amount VẪN mask (che dư field lương ad-hoc, an toàn).
  it("REGRESSION (FIX-1) — base_salary/baseSalary PASSTHROUGH (giữ giá trị THẬT cho audit update-salary), *amount VẪN mask", () => {
    const REAL = 12345678; // giá trị "đánh dấu" — audit update-salary before/after PHẢI là số thật
    const out = masker.mask({
      base_salary: REAL,
      baseSalary: REAL,
      salary_amount: SAMPLE,
      salaryAmount: SAMPLE,
      name: "keep",
    }) as Record<string, unknown>;
    // base_salary KHÔNG bị che — before/after của update-salary là field v1 kiểm soát riêng (done_when #6).
    expect(out["base_salary"]).toBe(REAL);
    expect(out["baseSalary"]).toBe(REAL);
    // Biến thể *amount VẪN che (stem thu hẹp 'salaryamount' — vẫn phủ salary_amount/salaryAmount).
    expect(out["salary_amount"]).toBe(MASK);
    expect(out["salaryAmount"]).toBe(MASK);
    expect(out["name"]).toBe("keep");
  });

  it("mask stem MỚI otp + biến thể ghép (otp/otp_secret/otpCode)", () => {
    const out = masker.mask({
      otp: SAMPLE,
      otp_secret: SAMPLE,
      otpCode: SAMPLE,
      keep: "ok",
    }) as Record<string, unknown>;
    expect(out["otp"]).toBe(MASK);
    expect(out["otp_secret"]).toBe(MASK);
    expect(out["otpCode"]).toBe(MASK);
    expect(out["keep"]).toBe("ok");
  });

  it("regression — 8 stem cũ VẪN mask sau khi thêm stem mới (KHÔNG nới lỏng)", () => {
    const out = masker.mask({
      password: SAMPLE,
      token: SAMPLE,
      secret: SAMPLE,
      identity_number: SAMPLE,
      bank_account: SAMPLE,
      storage_path: SAMPLE,
      signed_url: SAMPLE,
      keep: "ok",
    }) as Record<string, unknown>;
    expect(out["password"]).toBe(MASK);
    expect(out["token"]).toBe(MASK);
    expect(out["secret"]).toBe(MASK);
    expect(out["identity_number"]).toBe(MASK);
    expect(out["bank_account"]).toBe(MASK);
    expect(out["storage_path"]).toBe(MASK);
    expect(out["signed_url"]).toBe(MASK);
    expect(out["keep"]).toBe("ok");
  });

  it("match case-insensitive (PASSWORD / Token / Secret)", () => {
    const out = masker.mask({
      PASSWORD: SAMPLE,
      Token: SAMPLE,
      Secret: SAMPLE,
      Name: "keep",
    }) as Record<string, unknown>;
    expect(out["PASSWORD"]).toBe(MASK);
    expect(out["Token"]).toBe(MASK);
    expect(out["Secret"]).toBe(MASK);
    expect(out["Name"]).toBe("keep");
  });

  it("đệ quy nested object", () => {
    const out = masker.mask({
      level1: { token: SAMPLE, inner: { secret: SAMPLE, ok: 1 } },
      ok: true,
    }) as Record<string, Record<string, Record<string, unknown>>>;
    expect(out["level1"]["token"]).toBe(MASK);
    expect(out["level1"]["inner"]["secret"]).toBe(MASK);
    expect(out["level1"]["inner"]["ok"]).toBe(1);
    expect((out as unknown as Record<string, unknown>)["ok"]).toBe(true);
  });

  it("đệ quy qua array of object", () => {
    const out = masker.mask({
      items: [
        { token: SAMPLE, id: "a" },
        { token: SAMPLE, id: "b" },
      ],
    }) as { items: Array<Record<string, unknown>> };
    expect(out.items[0]["token"]).toBe(MASK);
    expect(out.items[0]["id"]).toBe("a");
    expect(out.items[1]["token"]).toBe(MASK);
    expect(out.items[1]["id"]).toBe("b");
  });

  it("IMMUTABLE — KHÔNG mutate input gốc", () => {
    const input = { password: SAMPLE, nested: { token: SAMPLE } };
    const snapshot = JSON.parse(JSON.stringify(input));
    masker.mask(input);
    expect(input).toEqual(snapshot);
    expect(input.password).toBe(SAMPLE);
    expect(input.nested.token).toBe(SAMPLE);
  });

  it("null / undefined / primitive passthrough", () => {
    expect(masker.mask(null)).toBeNull();
    expect(masker.mask(undefined)).toBeUndefined();
    expect(masker.mask(42)).toBe(42);
    expect(masker.mask("plain")).toBe("plain");
    expect(masker.mask(true)).toBe(true);
  });

  it("KHÔNG đệ quy phá Date (giữ nguyên instance value)", () => {
    const d = new Date("2026-06-22T00:00:00.000Z");
    const out = masker.mask({ when: d, token: SAMPLE }) as Record<string, unknown>;
    expect(out["token"]).toBe(MASK);
    expect(out["when"]).toBeInstanceOf(Date);
    expect((out["when"] as Date).toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });
});
