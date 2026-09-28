import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * S16-TEST-PIPELINE-PARITY-1 — CENSUS «pipeline request của int-spec ↔ `src/main.ts`».
 *
 * Hai câu hỏi đo được, cả hai bằng AST (comment nhắc tên middleware KHÔNG được tính):
 *  1. `test/helpers/bootstrap-app.ts` có đăng ký ĐÚNG các khâu pipeline của `main.ts`, ĐÚNG thứ tự,
 *     ĐÚNG điều kiện không? Mọi lời gọi khác trên `app` ở `main.ts` phải được PHÂN LOẠI tường minh
 *     (`MAIN_ONLY_CALLS`) — một khâu mới thêm vào `main.ts` mà không ai phân loại ⇒ ĐỎ.
 *  2. Bao nhiêu spec còn tự dựng `createNestApplication` mà KHÔNG qua helper (ratchet chỉ được giảm).
 */

const API_ROOT = path.join(__dirname, "..", "..");
export const MAIN_TS = path.join(API_ROOT, "src", "main.ts");
export const HELPER_TS = path.join(API_ROOT, "test", "helpers", "bootstrap-app.ts");
const TEST_ROOT = path.join(API_ROOT, "test");

/** Khâu pipeline — PHẢI có mặt ở cả hai nơi, cùng thứ tự. */
export const PIPELINE_METHODS = new Set([
  "use",
  "useGlobalPipes",
  "useGlobalInterceptors",
  "useGlobalFilters",
  "useGlobalGuards",
]);

/**
 * Lời gọi của `main.ts` CỐ Ý không chép sang helper. Khoá = tên method trên `app`, hoặc tên hàm
 * nhận `app` làm đối số. Thêm dòng mới ở đây là một QUYẾT ĐỊNH — ghi lý do.
 */
export const MAIN_ONLY_CALLS: Readonly<Record<string, string>> = {
  getHttpAdapter:
    "trust proxy (CS-9) — spec đo req.ip tự đặt; đặt chung sẽ đổi ngữ nghĩa login_logs.ip_address của mọi spec",
  setGlobalPrefix:
    "int-spec gọi route KHÔNG tiền tố (/social/posts) — thêm prefix làm 404 mọi spec",
  enableCors: "CORS là việc của trình duyệt; supertest không gửi preflight",
  setupWebSocketAdapter: "adapter Valkey/Socket.IO — spec realtime tự dựng (chat-rt*)",
  setupSwagger: "OpenAPI — spec openapi-* tự mount",
  listen: "spec tự listen(0) sau init (census S18-QA-SUPERTESTLISTEN-1)",
};

export interface PipelineStep {
  readonly method: string;
  /** Đối số đầu đã chuẩn hoá: `requestIdMiddleware` · `new ZodValidationPipe`. */
  readonly arg: string;
  /** Khâu nằm trong nhánh `if` (vd kill-switch memo). */
  readonly conditional: boolean;
  /** Văn bản điều kiện của `if` bao quanh gần nhất (rỗng nếu không điều kiện). */
  readonly condition: string;
}

export interface BootScan {
  readonly steps: readonly PipelineStep[];
  /** Mọi lời gọi khác chạm `app` (method trên `app` hoặc hàm nhận `app`). */
  readonly otherCalls: readonly string[];
  /**
   * Khâu pipeline gọi NỐI CHUỖI (`app.use(a).use(b)`): mắt ngoài có receiver là CallExpression nên bộ
   * nhận dạng `app.<method>` không thấy ⇒ biến mất khỏi `steps` trong im lặng. Cấm thay vì đoán thứ tự.
   */
  readonly chained: readonly string[];
}

/** Gốc của chuỗi `app.a().b` — định danh ở đáy chuỗi, nếu có. */
function chainRoot(expr: ts.Expression): string | undefined {
  let cur: ts.Expression = expr;
  while (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  return ts.isIdentifier(cur) ? cur.text : undefined;
}

function argText(sf: ts.SourceFile, call: ts.CallExpression): string {
  const a = call.arguments[0];
  if (!a) return "";
  if (ts.isNewExpression(a)) return `new ${a.expression.getText(sf)}`;
  return a.getText(sf);
}

/** Đi ngược lên tìm `if` bao quanh (dừng ở biên hàm). */
function enclosingIf(node: ts.Node): ts.IfStatement | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur && !ts.isFunctionLike(cur)) {
    if (ts.isIfStatement(cur)) return cur;
    cur = cur.parent;
  }
  return undefined;
}

