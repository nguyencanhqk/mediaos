import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * S10-SEC-LOGINLOG429-1 (KI-047) — CENSUS "điểm ném 429 KHÔNG để lại vết".
 *
 * ⚠️ VÌ SAO TỒN TẠI. KI-047 mở ngày 29/07 với "4 đường 429 không ghi log". Đo lại ngày 24/08 ra
 * **5** — `step-up/step-up.service.ts` mọc thêm một điểm ném mà **không ai thấy**, vì không có gì
 * đếm. Vá 5 đường là việc một lần; thứ làm nợ quay lại là điểm ném **THỨ BẢY**. Đây là cái đếm đó.
 *
 * ⚠️ AST CHỨ KHÔNG REGEX. Cùng lý do đã trả giá ở `body-validation-census.ts` (regex sai BA lần) và
 * `identity-projection-census.ts` (49→38→114→40): grep không biết `throw` này nằm trong nhánh nào,
 * và `grep -c TOO_MANY_REQUESTS` đếm cả 4 dòng `expect(...)` của `step-up.service.spec.ts`.
 *
 * ─── BẤT BIẾN ĐANG ĐO ───────────────────────────────────────────────────────────────────────────
 * Gọi `B` = **`Block` TRONG CÙNG NHẤT** chứa nút `throw` ném `HttpStatus.TOO_MANY_REQUESTS`.
 * Điểm ném ĐẠT khi có ít nhất một lời gọi ghi nhật ký (`recordLoginAttempt` hoặc
 * `securityEvents.record`) là **HẬU DUỆ của `B`**.
 *
 * ⚠️ "Hậu duệ của block trong cùng nhất" — KHÔNG phải "câu lệnh anh em" và KHÔNG phải "cùng `try`".
 * Đường `login()` (`auth.service.ts:241-273`) là đường DUY NHẤT đang ĐÚNG và nó có hình dạng
 * `if { startedAt; try { ghi } finally { sàn }; throw }`: lời gọi ghi nằm trong `try`, còn `throw`
 * là anh em của `try`. Phát biểu lỏng hơn sẽ báo vi phạm OAN đúng cái đường đã vá. Xem
 * `docs/plans/S10-SEC-LOGINLOG429-1.md` §5.
 *
 * ⚠️ Mức HÀM là quá thô, đừng quay lại. `completeTwoFactorLogin` có 5 nhánh từ chối; nếu tính
 * "hàm có lời gọi ghi" thì một refactor bỏ ghi ở nhánh 429 vẫn XANH nhờ lời gọi ở nhánh thành công.
 *
 * LỚP BẰNG CHỨNG. Parse TĨNH ⇒ đây là cận dưới, và nó KHÔNG chứng minh hàng thật rơi xuống DB —
 * việc đó là của int-spec trong `test/integration/`. Census giữ vai trò khác: chặn điểm ném thứ bảy
 * mọc lên im lặng.
 */

// tsconfig module=commonjs → `__dirname`, không `import.meta` (mẫu body-validation-census).
const AUTH_SRC = path.join(__dirname, "..", "..", "src", "auth");

/**
 * Lời gọi được tính là "để lại vết". Tên method, khớp ở đuôi property-access.
 *
 * `recordLoginAttemptForUser` là biến thể "đã biết tenant+user, chưa biết email" (tự SELECT email
 * trong CHÍNH tx sắp INSERT). Phải liệt kê TƯỜNG MINH: quên nó thì ba nhánh vừa vá của bước-2 2FA
 * bị báo vi phạm OAN, và áp lực sẽ là nới luật — chứ không phải sửa danh sách.
 */
const WRITE_CALLS = new Set(["recordLoginAttempt", "recordLoginAttemptForUser", "record"]);

/** Với `record` phải thêm điều kiện object — `audit.record` KHÔNG tính (xem `isWriteCall`). */
const SECURITY_EVENT_RECEIVERS = new Set(["securityEvents"]);

export interface ThrowSite {
  /** Đường dẫn tương đối từ `apps/api/src/auth`, dấu `/`. */
  readonly file: string;
  readonly line: number;
  /** `<Class>#<method>` — khoá ổn định hơn số dòng (dòng trôi mỗi lần sửa file). */
  readonly key: string;
  /** Có lời gọi ghi nhật ký là hậu duệ của block trong cùng nhất chứa `throw` không. */
  readonly logsInBranch: boolean;
}

