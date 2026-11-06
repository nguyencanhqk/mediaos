import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { newWalk, walkSchema, type Walk } from "./zod-default-census";

/**
 * S19-OPS-ZOD4-1 (C3.7, plan §9.2-4) — census default trên MỌI schema export của `@mediaos/contracts` (dist đã
 * build) cộng schema cục bộ của web-core/app/auth/console. Lý do hình dạng: docblock `zod-default-census.ts`.
 *
 * Allowlist: khoá `<nguồn>:<export>` ⇒ lý do. Hiện RỖNG — census đo 0 vi phạm trên cây thật (plan §10.7).
 * Thêm mục = chấp nhận có chủ đích hành vi zod 4 áp default ở chỗ đó; phải kèm lý do.
 */
const ALLOW_OPTIONAL_OVER_DEFAULT: Record<string, string> = {};
const ALLOW_DEFAULT_OVER_OBJECT: Record<string, string> = {};

const flag = (w: Walk, allowO: Record<string, string>, allowD: Record<string, string>) => [
  ...w.optionalOverDefault.filter((f) => !allowO[key(f.path)]).map((f) => `${f.rule} @ ${f.path}`),
  ...w.defaultOverObject.filter((f) => !allowD[key(f.path)]).map((f) => `${f.rule} @ ${f.path}`),
];

const key = (p: string) => p.split(">")[0].replace(/ \(field.*$/, "");

interface ChildResult {
  files: number;
  apiFiles: number;
  schemas: number;
  failed: string[];
  walk: Walk;
  contractSchemas: number;
  contractsWalk: Walk;
}

/**
 * Census chạy trong tiến trình con (vite-node): nạp contracts + ~40 tệp FE ngay trong worker vitest làm pool sập. Dùng
 * `execFile` BẤT ĐỒNG BỘ — `spawnSync` chặn vòng lặp của worker nhiều giây và làm tinypool 2.2.0 đứt IPC
 * (`ERR_IPC_CHANNEL_CLOSED`) khi chạy cả thư mục.
 */
/**
 * vite-node (đi kèm vitest) chứ KHÔNG tsx: tệp FE import tên từ `@mediaos/contracts` (dist ESM không có `type:module`)
 * — Node thuần không thấy export đặt tên, vite-node xử lý như vitest.
 */
function viteNodeCli(): string {
  const fromVitest = createRequire(require.resolve("vitest/package.json"));
  return path.join(path.dirname(fromVitest.resolve("vite-node/package.json")), "vite-node.mjs");
}

function runCensusChild(): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [viteNodeCli(), path.join(__dirname, "zod-default-census-local.ts")],
      { encoding: "utf8", maxBuffer: 1 << 26, cwd: path.join(__dirname, "..", "..") },
      (err, stdout, stderr) => {
        const line = stdout.split(String.fromCharCode(10)).find((l) => l.startsWith("@@CENSUS@@"));
        if (!line)
          return reject(
            new Error(
              `tiến trình con không trả kết quả (${err?.message}): ${stderr.slice(0, 500)}`,
            ),
          );
        resolve(JSON.parse(line.slice("@@CENSUS@@".length)) as ChildResult);
      },
    );
  });
}

let cached: Promise<ChildResult> | undefined;
const census = (): Promise<ChildResult> => (cached ??= runCensusChild());