export function analyzeBoot(fileName: string, source: string, appVar = "app"): BootScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const steps: PipelineStep[] = [];
  const otherCalls: string[] = [];
  const chained: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        if (callee.expression.text === appVar) {
          const method = callee.name.text;
          if (PIPELINE_METHODS.has(method)) {
            const iff = enclosingIf(n);
            steps.push({
              method,
              arg: argText(sf, n),
              conditional: !!iff,
              condition: iff ? iff.expression.getText(sf) : "",
            });
          } else if (method !== "get" && method !== "init" && method !== "close") {
            otherCalls.push(method);
          }
        }
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isCallExpression(callee.expression) &&
        PIPELINE_METHODS.has(callee.name.text) &&
        chainRoot(callee.expression) === appVar
      ) {
        chained.push(`${callee.name.text}(${argText(sf, n)})`);
      } else if (
        ts.isIdentifier(callee) &&
        n.arguments.some((a) => ts.isIdentifier(a) && a.text === appVar)
      ) {
        otherCalls.push(callee.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { steps, otherCalls, chained };
}

export function readBoot(file: string): BootScan {
  return analyzeBoot(path.basename(file), fs.readFileSync(file, "utf8"));
}

/** Khác biệt pipeline main ↔ helper, dạng chuỗi dễ đọc; rỗng = khớp. */
export function pipelineDiff(main: BootScan, helper: BootScan): string[] {
  const out: string[] = [];
  const fmt = (s: PipelineStep) => `${s.method}(${s.arg})${s.conditional ? " [if]" : ""}`;
  const n = Math.max(main.steps.length, helper.steps.length);
  for (let i = 0; i < n; i++) {
    const m = main.steps[i];
    const h = helper.steps[i];
    if (!m) out.push(`#${i}: helper THỪA ${fmt(h!)}`);
    else if (!h) out.push(`#${i}: helper THIẾU ${fmt(m)}`);
    else if (m.method !== h.method || m.arg !== h.arg || m.conditional !== h.conditional)
      out.push(`#${i}: main=${fmt(m)} · helper=${fmt(h)}`);
  }
  return out;
}

/** Cờ env (`env.X`) mà điều kiện của khâu có-điều-kiện ở `main.ts` đọc. */
export function envFlagsOf(scan: BootScan): string[] {
  return scan.steps
    .filter((s) => s.conditional)
    .flatMap((s) => [...s.condition.matchAll(/\benv\.([A-Z0-9_]+)/g)].map((m) => m[1]!));
}

// ─── Ratchet: spec còn tự dựng pipeline ───────────────────────────────────────────────────────

export interface SpecBootScan {
  readonly file: string;
  readonly createsApp: boolean;
  /**
   * Import helper VÀ MỌI `createNestApplication(...)` trong file đều được bọc bởi `applyMainPipeline`
   * — trực tiếp, hoặc qua biến gán từ nó rồi truyền vào helper. Một lời gọi helper lạc chỗ (biến
   * khác, nhánh chết không bọc app nào) KHÔNG đủ để qua ratchet.
   */
  readonly usesHelper: boolean;
  /** Spec đã dùng helper mà VẪN tự đăng ký khâu pipeline ⇒ đăng ký đôi. */
  readonly handRolledSteps: readonly string[];
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "helpers" || d.name === "node_modules" ? [] : walk(p);
    return /\.(int|e2e)-spec\.ts$/.test(d.name) ? [p] : [];
  });
}

const HAND_ROLLED =
  /\.\s*(useGlobalPipes|useGlobalInterceptors|useGlobalFilters)\s*\(|\.use\(\s*(requestIdMiddleware|grantMemoMiddleware)\s*\)/g;

const CREATE = /\bcreateNestApplication\s*\(/g;
const WRAPPED_DIRECT = /\bapplyMainPipeline\s*\(\s*[\w.]+\.createNestApplication\s*\(/g;
const ASSIGNED = /\b(\w+)\s*=\s*[\w.]+\.createNestApplication\s*\(/g;

/** Mọi site `createNestApplication(` đều được bọc (trực tiếp hoặc qua biến truyền vào helper). */
function allAppsWrapped(code: string): boolean {
  const sites = [...code.matchAll(CREATE)].length;
  if (sites === 0) return false;
  const direct = [...code.matchAll(WRAPPED_DIRECT)].length;
  const viaVar = [...code.matchAll(ASSIGNED)].filter((m) =>
    new RegExp(`\\bapplyMainPipeline\\s*\\(\\s*${m[1]}\\b`).test(code),
  ).length;
  return direct + viaVar === sites;
}

export function analyzeSpec(file: string, source: string): SpecBootScan {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return {
    file,
    createsApp: /\bcreateNestApplication\s*\(/.test(code),
    usesHelper: /from\s+["'][./]*helpers\/bootstrap-app["']/.test(code) && allAppsWrapped(code),
    handRolledSteps: [...code.matchAll(HAND_ROLLED)].map((m) => m[1] ?? m[2]!),
  };
}

export function scanSpecs(): SpecBootScan[] {
  return walk(TEST_ROOT)
    .map((f) =>
      analyzeSpec(path.relative(TEST_ROOT, f).replace(/\\/g, "/"), fs.readFileSync(f, "utf8")),
    )
    .sort((a, b) => a.file.localeCompare(b.file));
}