function walk(dir: string, out: string[], keep: (n: string) => boolean): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      walk(p, out, keep);
    } else if (keep(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
}

/** `HttpStatus.TOO_MANY_REQUESTS` xuất hiện ở đâu đó trong cây con của `node`. */
function mentionsTooManyRequests(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isPropertyAccessExpression(n) &&
      n.name.text === "TOO_MANY_REQUESTS" &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "HttpStatus"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * `this.recordLoginAttempt(...)` hoặc `this.securityEvents.record(...)` / `this.securityEvents?.record(...)`.
 *
 * ⚠️ `audit.record(...)` KHÔNG tính: `audit_logs` là nhật ký HÀNH ĐỘNG, không phải nhật ký
 * đăng nhập/bảo mật per-account mà KI-047 nói tới. Nếu tính cả nó thì nhánh company-inactive của
 * bước-2 (đã có `audit.record`) sẽ tự qua cổng mà không ghi một dòng `login_logs` nào.
 */
function isWriteCall(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false;
  const callee = n.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const method = callee.name.text;
  if (!WRITE_CALLS.has(method)) return false;
  if (method !== "record") return true;

  // `this.securityEvents.record` / `this.securityEvents?.record` → object là property-access `securityEvents`.
  const recv = callee.expression;
  const recvName = ts.isPropertyAccessExpression(recv)
    ? recv.name.text
    : ts.isIdentifier(recv)
      ? recv.text
      : "";
  return SECURITY_EVENT_RECEIVERS.has(recvName);
}

function hasWriteCallDescendant(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (isWriteCall(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** `Block` TRONG CÙNG NHẤT bao quanh `node`; null khi `throw` nằm trần ở thân hàm rút gọn. */
function innermostBlock(node: ts.Node): ts.Block | null {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isBlock(p)) return p;
  }
  return null;
}

/** `<Class>#<method>` của hàm bao quanh; rơi về tên file khi `throw` nằm ngoài class. */
function enclosingKey(node: ts.Node, fallback: string): string {
  let method = "";
  for (let p = node.parent; p; p = p.parent) {
    if (!method && (ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name) {
      method = p.name.getText();
    }
    if (ts.isClassDeclaration(p) && p.name) {
      return `${p.name.text}#${method || "(anonymous)"}`;
    }
  }
  return `${fallback}#${method || "(anonymous)"}`;
}

/**
 * Mọi điểm ném `HttpStatus.TOO_MANY_REQUESTS` trong `apps/api/src/auth/**` (BỎ `*.spec.ts` —
 * assert của test không phải điểm ném; đếm cả chúng là cách `grep -c` ra số sai).
 */
export function tooManyRequestsThrowSites(): readonly ThrowSite[] {
  const out: ThrowSite[] = [];

  for (const f of walk(AUTH_SRC, [], (n) => n.endsWith(".ts") && !n.endsWith(".spec.ts"))) {
    const sf = parse(f);
    const rel = path.relative(AUTH_SRC, f).split(path.sep).join("/");
    const base = path.basename(f, ".ts");

    const visit = (node: ts.Node): void => {
      if (
        ts.isThrowStatement(node) &&
        node.expression &&
        mentionsTooManyRequests(node.expression)
      ) {
        const block = innermostBlock(node);
        out.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          key: enclosingKey(node, base),
          logsInBranch: block ? hasWriteCallDescendant(block) : false,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** Điểm ném 429 KHÔNG để lại vết trong chính nhánh của nó — phải RỖNG trừ waiver đã ký. */
export function silentTooManyRequestsSites(): readonly ThrowSite[] {
  return tooManyRequestsThrowSites().filter((s) => !s.logsInBranch);
}

/**
 * NEO DƯƠNG cho waiver `stepUp` (§1.2 của plan): waiver đứng được CHỈ KHI nửa (b) của bản vá A09
 * còn nguyên — mọi nhánh từ chối CÓ ghi vết của `stepUp` vẫn bồi bucket (`recordFailure`) và vẫn
 * ghi outcome. Xoá nửa (b) ⇒ trần lưu trữ quay lại VÔ HẠN ⇒ waiver mất cơ sở ⇒ ratchet phải ĐỎ.
 *
 * Trả số lời gọi `recordFailure` + `writeOutcome` trong `step-up.service.ts`.
 */
export function stepUpAntiAmplificationAnchors(): { recordFailure: number; writeOutcome: number } {
  const f = path.join(AUTH_SRC, "step-up", "step-up.service.ts");
  const sf = parse(f);
  let recordFailure = 0;
  let writeOutcome = 0;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text;
      if (name === "recordFailure") recordFailure += 1;
      if (name === "writeOutcome") writeOutcome += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { recordFailure, writeOutcome };
}

/**
 * NEO DƯƠNG cho waiver của BA đường post-auth (`disableTwoFactor` · `changePassword` ·
 * `confirmEnable`) — §1.1 của plan. Trả tập ngữ cảnh xác thực-lại-thất-bại ĐANG ĐƯỢC GHI.
 *
 * ⚠️ VÌ SAO KHÔNG NEO Ở MỨC HÀM. Ba đường này được waiver ở nhánh 429 vì chúng ghi vết ở nhánh
 * **SAI** (đường DỰNG NÊN khoá), không ở nhánh **ĐÃ KHOÁ**. Nếu neo bằng "hàm có lời gọi ghi" thì
 * `changePassword` qua cổng SẴN nhờ `PASSWORD_CHANGED` ở nhánh THÀNH CÔNG (`auth.service.ts`)
 * — waiver thành dây thừa, xoá lời ghi ở nhánh sai vẫn XANH ([[tests-can-pin-a-hole-open]]).
 *
 * ⚠️ VÀ KHÔNG NEO Ở `payload` CỦA WRITER. Writer nhận ngữ cảnh qua THAM SỐ và ghi
 * `payload: { context }` dạng shorthand ⇒ trong writer KHÔNG có literal nào để đọc. Ngữ cảnh thật
 * nằm ở **LỜI GỌI** `recordReauthFailure(..., "<context>")` — tức đúng ba nhánh sai. Đó là chỗ neo.
 * (Bản đầu của census này neo nhầm vào `payload` và trả về TẬP RỖNG — ca ratchet đỏ đúng lúc, chứ
 * nếu điều kiện viết ngược chiều thì nó đã xanh-RỖNG và không ai biết.)
 *
 * Cặp với `reauthFailedWriterCount()`: một cái chứng minh CÓ writer ghi đúng `event_type`, cái kia
 * chứng minh writer đó được gọi từ đủ ba nhánh. Thiếu vế nào cũng là neo hở.
 */
export function reauthFailedContexts(): ReadonlySet<string> {
  const found = new Set<string>();

  for (const f of walk(AUTH_SRC, [], (n) => n.endsWith(".ts") && !n.endsWith(".spec.ts"))) {
    const sf = parse(f);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const name = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isIdentifier(callee)
            ? callee.text
            : "";
        if (name === "recordReauthFailure") {
          for (const arg of n.arguments) {
            if (ts.isStringLiteralLike(arg)) found.add(arg.text);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return found;
}

/**
 * Số lời gọi `securityEvents.record` mang `eventType: "REAUTH_FAILED"`. Vế thứ hai của neo dương:
 * chứng minh `recordReauthFailure` THẬT SỰ ghi mã đó, chứ không phải một hàm cùng tên làm việc khác.
 */
export function reauthFailedWriterCount(): number {
  let count = 0;
  for (const f of walk(AUTH_SRC, [], (n) => n.endsWith(".ts") && !n.endsWith(".spec.ts"))) {
    const sf = parse(f);
    const visit = (n: ts.Node): void => {
      if (isWriteCall(n) && ts.isCallExpression(n)) {
        for (const arg of n.arguments) {
          if (
            ts.isObjectLiteralExpression(arg) &&
            hasStringProp(arg, "eventType", "REAUTH_FAILED")
          ) {
            count += 1;
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return count;
}

function propValue(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText().replace(/["']/g, "") === name) {
      return p.initializer;
    }
  }
  return null;
}

function hasStringProp(obj: ts.ObjectLiteralExpression, name: string, value: string): boolean {
  const v = propValue(obj, name);
  return !!v && ts.isStringLiteralLike(v) && v.text === value;
}