describe("S19-OPS-ZOD4-1 — census default (optional/default/prefault) trên schema export", () => {
  it("census KHÔNG rỗng: contracts có hàng trăm schema export, hàng nghìn nút", async () => {
    const r = await census();
    expect(r.contractSchemas, "không thấy schema export nào ⇒ census mù").toBeGreaterThan(300);
    expect(r.contractsWalk.nodes).toBeGreaterThan(3000);
  }, 120_000);

  it("contracts: không optional(default|prefault), không default(object có field default)", async () => {
    expect(
      flag((await census()).contractsWalk, ALLOW_OPTIONAL_OVER_DEFAULT, ALLOW_DEFAULT_OVER_OBJECT),
      "Dùng `.default(x)` rồi KHÔNG `.optional()`; với object dùng `.prefault({})` thay `.default({})`",
    ).toEqual([]);
  }, 120_000);

  it("schema cục bộ web-core/app/auth/console/api: cùng luật (mọi tệp phải nạp được)", async () => {
    const r = await census();
    expect(r.files, "không thấy tệp schema cục bộ").toBeGreaterThanOrEqual(15);
    expect(
      r.apiFiles,
      "không thấy schema của apps/api/src ⇒ census mù ở api",
    ).toBeGreaterThanOrEqual(3);
    expect(r.failed, "tệp schema cục bộ không nạp được ⇒ census mù ở đó").toEqual([]);
    expect(r.schemas).toBeGreaterThan(20);
    expect(r.walk.nodes).toBeGreaterThan(200);
    expect(flag(r.walk, ALLOW_OPTIONAL_OVER_DEFAULT, ALLOW_DEFAULT_OVER_OBJECT)).toEqual([]);
  }, 120_000);

  describe("bộ nhận dạng (nguồn TỔNG HỢP — chống xanh rỗng)", () => {
    const scan = (s: unknown) => {
      const w = newWalk();
      walkSchema(s, "syn:x", w);
      return w;
    };
    it("bắt optional bọc default và optional bọc prefault, kể cả lồng sâu", () => {
      expect(scan(z.string().default("x").optional()).optionalOverDefault).toHaveLength(1);
      expect(scan(z.string().prefault("x").optional()).optionalOverDefault).toHaveLength(1);
      const nested = z.object({ a: z.array(z.object({ b: z.number().default(1).optional() })) });
      expect(scan(nested).optionalOverDefault).toHaveLength(1);
    });
    it("bắt optional bọc default QUA lớp trung gian (vá FULL gate §10.8 — zod 4.6.7 vẫn áp default)", () => {
      const d = () => z.string().default("x");
      const shapes = {
        nullable: d().nullable().optional(),
        readonly: d().readonly().optional(),
        pipe: d().pipe(z.string()).optional(),
        transform: d()
          .transform((s) => s)
          .optional(),
        refine: d()
          .refine(() => true)
          .optional(),
        partial: z.object({ a: d().nullable() }).partial(),
      };
      for (const [name, s] of Object.entries(shapes)) {
        // Tiền đề: zod THẬT áp default ở hình dạng này (zod đổi hành vi ⇒ ca này báo để xét lại luật).
        const parsed = name === "partial" ? s.parse({}) : z.object({ a: s }).parse({});
        expect(parsed, name).toEqual({ a: "x" });
        expect(scan(s).optionalOverDefault, name).toHaveLength(1);
      }
      expect(scan(d().nullable().prefault("y").optional()).optionalOverDefault).toHaveLength(1);
    });
    it("KHÔNG báo optional bọc pipe khi default chỉ nằm ở phía `out`", () => {
      expect(
        scan(z.string().optional().pipe(z.string().default("x")).optional()).optionalOverDefault,
      ).toEqual([]);
    });
    it("bắt default bọc object có field default, và field default bọc nullable", () => {
      const obj = z.object({ a: z.string().default("x") });
      expect(scan(obj.default({ a: "y" })).defaultOverObject).toHaveLength(1);
      const obj2 = z.object({ a: z.string().default("x").nullable() });
      expect(scan(obj2.default({ a: "y" })).defaultOverObject).toHaveLength(1);
    });
    it("KHÔNG báo ca lành: prefault bọc object, default bọc object không field default, default thường", () => {
      const obj = z.object({ a: z.string().default("x") });
      expect(scan(obj.prefault({}))).toMatchObject({
        optionalOverDefault: [],
        defaultOverObject: [],
      });
      const plain = z.object({ a: z.string() }).default({ a: "y" }).optional();
      expect(scan(plain).defaultOverObject).toEqual([]);
      expect(scan(z.string().optional().default("x"))).toMatchObject({
        optionalOverDefault: [],
        defaultOverObject: [],
      });
    });
    it("đi xuyên union/record/pipe/lazy/intersection", () => {
      const bad = z.string().default("x").optional();
      expect(scan(z.union([z.string(), bad])).optionalOverDefault).toHaveLength(1);
      expect(scan(z.record(z.string(), bad)).optionalOverDefault).toHaveLength(1);
      expect(scan(z.lazy(() => bad)).optionalOverDefault).toHaveLength(1);
      const inter = z.intersection(z.object({ q: bad }), z.object({}));
      expect(scan(inter).optionalOverDefault).toHaveLength(1);
      expect(scan(bad.pipe(z.any())).optionalOverDefault).toHaveLength(1);
    });
  });
});
