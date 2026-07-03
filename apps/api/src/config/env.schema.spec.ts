import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.schema";

describe("loadEnv", () => {
  it("applies defaults when optional vars are absent", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3100);
    expect(env.API_PREFIX).toBe("api");
    expect(env.API_VERSION).toBe("v1");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("coerces API_PORT from string", () => {
    const env = loadEnv({ API_PORT: "4000" } as NodeJS.ProcessEnv);
    expect(env.API_PORT).toBe(4000);
  });

  it("throws on invalid NODE_ENV", () => {
    expect(() => loadEnv({ NODE_ENV: "staging" } as unknown as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });

  it("throws on malformed DATABASE_URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "not-a-url" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("defaults KMS_PROVIDER to local with a KEK path", () => {
    const env = loadEnv({});
    expect(env.KMS_PROVIDER).toBe("local");
    expect(env.KMS_LOCAL_KEK_PATH).toBe(".secrets/local-kek.bin");
  });

  it("throws when KMS_PROVIDER=vault without addr/token", () => {
    expect(() => loadEnv({ KMS_PROVIDER: "vault" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });

  it("accepts KMS_PROVIDER=vault with addr+token", () => {
    const env = loadEnv({
      KMS_PROVIDER: "vault",
      KMS_VAULT_ADDR: "http://vault:8200",
      KMS_VAULT_TOKEN: "dev-token",
    } as NodeJS.ProcessEnv);
    expect(env.KMS_PROVIDER).toBe("vault");
  });

  it("leaves PLATFORM_OPERATOR_EMAIL undefined by default with sane defaults", () => {
    const env = loadEnv({});
    expect(env.PLATFORM_OPERATOR_EMAIL).toBeUndefined();
    expect(env.PLATFORM_OPERATOR_NAME).toBe("Platform Operator");
    expect(env.PLATFORM_OPERATOR_COMPANY_SLUG).toBe("demo");
  });

  it("throws when PLATFORM_OPERATOR_EMAIL is set without a password", () => {
    expect(() =>
      loadEnv({ PLATFORM_OPERATOR_EMAIL: "operator@demo.local" } as NodeJS.ProcessEnv),
    ).toThrow(/PLATFORM_OPERATOR_PASSWORD/);
  });

  it("throws when PLATFORM_OPERATOR_PASSWORD is shorter than 12 chars", () => {
    expect(() =>
      loadEnv({
        PLATFORM_OPERATOR_EMAIL: "operator@demo.local",
        PLATFORM_OPERATOR_PASSWORD: "short",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment variables/);
  });

  it("accepts a complete operator bootstrap config", () => {
    const env = loadEnv({
      PLATFORM_OPERATOR_EMAIL: "operator@demo.local",
      PLATFORM_OPERATOR_PASSWORD: "Operator@12345",
      PLATFORM_OPERATOR_COMPANY_SLUG: "acme",
    } as NodeJS.ProcessEnv);
    expect(env.PLATFORM_OPERATOR_EMAIL).toBe("operator@demo.local");
    expect(env.PLATFORM_OPERATOR_COMPANY_SLUG).toBe("acme");
  });

  it("defaults the worker scheduler to enabled with 5s/10s poll intervals", () => {
    const env = loadEnv({});
    expect(env.WORKERS_SCHEDULER_ENABLED).toBe("true");
    expect(env.OUTBOX_POLL_MS).toBe(5000);
    expect(env.EXPORT_POLL_MS).toBe(10000);
  });

  it("coerces worker poll intervals from strings", () => {
    const env = loadEnv({
      OUTBOX_POLL_MS: "2500",
      EXPORT_POLL_MS: "30000",
    } as NodeJS.ProcessEnv);
    expect(env.OUTBOX_POLL_MS).toBe(2500);
    expect(env.EXPORT_POLL_MS).toBe(30000);
  });

  it("accepts WORKERS_SCHEDULER_ENABLED=false (kill-switch)", () => {
    const env = loadEnv({ WORKERS_SCHEDULER_ENABLED: "false" } as NodeJS.ProcessEnv);
    expect(env.WORKERS_SCHEDULER_ENABLED).toBe("false");
  });

  // ── S2-FND-SEED-3 bootstrap default company (owner-chốt #4 — mapping param→cột companies) ──────────
  it("defaults BOOTSTRAP_COMPANY_* to a CHECK-safe demo tenant (language='vi' NOT 'vi-VN', currency='VND')", () => {
    const env = loadEnv({});
    expect(env.BOOTSTRAP_COMPANY_SLUG).toBe("demo"); // khớp PLATFORM_SUPERADMIN_COMPANY_SLUG → chuỗi bootstrap khép kín
    expect(env.BOOTSTRAP_COMPANY_NAME).toBe("Demo Company");
    expect(env.BOOTSTRAP_COMPANY_TIMEZONE).toBe("Asia/Ho_Chi_Minh");
    // language 'vi' (KHÔNG 'vi-VN') để qua companies_language_check IN ('vi','en') (mig 0015).
    expect(env.BOOTSTRAP_COMPANY_LANGUAGE).toBe("vi");
    expect(env.BOOTSTRAP_COMPANY_CURRENCY).toBe("VND");
  });

  it("rejects BOOTSTRAP_COMPANY_LANGUAGE='vi-VN' at the boundary (fail-fast trước CHECK companies.language)", () => {
    // 'vi-VN' vi phạm companies_language_check ⇒ enum ép loadEnv throw NGAY (không để function chạm CHECK runtime).
    expect(() =>
      loadEnv({ BOOTSTRAP_COMPANY_LANGUAGE: "vi-VN" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment variables/);
  });

  it("rejects BOOTSTRAP_COMPANY_CURRENCY outside {VND,USD} (khớp companies_currency_check)", () => {
    expect(() =>
      loadEnv({ BOOTSTRAP_COMPANY_CURRENCY: "EUR" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment variables/);
  });

  it("accepts an overridden BOOTSTRAP_COMPANY config (slug/name/language en)", () => {
    const env = loadEnv({
      BOOTSTRAP_COMPANY_SLUG: "acme",
      BOOTSTRAP_COMPANY_NAME: "Acme Corp",
      BOOTSTRAP_COMPANY_LANGUAGE: "en",
      BOOTSTRAP_COMPANY_CURRENCY: "USD",
    } as NodeJS.ProcessEnv);
    expect(env.BOOTSTRAP_COMPANY_SLUG).toBe("acme");
    expect(env.BOOTSTRAP_COMPANY_NAME).toBe("Acme Corp");
    expect(env.BOOTSTRAP_COMPANY_LANGUAGE).toBe("en");
    expect(env.BOOTSTRAP_COMPANY_CURRENCY).toBe("USD");
  });

  it("rejects a non-positive or non-numeric poll interval", () => {
    expect(() => loadEnv({ OUTBOX_POLL_MS: "0" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
    expect(() => loadEnv({ EXPORT_POLL_MS: "abc" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });
});
