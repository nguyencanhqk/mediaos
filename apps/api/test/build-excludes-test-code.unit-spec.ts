import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S16-SOCIAL-FILESVCSPLIT-1 — mã test (import vitest) trong src/ không được lọt vào dist PROD.
const API_ROOT = join(__dirname, "..");
const VITEST_IMPORT = /from\s+["']vitest["']/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe("tsconfig.build.json loại mã test khỏi dist", () => {
  const raw = readFileSync(join(API_ROOT, "tsconfig.build.json"), "utf8");
  const exclude: string[] = JSON.parse(raw).exclude;

  it("exclude phủ *.harness.ts", () => {
    expect(exclude).toContain("**/*.harness.ts");
  });

  it("mọi tệp src/ import vitest đều là *.spec.ts hoặc *.harness.ts", () => {
    const leaked = walk(join(API_ROOT, "src"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts") && !f.endsWith(".harness.ts"))
      .filter((f) => VITEST_IMPORT.test(readFileSync(f, "utf8")));
    expect(leaked).toEqual([]);
  });
});
