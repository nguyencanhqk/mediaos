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
 *   MANIFEST `test/storage-spec-files.json` = ĐÚNG tập tệp gọi `openStorageTestGate`; guard CI đòi TỪNG tệp trong đó
 *        phát nhãn run (`--expect-run-files`, cổng LIGHT F2) ⇒ chuỗi `FILE` truyền cho cổng phải là đường dẫn thật
 *        của chính tệp (cổng LIGHT F3-LOW). `turbo.json` passthrough đủ khoá `S3_*` (cổng LIGHT F1 — đường turbo).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const API = join(__dirname, "../../");
const ROOT = join(__dirname, "../../../../");
const GATE_HELPER = "test/helpers/storage-test-gate.ts";

/** Manifest dùng chung với `harness/lane-db-guard.mjs --expect-run-files` (đường dẫn tính từ apps/api). */
const MANIFEST = "test/storage-spec-files.json";
const STORAGE_FILES = JSON.parse(readFileSync(join(API, MANIFEST), "utf8")) as string[];

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
/**
 * Mã KHÔNG kèm chú thích (giữ nguyên số dòng): tài liệu nhắc tới mẫu cũ (vd `process.env.S3_BUCKET ??= …` trong
 * phần «vì sao» của helper) không được làm ratchet đỏ oan, và tên `openStorageTestGate` trong chú thích không được
 * tính là đã dùng. `//` sau `:` (URL `http://…`) không bị coi là chú thích.
 */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

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
      const lines = code(file).split(/\r?\n/);
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
          STORAGE_FILES.includes(file) || /from\s+["']@aws-sdk\/client-s3["']/.test(code(file)),
      )
      .filter((file) => !/\bopenStorageTestGate\b/.test(code(file)));
    expect(offenders).toEqual([]);
  });

  it("manifest = đúng tập tệp gọi openStorageTestGate; mỗi tệp truyền cho cổng ĐƯỜNG DẪN THẬT của chính nó", () => {
    const callers = SCANNED.filter((file) => file !== GATE_HELPER)
      .filter((file) => /\bopenStorageTestGate\s*\(/.test(code(file)))
      .sort();
    expect([...STORAGE_FILES].sort()).toEqual(callers);
    const badFileArg = STORAGE_FILES.filter((file) => {
      const src = code(file);
      const declared = src.match(/\bconst FILE\s*=\s*["']([^"']+)["']/)?.[1];
      return declared !== file || !/\bopenStorageTestGate\(\s*FILE\s*[,)]/.test(src);
    });
    expect(badFileArg).toEqual([]);
  });

  it("turbo.json globalPassThroughEnv có ĐỦ khoá S3_* của env.schema (strict env-mode không được xoá hồ sơ live)", () => {
    const schemaKeys = [
      ...readFileSync(join(API, "src/config/env.schema.ts"), "utf8").matchAll(
        /^\s*(S3_[A-Z_]+)\s*:/gm,
      ),
    ].map((m) => m[1]);
    expect(schemaKeys.length).toBeGreaterThan(0);
    const turbo = JSON.parse(readFileSync(join(ROOT, "turbo.json"), "utf8")) as {
      globalPassThroughEnv?: string[];
    };
    const missing = schemaKeys.filter((k) => !(turbo.globalPassThroughEnv ?? []).includes(k));
    expect(missing).toEqual([]);
  });

  it("vitest.config.ts: env ghim pinTestStorageEnv(process.env) + setupFiles có tripwire D-10", () => {
    const cfg = code("vitest.config.ts");
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
    expect(gateStep).toMatch(/--expect-run-files=apps\/api\/test\/storage-spec-files\.json/);
  });
});
