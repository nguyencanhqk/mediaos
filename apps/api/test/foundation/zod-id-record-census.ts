import fs from "node:fs";
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
    if (ts.isCallExpression(n)) {
      if (isEmailParamsCall(n)) out.emailParamsCalls++;
      if (ts.isPropertyAccessExpression(n.expression)) {
        const name = n.expression.name.text;
        if (name === "uuid") out.uuidCalls.push(hit(n));
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

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" ? [] : walk(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts") ? [p] : [];
  });
}

export interface RepoScan {
  files: number;
  perPackageFiles: Record<string, number>;
  total: SourceScan;
}

/** Quét `src/` của 6 gói; bỏ qua lời gọi ở NHÀ hợp lệ của chúng (`common/id.ts`, `common/email.ts`). */
export function scanRepo(): RepoScan {
  const total = analyzeSource("<empty>.ts", "");
  const perPackageFiles: Record<string, number> = {};
  let files = 0;
  for (const pkg of PACKAGES) {
    const list = walk(path.join(REPO, pkg, "src"));
    perPackageFiles[pkg] = list.length;
    for (const abs of list) {
      files++;
      const rel = path.relative(REPO, abs).split(path.sep).join("/");
      const s = analyzeSource(rel, fs.readFileSync(abs, "utf8"));
      if (rel !== ID_HOME) total.uuidCalls.push(...s.uuidCalls);
      if (rel !== EMAIL_HOME) total.emailBare.push(...s.emailBare);
      total.recordOneArg.push(...s.recordOneArg);
      total.recordTwoArg += s.recordTwoArg;
      total.emailParamsCalls += s.emailParamsCalls;
      total.idSchemaRefs += s.idSchemaRefs;
    }
  }
  return { files, perPackageFiles, total };
}
