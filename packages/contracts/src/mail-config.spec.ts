import { describe, expect, it } from "vitest";
import {
  mailConfigScopeSchema,
  mailConfigSchema,
  upsertMailConfigSchema,
  testMailConfigSchema,
  mailTestResultSchema,
} from "./mail-config";

describe("CS-8 mail-config contracts (🔴 secret: no password in view DTO)", () => {
  it("mailConfigScopeSchema chấp nhận 'default' và 'app:<KEY>'", () => {
    expect(mailConfigScopeSchema.safeParse("default").success).toBe(true);
    expect(mailConfigScopeSchema.safeParse("app:studio").success).toBe(true);
    expect(mailConfigScopeSchema.safeParse("app:people-2").success).toBe(true);
  });

  it("mailConfigScopeSchema REJECT scope rác / hoa / khoảng trắng", () => {
    expect(mailConfigScopeSchema.safeParse("App:Studio").success).toBe(false);
    expect(mailConfigScopeSchema.safeParse("app: studio").success).toBe(false);
    expect(mailConfigScopeSchema.safeParse("random").success).toBe(false);
    expect(mailConfigScopeSchema.safeParse("app:").success).toBe(false);
  });

  it("mailConfigSchema (view DTO) KHÔNG có field password/cột envelope", () => {
    const dto = mailConfigSchema.parse({
      scope: "default",
      host: "smtp.example.com",
      port: 587,
      username: "noreply@example.com",
      secure: true,
      fromName: "Funtime",
      fromEmail: "noreply@example.com",
      hasPassword: true,
      updatedAt: new Date().toISOString(),
      password: "leaked-secret",
      secretCiphertext: "deadbeef",
    } as Record<string, unknown>);
    expect((dto as Record<string, unknown>).password).toBeUndefined();
    expect((dto as Record<string, unknown>).secretCiphertext).toBeUndefined();
    expect(dto.hasPassword).toBe(true);
  });

  it("upsertMailConfigSchema: password OPTIONAL (vắng OK → giữ envelope cũ)", () => {
    const res = upsertMailConfigSchema.safeParse({
      host: "smtp.example.com",
      port: 587,
      username: "noreply@example.com",
      fromEmail: "noreply@example.com",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.password).toBeUndefined();
  });

  it("upsertMailConfigSchema: port ngoài [1,65535] và email sai → REJECT", () => {
    expect(
      upsertMailConfigSchema.safeParse({
        host: "smtp.example.com",
        port: 70000,
        username: "x",
        fromEmail: "noreply@example.com",
      }).success,
    ).toBe(false);
    expect(
      upsertMailConfigSchema.safeParse({
        host: "smtp.example.com",
        port: 587,
        username: "x",
        fromEmail: "not-an-email",
      }).success,
    ).toBe(false);
  });

  it("testMailConfigSchema chấp nhận password optional", () => {
    expect(
      testMailConfigSchema.safeParse({
        host: "smtp.example.com",
        port: 587,
        username: "x",
      }).success,
    ).toBe(true);
  });

  it("mailTestResultSchema: ok + errorMessage optional", () => {
    expect(mailTestResultSchema.parse({ ok: true }).ok).toBe(true);
    expect(mailTestResultSchema.parse({ ok: false, errorMessage: "Xác thực SMTP thất bại" }).ok).toBe(false);
  });
});
