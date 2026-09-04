// harness/spec-file-re.test.mjs — cổng cho chính bộ lọc file spec của chunk runner.
//
// Sự cố 03–04/09/2026: regex thiếu nhánh `unit-` ⇒ chunk runner bỏ chạy 20 file `*.unit-spec.ts`
// của `apps/api` mà vẫn in "631/631 XANH". Ca (1) dưới đây là ca ĐỎ-nếu-quay-lại; ca (3) là ca đắt
// hơn và quan trọng hơn: nó KHÔNG tin danh sách hậu tố tự khai, mà đối chiếu với CÂY REPO THẬT.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SPEC_FILE_RE, SPEC_SUFFIXES, isSpecFile } from "./spec-file-re.mjs";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("(1) HỒI QUY: nhận đủ BỐN họ spec — `unit-spec` là họ từng bị bỏ quên", () => {
  for (const f of [
    "a.spec.ts",
    "a.spec.tsx",
    "test/foundation/login-log-429-ratchet.unit-spec.ts",
    "test/integration/auth.int-spec.ts",
    "test/foundation/openapi-docs.e2e-spec.ts",
  ]) {
    assert.equal(isSpecFile(f), true, `phải nhận là spec: ${f}`);
  }
});

test("(2) KHÔNG nhận nhầm file không phải spec", () => {
  for (const f of [
    "a.ts",
    "a.spec.js", // vitest ở repo này chỉ thu ts/tsx
    "spec.ts", // thiếu dấu chấm phân cách
    "a.unit-spec.md",
    "a-spec.ts",
    "specs/helper.ts",
  ]) {
    assert.equal(isSpecFile(f), false, `KHÔNG được nhận là spec: ${f}`);
  }
});

test("(3) NEO THEO CÂY THẬT: mọi hậu tố `*-spec.ts` đang tồn tại trong repo đều được khai", () => {
  // Vì sao không tin `SPEC_SUFFIXES`: bản cũ cũng "tự khai đủ" — ba nhánh, trông cân đối, và sai.
  // Chỉ có cây repo mới nói được sự thật. Ai thêm họ `*.smoke-spec.ts` mà quên khai ⇒ ca này ĐỎ,
  // thay vì 20 file lặng lẽ không bao giờ chạy.
  const out = execFileSync("git", ["ls-files", "--", "*.ts", "*.tsx"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const suffixes = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = /(?:^|\/)[^/]*?\.([a-z0-9]+-)?spec\.tsx?$/.exec(line.trim());
    if (m) suffixes.add(m[1] ?? "");
  }

  assert.ok(suffixes.size > 0, "không thấy file spec nào trong repo — lệnh git ls-files đang hỏng");

  const undeclared = [...suffixes].filter((s) => !SPEC_SUFFIXES.includes(s));
  assert.deepEqual(
    undeclared,
    [],
    `họ spec có trên đĩa nhưng KHÔNG khai trong SPEC_SUFFIXES ⇒ chunk runner sẽ bỏ chạy chúng ` +
      `trong im lặng: ${undeclared.map((s) => `*.${s}spec.ts`).join(", ")}`,
  );

  // Chiều ngược lại: hậu tố khai thừa không giấu file nào, nhưng nói dối về phạm vi ⇒ cảnh báo bằng
  // cách ĐỎ luôn, vì danh sách này là tài liệu cho người sau.
  const stale = SPEC_SUFFIXES.filter((s) => !suffixes.has(s));
  assert.deepEqual(stale, [], `SPEC_SUFFIXES khai họ không còn file nào: ${stale.join(", ")}`);
});

test("(4) regex là hằng KHÔNG mang cờ `g` — `.test()` có cờ g sẽ nhớ lastIndex và trả false xen kẽ", () => {
  assert.equal(SPEC_FILE_RE.flags.includes("g"), false);
  const f = "test/foundation/x.unit-spec.ts";
  assert.equal(SPEC_FILE_RE.test(f), true);
  assert.equal(SPEC_FILE_RE.test(f), true);
});
