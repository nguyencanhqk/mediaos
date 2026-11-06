import { promises as fsp } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * S19-OPS-ZOD4-1 (C2.6, plan §9.2-8) — census AST cho ba lối zod dễ vỡ khi nâng 3 → 4, trên `src/` của 6 gói.
 *
 *  - `.uuid(`  : zod 4 `z.uuid()`/`.uuid()` CHẶT RFC ⇒ từ chối id canonical đang sống (`…0010`, `…00a1`…). Mọi
 *                id đi qua `idSchema`/`idSchemaWith` (`packages/contracts/src/common/id.ts` — nơi DUY NHẤT gọi `.uuid(`).
 *  - `z.record(X)` một tham số: kiểu TS zod 4 đòi hai tham số ⇒ viết `z.record(z.string(), X)`.
 *  - `.email(`  : mọi lời gọi phải mang `emailParams(...)` (hoặc nằm trong `common/email.ts`) để pha C3 gắn
 *                regex zod 3 ở MỘT chỗ.
 *  - `zod/v3`  : zod 4.6.7 vẫn KÈM mã 3.x CHƯA VÁ ở subpath `zod/v3` (lỗ DoS GHSA-mrhx-c7xc-m3w5: mảng 2 triệu phần
 *                tử `.max(10)` vẫn duyệt hết — reviewer đo lại trên 4.6.7). Cấm `zod/v3` và `zod/v3/*` ở import,
 *                export-from, `import x = require`, `require(`, `import(` động và kiểu `import("…")` (vá FULL gate §10.8).
 *
 * Đọc AST (CallExpression + PropertyAccess), KHÔNG regex thô ⇒ chú thích/chuỗi không bị khớp.
 */

const REPO = path.join(__dirname, "..", "..", "..", "..");
export const PACKAGES = [
  "packages/contracts",
  "packages/web-core",
  "apps/app",
  "apps/auth",
  "apps/console",
  "apps/api",
] as const;
const ID_HOME = "packages/contracts/src/common/id.ts";
const EMAIL_HOME = "packages/contracts/src/common/email.ts";

export interface Hit {
  file: string;
  line: number;
  text: string;
}

export interface SourceScan {
  uuidCalls: Hit[];
  zodV3Refs: Hit[];
  recordOneArg: Hit[];
  recordTwoArg: number;
  emailBare: Hit[];
  emailParamsCalls: number;
  idSchemaRefs: number;
}

function isZRecord(n: ts.CallExpression): boolean {
  const e = n.expression;
  return (
    ts.isPropertyAccessExpression(e) &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === "z" &&
    e.name.text === "record"
  );
}

const ZOD_V3 = /^zod\/v3(\/|$)/;

/** Tên phương thức được gọi: `x.name(` hoặc `x["name"](` (ElementAccess chuỗi — vá FULL gate §10.8). */
function calledName(e: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression))
    return e.argumentExpression.text;
  return null;
}

/** Chuỗi đặc tả module mà nút này nạp (import/export-from/import=require/require()/import()/import type), nếu có. */
function moduleSpecifierOf(n: ts.Node): string | null {
  const lit = (e: ts.Node | undefined): string | null =>
    e && ts.isStringLiteralLike(e) ? e.text : null;
  if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return lit(n.moduleSpecifier);
  if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference))
    return lit(n.moduleReference.expression);
  if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) return lit(n.argument.literal);
  if (ts.isCallExpression(n)) {
    const isRequire = ts.isIdentifier(n.expression) && n.expression.text === "require";
    if (isRequire || n.expression.kind === ts.SyntaxKind.ImportKeyword) return lit(n.arguments[0]);
  }
  return null;
}

function isEmailParamsCall(n: ts.Expression | undefined): boolean {
  return (
    !!n &&
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === "emailParams"
  );
}

/** Quét MỘT nguồn (file thật hoặc nguồn tổng hợp trong spec). */
export function analyzeSource(file: string, text: string): SourceScan {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out: SourceScan = {
    uuidCalls: [],
    zodV3Refs: [],
    recordOneArg: [],
    recordTwoArg: 0,
    emailBare: [],
    emailParamsCalls: 0,
    idSchemaRefs: 0,
  };
  const hit = (n: ts.Node): Hit => ({
    file,
    line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
    text: n.getText().slice(0, 120),
  });
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && (n.text === "idSchema" || n.text === "idSchemaWith"))
      out.idSchemaRefs++;
    const spec = moduleSpecifierOf(n);
    if (spec !== null && ZOD_V3.test(spec)) out.zodV3Refs.push(hit(n));
    if (ts.isCallExpression(n)) {
      if (isEmailParamsCall(n)) out.emailParamsCalls++;
      if (calledName(n.expression) === "uuid") out.uuidCalls.push(hit(n));
      if (ts.isPropertyAccessExpression(n.expression)) {
        const name = n.expression.name.text;
        if (name === "email" && !(n.arguments.length === 1 && isEmailParamsCall(n.arguments[0]))) {
          out.emailBare.push(hit(n));
        }
      }
      if (isZRecord(n)) {
        if (n.arguments.length === 1) out.recordOneArg.push(hit(n));
        else out.recordTwoArg++;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

async function walk(dir: string): Promise<string[]> {
  // Thư mục vắng ⇒ rỗng (ca chống-xanh-rỗng đòi > 5 tệp/gói sẽ đỏ); lỗi khác ⇒ ném, không nuốt.
  const entries = await fsp
    .readdir(dir, { withFileTypes: true })
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
  const nested = await Promise.all(
    entries.map(async (e): Promise<string[]> => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" ? [] : walk(p);
      return /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts") ? [p] : [];
    }),
  );
  return nested.flat();
}

export interface RepoScan {
  files: number;
  perPackageFiles: Record<string, number>;
  total: SourceScan;
}

/** Số tệp parse liền giữa hai lần nhường vòng lặp sự kiện. */
const YIELD_EVERY = 40;
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Quét `src/` của 6 gói; bỏ qua lời gọi ở NHÀ hợp lệ của chúng (`common/id.ts`, `common/email.ts`).
 * BẤT ĐỒNG BỘ + nhường vòng lặp mỗi `YIELD_EVERY` tệp (vá FULL gate §10.8): parse ~2.000 tệp liền một mạch chặn
 * worker vitest nhiều giây ⇒ tinypool đứt IPC (ERR_IPC_CHANNEL_CLOSED, KI-014) khi chạy cả thư mục.
 */
export async function scanRepo(): Promise<RepoScan> {
  const total = analyzeSource("<empty>.ts", "");
  const perPackageFiles: Record<string, number> = {};
  let files = 0;
  for (const pkg of PACKAGES) {
    const list = (await walk(path.join(REPO, pkg, "src"))).sort();
    perPackageFiles[pkg] = list.length;
    for (const abs of list) {
      files++;
      if (files % YIELD_EVERY === 0) await yieldLoop();
      const rel = path.relative(REPO, abs).split(path.sep).join("/");
      const s = analyzeSource(rel, await fsp.readFile(abs, "utf8"));
      if (rel !== ID_HOME) total.uuidCalls.push(...s.uuidCalls);
      if (rel !== EMAIL_HOME) total.emailBare.push(...s.emailBare);
      total.zodV3Refs.push(...s.zodV3Refs);
      total.recordOneArg.push(...s.recordOneArg);
      total.recordTwoArg += s.recordTwoArg;
      total.emailParamsCalls += s.emailParamsCalls;
      total.idSchemaRefs += s.idSchemaRefs;
    }
  }
  return { files, perPackageFiles, total };
}
