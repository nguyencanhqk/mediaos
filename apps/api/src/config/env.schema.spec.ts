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

  it("rejects a non-positive or non-numeric poll interval", () => {
    expect(() => loadEnv({ OUTBOX_POLL_MS: "0" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
    expect(() => loadEnv({ EXPORT_POLL_MS: "abc" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment variables/,
    );
  });
});
