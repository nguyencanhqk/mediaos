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
});
