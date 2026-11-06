import { beforeAll, describe, expect, it } from "vitest";
import { analyzeSource, PACKAGES, scanRepo, type RepoScan } from "./zod-id-record-census";

/**
 * S19-OPS-ZOD4-1 (C2.6) — RATCHET: không `.uuid(` ngoài `common/id.ts`, không `z.record(` một tham số, mọi
 * `.email(` mang `emailParams(...)`, không nạp `zod/v3` (vá FULL gate §10.8). Lý do đầy đủ ở docblock
 * `zod-id-record-census.ts`.
 *
 * ⚠️ Cổng đọc CÚ PHÁP nên tự mù được (đổi thư mục/đuôi file ⇒ census rỗng ⇒ ca chính xanh mà không đo gì). Vì
 * vậy có ca chống-xanh-rỗng trên cây thật và ca đo bộ nhận dạng bằng nguồn TỔNG HỢP.
 *
 * Quét repo ở `beforeAll` BẤT ĐỒNG BỘ (không ở thân `describe`): thân describe chạy đồng bộ lúc thu thập, chặn
 * worker nhiều giây ⇒ tinypool đứt IPC (ERR_IPC_CHANNEL_CLOSED, KI-014).
 */
describe("S19-OPS-ZOD4-1 — ratchet id/record/email/zod-v3 cho lần nâng zod 4", () => {
  let scan: RepoScan;
  beforeAll(async () => {
    scan = await scanRepo();
  }, 120_000);

  it("census KHÔNG rỗng: thấy đủ 6 gói và các lối đã chuẩn hoá", () => {
    for (const pkg of PACKAGES) {
      expect(scan.perPackageFiles[pkg], `không đọc được ${pkg}/src`).toBeGreaterThan(5);
    }
    expect(scan.files).toBeGreaterThan(1000);
    expect(scan.total.idSchemaRefs, "không thấy idSchema ⇒ census mù").toBeGreaterThan(1000);
    expect(scan.total.recordTwoArg, "không thấy z.record hai tham số").toBeGreaterThanOrEqual(11);
    expect(scan.total.emailParamsCalls, "không thấy emailParams(...)").toBeGreaterThanOrEqual(11);
  });

  it("KHÔNG lời gọi `.uuid(` nào ngoài packages/contracts/src/common/id.ts", () => {
    const bad = scan.total.uuidCalls.map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(
      bad,
      "Dùng `idSchema` / `idSchemaWith(msg)` từ @mediaos/contracts thay cho `.uuid(`",
    ).toEqual([]);
  });

  it("KHÔNG `z.record(` một tham số", () => {
    const bad = scan.total.recordOneArg.map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(bad, "Viết `z.record(z.string(), X)`").toEqual([]);
  });

  it("mọi `.email(` mang `emailParams(...)` (ngoài common/email.ts)", () => {
    const bad = scan.total.emailBare.map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(bad, "Dùng `emailSchema` hoặc `.email(emailParams(msg?))`").toEqual([]);
  });

  it("KHÔNG nạp `zod/v3` (mã 3.x chưa vá lỗ DoS đi kèm zod 4)", () => {
    const bad = scan.total.zodV3Refs.map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(bad, "Import từ `zod` (v4); KHÔNG dùng subpath `zod/v3`").toEqual([]);
  });

  it("bộ nhận dạng: bắt đúng lời gọi, bỏ qua chú thích/chuỗi", () => {
    const src = [
      "// z.string().uuid() trong chú thích",
      'const s = "z.record(x)";',
      "const a = z.string().uuid();",
      'const b = z.string().uuid("msg").optional();',
      "const c = z.record(z.unknown());",
      "const d = z\n  .record(z.number());",
      "const e = z.record(z.string(), z.unknown());",
      "const f = z.string().email();",
      'const g = z.string().trim().email("m");',
      "const h = z.string().email(emailParams());",
      "const i = idSchema.optional();",
      'const j = z.string()["uuid"]();',
    ].join("\n");
    const r = analyzeSource("synthetic.ts", src);
    expect(r.uuidCalls.map((h) => h.line)).toEqual([3, 4, 13]);
    expect(r.recordOneArg.map((h) => h.line)).toEqual([5, 6]);
    expect(r.recordTwoArg).toBe(1);
    expect(r.emailBare.map((h) => h.line)).toEqual([9, 10]);
    expect(r.emailParamsCalls).toBe(1);
    expect(r.idSchemaRefs).toBe(1);
  });

  it("bộ nhận dạng zod/v3: mọi dạng nạp module đều bị bắt; `zod`, `zod/v4`, `zod/v30x`, chuỗi/chú thích thì không", () => {
    const src = [
      'import { z } from "zod/v3";',
      'import * as z3 from "zod/v3/index.js";',
      'import type { ZodType } from "zod/v3";',
      'export { z as zz } from "zod/v3";',
      'export * from "zod/v3";',
      'import z4 = require("zod/v3");',
      'const r = require("zod/v3");',
      'const m = await import("zod/v3");',
      "const t = import(`zod/v3`);",
      'type T = typeof import("zod/v3");',
      'import "zod/v3";',
      // ↓ KHÔNG được bắt
      'import { z as ok } from "zod";',
      'import * as v4 from "zod/v4";',
      'import x from "zod/v30x";',
      'const note = "zod/v3";',
      "// import from 'zod/v3' trong chú thích",
    ].join("\n");
    const r = analyzeSource("synthetic-v3.ts", src);
    expect(r.zodV3Refs.map((h) => h.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const tsx = analyzeSource(
      "synthetic-v3.tsx",
      'import { z } from "zod/v3";\nexport const A = () => <div />;',
    );
    expect(tsx.zodV3Refs).toHaveLength(1);
  });
});
