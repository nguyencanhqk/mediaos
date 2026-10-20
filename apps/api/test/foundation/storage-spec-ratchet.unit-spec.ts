/**
 * S16-SOCIAL-STORAGETESTGATE-1 (plan §4 R4, D-9) — ratchet: int-spec chạm storage THẬT chỉ qua cổng chung.
 *
 * Đọc mã nguồn (không chạy gì). Tập quét: `test/**\/*.int-spec.ts` · `test/**\/*.e2e-spec.ts` ·
 * `src/**\/*.int.spec.ts` · `test/helpers/*.ts`. Unit `src/storage/*.spec.ts` tự gán `S3_*` nằm NGOÀI tập quét.
 *
 *   CẤM  `storageReady` · `hasStorage` · `CreateBucketCommand` (trừ helper cổng) · gán/xoá `process.env.S3_*`
 *        (`??=` hôm nay vô tác dụng vì `.env` nạp lúc import AppModule — ghim ở `test.env` thay thế, D-1).
 *   DƯƠNG tệp import `@aws-sdk/client-s3` hoặc thuộc 11 tệp storage của plan §1.2 ⇒ phải dùng `openStorageTestGate`.
 *   CẤU TRÚC `vitest.config.ts` ghim `pinTestStorageEnv(process.env)` trong `env` + tripwire D-10 trong `setupFiles`;
 *        `.github/workflows/api.yml` bước Test có `shell: bash` (pipefail — B1) và bước «Storage int-spec gate».
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const GATE_HELPER = "test/helpers/storage-test-gate.ts";

/** 11 tệp storage của plan §1.2 (đường dẫn tính từ apps/api). */
const STORAGE_FILES = [
  "files-e2e-confirm",
  "hr-employee-avatar",
  "me-preferences-avatar",
  "temp-file-cleanup",
  "s15-payroll-be5b-pdf",
  "s15-payroll-be5b-pdf-batch",
  "s15-payroll-qa1-idor-leak",
  "s15-payroll-qa1-race",
  "s13-payroll-qa1-scope-floor",
  "s16-filedisposition-storage",
  "s19-storage-provider-compat",
].map((n) => `test/integration/${n}.int-spec.ts`);

function walk(rel: string, keep: (p: string) => boolean): string[] {
  return (readdirSync(join(API, rel), { recursive: true }) as string[])
    .map((p) => `${rel}/${p.replace(/\\/g, "/")}`)
    .filter(keep);
}

const SCANNED = [
  ...walk("test", (p) => /\.(int|e2e)-spec\.ts$/.test(p)),
  ...walk("src", (p) => /\.int\.spec\.ts$/.test(p)),
  ...readdirSync(join(API, "test/helpers"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `test/helpers/${f}`),
];
const source = (rel: string) => readFileSync(join(API, rel), "utf8");

const S3_ENV_WRITE = /process\.env(?:\.|\[["'])S3_[A-Z_]+(?:["']\])?\s*(?:\?\?=|\|\|=|=(?!=))/;
const S3_ENV_DELETE = /delete\s+process\.env(?:\.|\[["'])S3_/;
const BANNED: ReadonlyArray<{ rule: string; re: RegExp; exempt?: string }> = [
  { rule: "storageReady", re: /\bstorageReady\b/ },
  { rule: "hasStorage", re: /\bhasStorage\b/ },
  { rule: "CreateBucketCommand", re: /\bCreateBucketCommand\b/, exempt: GATE_HELPER },
  { rule: "gán process.env.S3_*", re: S3_ENV_WRITE },
  { rule: "xoá process.env.S3_*", re: S3_ENV_DELETE },
];

describe("R4 — ratchet int-spec storage (D-9)", () => {
  it("11 tệp storage của plan tồn tại và nằm trong tập quét", () => {
    for (const f of STORAGE_FILES) {
      expect(existsSync(join(API, f)), f).toBe(true);
      expect(SCANNED, f).toContain(f);
    }
  });

  it("không tệp nào trong tập quét dùng mẫu bị cấm", () => {
    const offenders: string[] = [];
    for (const file of SCANNED) {
      const lines = source(file).split(/\r?\n/);
      for (const { rule, re, exempt } of BANNED) {
        if (file === exempt) continue;
        lines.forEach((text, i) => {
          if (re.test(text)) offenders.push(`${file}:${i + 1} ${rule}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("tệp import @aws-sdk/client-s3 hoặc thuộc 11 tệp storage ⇒ dùng openStorageTestGate", () => {
    const offenders = SCANNED.filter((file) => file !== GATE_HELPER)
      .filter(
        (file) =>
          STORAGE_FILES.includes(file) || /from\s+["']@aws-sdk\/client-s3["']/.test(source(file)),
      )
      .filter((file) => !/\bopenStorageTestGate\b/.test(source(file)));
    expect(offenders).toEqual([]);
  });

  it("vitest.config.ts: env ghim pinTestStorageEnv(process.env) + setupFiles có tripwire D-10", () => {
    const cfg = source("vitest.config.ts");
    expect(cfg).toMatch(/env:\s*\{[^}]*\.\.\.pinTestStorageEnv\(process\.env\)/);
    expect(cfg).toMatch(/setupFiles:\s*\[[^\]]*storage-call-tripwire/);
  });

  it("api.yml: bước Test có `shell: bash` (pipefail) + `tee`; bước «Storage int-spec gate» strict + --fail-unless-ok", () => {
    const yml = readFileSync(join(ROOT, ".github/workflows/api.yml"), "utf8");
    const steps = yml.split(/\n\s*- name: /);
    const testStep = steps.find((s) => s.startsWith("Test (unit + integration"));
    expect(testStep, "bước Test").toBeDefined();
    expect(testStep).toMatch(/\n\s*shell: bash\s*\n/);
    expect(testStep).toMatch(/\|\s*tee\s/);
    const gateStep = steps.find((s) => s.startsWith("Storage int-spec gate"));
    expect(gateStep, "bước Storage int-spec gate").toBeDefined();
    expect(gateStep).toMatch(/\n\s*shell: bash\s*\n/);
    expect(gateStep).toMatch(/lane-db-guard\.mjs[\s\S]*--strict=1[\s\S]*--fail-unless-ok=1/);
  });
});
