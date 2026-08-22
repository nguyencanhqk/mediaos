import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * S6-SEC-IDENTITY-PROJ-1 — CENSUS điểm chiếu danh tính người (`users.email` / `users.fullName`).
 *
 * ⚠️ ĐỌC TRƯỚC KHI TIN CON SỐ NÀY — lớp bằng chứng của file này YẾU HƠN hai census anh em.
 * `fk-tenant-census.ts` và `route-census.ts` đều ghi bất biến "**0 regex trên mã nguồn**": chúng đọc
 * `information_schema` (nguồn DB) và `collectRoutes()` (nguồn runtime của Nest). File này thì
 * **parse tĩnh mã nguồn** — đúng thứ hai file kia tồn tại để tránh (`route-census.ts` liệt kê 4 lần
 * con số sai 49→38→114→40 chính vì parse tĩnh). Cái được tái dùng từ hai khuôn đó là **sổ phán quyết
 * + ratchet**, KHÔNG phải nguồn census.
 *
 * Vì thế: con số ở đây là **CẬN DƯỚI**, sai số dồn về phía "đã phủ" (tức GIẤU khoảng trống). Ba đường
 * scanner KHÔNG thấy được đo riêng thành `blindSpots()` và bị PIN trong sổ phán quyết; chiều đo
 * runtime (đếm cột danh tính thật sự có trong response ở ca ALLOW) nằm ở int-spec, không ở đây.
 *
 * Cái nó LÀM được — ba đường mà `grep users.email` TRƯỢT (memory
 * `identity-projection-census-misses-alias`: census 2026-07-29 báo 40+ điểm/7 module trong khi số
 * thật là 79/31):
 *   1. `const owner = alias(users, "owner_user")` rồi `owner.fullName`;
 *   2. `...getTableColumns(users)` — chiếu TOÀN BỘ cột kể cả email mà KHÔNG có chuỗi `users.email` nào;
 *   3. bản đồ cột hằng (`const LIST_COLUMNS = {…}` ở cấp module rồi `.select(LIST_COLUMNS)`) — census
 *      2026-07-30 xếp nhóm này vào bucket "hỗn hợp" và đếm THIẾU 19 điểm.
 */

// tsconfig module=commonjs → `__dirname`, không `import.meta` (mẫu route-http-coverage.e2e-spec).
const SRC_ROOT = path.join(__dirname, "..", "..", "src");

/** Cột danh tính NGƯỜI. `users.id` KHÔNG phải danh tính (UUID không đọc được bằng mắt). */
const IDENTITY_COLS = new Set(["email", "fullName"]);

/**
 * Hàm vị từ của drizzle. Một điểm nằm trong lời gọi này là VỊ TỪ (lớp *oracle* — dò tồn tại qua tìm
 * kiếm), KHÔNG cùng lớp lỗ với CHIẾU. Gộp hai lớp vào một con số rồi báo động là sai (`src[]` của WO).
 */
const PREDICATE_FNS = new Set([
  "eq",
  "ne",
  "ilike",
  "like",
  "notIlike",
  "inArray",
  "notInArray",
  "gt",
  "gte",
  "lt",
  "lte",
  "isNull",
  "isNotNull",
  "between",
  "exists",
  "notExists",
]);

export type ProjectionKind =
  | "PROJECTION"
  | "PREDICATE"
  | "ORDER"
  | "GROUP"
  | "JOIN"
  | "WRITE"
  | "OTHER";

export interface IdentityPoint {
  /** Đường dẫn tương đối từ `apps/api/src`, forward-slash. */
  readonly file: string;
  readonly line: number;
  /** Hàm/hằng bao quanh — phần thứ hai của khoá. */
  readonly fn: string;
  /** CÁCH chiếu: `users.email` · `owner.fullName` · `getTableColumns(users)`. Phần thứ ba của khoá. */
  readonly expr: string;
  readonly kind: ProjectionKind;
}

/**
 * Khoá điểm = `file#fn:expr`.
 *
 * ⚠️ Khoá ghim ĐỊNH NGHĨA, không ghim TÊN (memory `index-ratchet-must-pin-definition-not-name`):
 * `expr` mang cả cách chiếu, nên đổi `users.email` → `getTableColumns(users)` là khoá ĐỔI ⇒ phải ký lại.
 *
 * `fn` NẰM TRONG khoá là CÓ CHỦ ĐÍCH: đổi tên một hàm chiếu danh tính là thao tác phải cập nhật sổ.
 * Cái giá là rename thuần cũng bắn ĐỎ — ratchet bù bằng cách in cặp diff (khoá mất / khoá mới) trong
 * cùng file, để sửa sổ chỉ tốn một dòng.
 */
export function pointKey(p: IdentityPoint): string {
  return `${p.file}#${p.fn}:${p.expr}`;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Mã nguồn sản phẩm — spec KHÔNG tính (test dựng fixture chiếu email là chuyện khác). */
function sourceFiles(): string[] {
  return walkFiles(SRC_ROOT).filter((f) => !/\.spec\.ts$/.test(f));
}

function rel(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join("/");
}

/** Identifier đã bind tới bảng `users` trong file này: `users` + mọi `alias(users, …)`. */
function boundIdentifiers(sf: ts.SourceFile, text: string): Map<string, string> {
  const bound = new Map<string, string>();
  if (/from\s+["'][^"']*db\/schema[^"']*["']/.test(text) && /\busers\b/.test(text)) {
    bound.set("users", "direct");
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const call = node.initializer;
      if (ts.isIdentifier(call.expression) && call.expression.text === "alias") {
        const [target, label] = call.arguments;
        if (
          target &&
          ts.isIdentifier(target) &&
          target.text === "users" &&
          ts.isIdentifier(node.name)
        ) {
          bound.set(
            node.name.text,
            label && ts.isStringLiteral(label) ? `alias(${label.text})` : "alias(?)",
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Lặp tới điểm bất động cho phép GÁN LẠI: `const actor = SECURITY_EVENT_ACTOR` khi
  // `SECURITY_EVENT_ACTOR = alias(users, "sec_event_actor")` ở cấp module.
  //
  // ⚠️ Đây KHÔNG phải chỗ tối ưu — nó là một vùng mù ĐÃ CẮN THẬT. Khi `S6-SEC-IDENTITY-PROJ-1` nâng
  // alias cục bộ lên cấp module (để service dựng được vị từ trên đúng cột của vai actor), scanner mất
  // dấu 2 điểm chiếu NGAY LẬP TỨC và ratchet báo "verdict mồ côi" thay vì báo "điểm mồ côi" — tức
  // census âm thầm hẹp lại đúng lúc code được vá. Một thao tác refactor tầm thường là đủ để làm mù.
  for (let pass = 0; pass < 5; pass++) {
    let grew = false;
    const relink = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        bound.has(node.initializer.text) &&
        !bound.has(node.name.text)
      ) {
        bound.set(node.name.text, bound.get(node.initializer.text)!);
        grew = true;
      }
      ts.forEachChild(node, relink);
    };
    relink(sf);
    if (!grew) break;
  }
  // Import từ file khác (`import { SECURITY_EVENT_ACTOR } from "./security-event.repository"`) chưa
  // được lần theo — scanner làm việc trên MỘT file. Ghi ra đây để vùng mù có tên, và để lần sau ai
  // gặp một điểm chiếu "biến mất" thì biết chỗ mà nhìn.
  return bound;
}

/**
 * Phân loại theo TỔ TIÊN CÚ PHÁP, không theo tên biến.
 *
 * Thứ tự kiểm có ý nghĩa: vị từ (`ilike(users.email, …)`) được bắt TRƯỚC nhánh object-literal, vì ô
 * tìm kiếm dựng `conds[]` rồi mới `and(...conds)` — nó nằm trong mảng chứ không nằm trong `.where()`,
 * và nếu để nhánh object-literal bắt trước thì 8 vị từ tìm-kiếm bị đếm nhầm thành CHIẾU.
 */
function classify(node: ts.Node): ProjectionKind {
  let cur: ts.Node | undefined = node.parent;
  let insideObjectLiteral = false;
  while (cur) {
    if (
      ts.isCallExpression(cur) &&
      ts.isIdentifier(cur.expression) &&
      PREDICATE_FNS.has(cur.expression.text)
    ) {
      return "PREDICATE";
    }
    if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
      switch (cur.expression.name.text) {
        case "select":
        case "selectDistinct":
        case "returning":
          return "PROJECTION";
        case "where":
        case "having":
          return "PREDICATE";
        case "orderBy":
          return "ORDER";
        case "groupBy":
          return "GROUP";
        case "on":
          return "JOIN";
        case "set":
        case "values":
          return "WRITE";
      }
    }
    if (ts.isObjectLiteralExpression(cur)) insideObjectLiteral = true;
    cur = cur.parent;
  }
  // Bản đồ cột hằng ở cấp module: không có tổ tiên `.select()` trong CÙNG cây cú pháp, nhưng
  // `.select(LIST_COLUMNS)` bên dưới vẫn phát nó ra response ⇒ vẫn là CHIẾU.
  return insideObjectLiteral ? "PROJECTION" : "OTHER";
}

/** Hàm/hằng bao quanh. Method > function > biến gần nhất (bắt được bản đồ cột hằng). */
function enclosing(node: ts.Node, sf: ts.SourceFile): string {
  let cur: ts.Node | undefined = node.parent;
  let nearestVar = "?";
  while (cur) {
    if (ts.isMethodDeclaration(cur) && cur.name) return cur.name.getText(sf);
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name) && nearestVar === "?") {
      nearestVar = cur.name.text;
    }
    cur = cur.parent;
  }
  return nearestVar;
}

/** Mọi điểm chạm `users.email`/`users.fullName` trong `apps/api/src`, đã phân loại. */
export function collectIdentityPoints(): IdentityPoint[] {
  const points: IdentityPoint[] = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const bound = boundIdentifiers(sf, text);
    if (bound.size === 0) continue;

    const lineOf = (n: ts.Node): number =>
      sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const base = node.expression.text;
        if (bound.has(base) && IDENTITY_COLS.has(node.name.text)) {
          points.push({
            file: rel(file),
            line: lineOf(node),
            fn: enclosing(node, sf),
            expr: `${base}.${node.name.text}`,
            kind: classify(node),
          });
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "getTableColumns"
      ) {
        const [target] = node.arguments;
        if (target && ts.isIdentifier(target) && bound.has(target.text)) {
          const kind = classify(node);
          points.push({
            file: rel(file),
            line: lineOf(node),
            fn: enclosing(node, sf),
            expr: `getTableColumns(${target.text})`,
            // Spread cột vào object chiếu: `.select({...getTableColumns(users)})` phát ra MỌI cột.
            kind: kind === "OTHER" ? "PROJECTION" : kind,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return points;
}

export function projectionPoints(): IdentityPoint[] {
  return collectIdentityPoints().filter((p) => p.kind === "PROJECTION");
}

/**
 * S10-SEC-AUDITLOGROW-1 (KI-070) — ĐIỂM ĐÚC vị từ chặn **TẬP HÀNG**, tức mọi call-site
 * `fromScope(…, "scoped-predicate", …)` trong `apps/api/src`.
 *
 * VÌ SAO đếm ĐÚC chứ không đếm TIÊU THỤ: `rowScopeSql()` (cổng tiêu thụ) đã assert `basis` + BẢNG,
 * nên một vị từ SAI không đi qua nó được. Cái nó KHÔNG bắt được là một grant `scoped-predicate` được
 * đúc ở nơi mới rồi đem AND thẳng vào `WHERE` **không qua cổng** — hoàn toàn hợp kiểu (`grant.cond`
 * là một `SQL` như mọi `SQL` khác), và im lặng theo đúng chiều nguy hiểm: `WHERE` trông như đã bound
 * trong khi bảng có thể lệch.
 *
 * Đây là bộ đếm CHỦ ĐÍCH-hẹp, khác ba chiều `blindSpots()` ở chỗ nó KHÔNG đo một vùng mù — nó đo một
 * bề mặt NHÌN THẤY ĐƯỢC và pin nó lại, để mở rộng bề mặt là một hành vi phải KÝ chứ không phải một
 * dòng diff lọt qua LIGHT gate. Trả về khoá `file#hàm` (đã sắp) chứ không chỉ số đếm: khi ĐỎ, người
 * sửa cần biết điểm MỚI nằm ở đâu, không phải một con số lệch.
 *
 * ⚠️ Trần của nó: `fromScope` có thể được gọi với basis là một BIẾN thay vì literal — dạng đó scanner
 * này KHÔNG thấy (và cũng không ai viết hôm nay). Cùng lớp cận-dưới với cả file, nói ra ở đây để nó
 * không được đọc mạnh hơn thực tế.
 */
export function rowScopePredicateMints(): string[] {
  const sites: string[] = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("scoped-predicate")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "fromScope"
      ) {
        const basis = node.arguments[1];
        if (basis && ts.isStringLiteral(basis) && basis.text === "scoped-predicate") {
          sites.push(`${rel(file)}#${enclosing(node, sf)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites.sort();
}

/**
 * S10-SEC-AUDITLOGROW-2 (KI-072) — file chạm họ `*UnscopedTx` của `AuditRepository`, tức đường đọc
 * `audit_logs` **KHÔNG bound HÀNG**.
 *
 * VÌ SAO cần một bộ đếm RIÊNG, không gộp vào `rowScopePredicateMints()`: hàm kia đếm điểm **ĐÚC** vị
 * từ. Chiều còn lại — **TIÊU THỤ sai đường** — nó không thấy. Sau WO này `AuditRepository` có HAI họ
 * phương thức, và họ không-bound vẫn public: một đường đọc COMPANY mới viết
 * `this.repo.findManyUnscopedTx(tx, filter, limit, offset)` là **hợp kiểu và XANH tuyệt đối**, tái
 * sinh KI-072 ở bề mặt thứ hai mà cả typecheck lẫn ratchet đúc đều mù.
 *
 * Pin thành DANH SÁCH (không phải trần đếm) vì cùng lý do với `ROW_SCOPE_MINT_PINS`: trần cho phép
 * ĐỔI CHỖ trong im lặng.
 *
 * Khoá là `file#<số lời gọi>`, KHÔNG phải `file` trần (⟲FULL gate, security-reviewer). Bản đầu pin
 * theo FILE và vì thế **hụt đúng chỗ nguy hiểm nhất**: `foundation/audit/audit.service.ts` ĐÃ nằm
 * trong danh sách (cho đường operator `/all`), nên một đường đọc COMPANY mới viết NGAY TRONG file đó
 * mà gọi `findManyUnscopedTx` sẽ cho ratchet XANH — mà đó chính là file có xác suất mọc thêm đường
 * đọc audit cao nhất. Cùng vấn đề với `attendance-audit`/`leave-audit`. Đếm lời gọi đóng nhánh đó.
 *
 * ⚠️ Bằng chứng YẾU có chủ đích — parse chuỗi, không phải call-graph. Phát biểu ĐÚNG mức của nó:
 * *"thêm một LỜI GỌI họ `*UnscopedTx` ở bất kỳ file nào trong `apps/api/src` là ĐỎ"*. Nó KHÔNG thấy:
 * (a) lời gọi gián tiếp qua biến/alias (`const fn = repo.findManyUnscopedTx`) hoặc index động;
 * (b) đường đọc `audit_logs` KHÔNG qua họ phương thức nào — `tx.select().from(auditLogs)` trực tiếp,
 *     đúng cách `chat/chat-oversight.repository.ts` đang đọc bảng này hôm nay.
 * Nó là PIN, không phải census. Đừng viết vào docblock nào rằng nó ép được nhiều hơn thế.
 */
export function unscopedAuditConsumers(): string[] {
  const hits: string[] = [];
  const re = /\b(?:findManyUnscopedTx|countUnscopedTx|findByIdUnscopedTx)\b/g;
  for (const file of sourceFiles()) {
    const n = (fs.readFileSync(file, "utf8").match(re) ?? []).length;
    if (n > 0) hits.push(`${rel(file)}#${n}`);
  }
  return hits.sort();
}

export interface BlindSpots {
  /**
   * Số file EXPORT một `alias(users, …)` ra ngoài. Scanner lần alias trong MỘT file; một alias được
   * export rồi import ở file khác là vùng mù — đúng thứ đã cắn khi WO này nâng `SECURITY_EVENT_ACTOR`
   * lên cấp module. Pin thành số để nó không nới ra trong im lặng (F12).
   */
  readonly exportedUserAliases: number;
  /**
   * `.select()` KHÔNG tham số **trên bảng `users`** — chiếu TOÀN BỘ cột (kể cả `email`/`full_name`)
   * mà scanner không thấy tên cột nào.
   *
   * Chỉ đếm khi `.from(<identifier đã bind tới users>)` nằm trong CÙNG chuỗi gọi. Đếm mọi `.select()`
   * trần trong `apps/api/src` cho ra 151 — phần lớn là bảng không có danh tính, một con số nhảy theo
   * mọi WO ⇒ ratchet nhiễu tới mức không ai đọc. Bộ đếm phải hẹp đúng bằng vùng mù nó mô tả.
   */
  readonly bareSelect: number;
  /** Template `sql` ghép tên cột danh tính bằng CHUỖI THÔ — ngoài tầm phân tích identifier. */
  readonly rawSqlIdentity: number;
  /**
   * Ép kiểu TƯỜNG MINH sang `IdentityGrant` **NGOÀI** điểm đúc `permission/identity-projection.ts`.
   * Brand `unique symbol` chặn object literal thuần nhưng không chặn ép kiểu ⇒ đây là đường forge dễ
   * nhất, và nó phải LUÔN bằng 0.
   *
   * ⚠️ KHÔNG phải đường DUY NHẤT (security-reviewer 2026-08-19, F6): một giá trị `any` gán vào biến
   * kiểu `IdentityGrant` không cần lời ép nào. Bộ đếm này thu hẹp bề mặt, không đóng kín nó.
   */
  readonly asIdentityGrant: number;
}

/**
 * Ba đường scanner KHÔNG thấy, đo thành SỐ để pin trong sổ phán quyết.
 *
 * Vì sao phải pin thay vì chỉ ghi một câu "đây là cận dưới": một giới hạn ở dạng văn xuôi thì phiên
 * sau không đo được nó có nới ra hay không. Pin số ⇒ thêm một `.select()` trần là ĐỎ, và người thêm
 * phải nói ra mình đang mở rộng vùng mù.
 *
 * `asIdentityGrant` là chiều bịt lỗ mà TẦNG TYPE không bịt được: `{ cond, why }` ép kiểu sang
 * `IdentityGrant` là hợp lệ với TypeScript (brand chỉ chặn object literal thuần), và
 * `.claude/hooks/anti-bandaid-guard.mjs` chỉ chặn các chỉ thị tắt type-check/tắt linter — nó không
 * đụng tới toán tử ép kiểu.
 */
export function blindSpots(): BlindSpots {
  let bareSelect = 0;
  let rawSqlIdentity = 0;
  let asIdentityGrant = 0;
  let exportedUserAliases = 0;

  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const bound = boundIdentifiers(sf, text);
    const isGrantFactory = rel(file) === "permission/identity-projection.ts";

    /** `.select()` → đi LÊN chuỗi gọi tìm `.from(X)`; true khi X đã bind tới `users`. */
    const selectsFromUsers = (select: ts.Node): boolean => {
      let cur: ts.Node | undefined = select.parent;
      while (cur) {
        if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
          if (cur.expression.name.text === "from") {
            const [target] = cur.arguments;
            return !!target && ts.isIdentifier(target) && bound.has(target.text);
          }
        } else if (!ts.isPropertyAccessExpression(cur)) {
          return false; // hết chuỗi gọi trước khi gặp `.from()`
        }
        cur = cur.parent;
      }
      return false;
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "select" &&
        node.arguments.length === 0 &&
        selectsFromUsers(node)
      ) {
        bareSelect++;
      }
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        node.tag.text === "sql"
      ) {
        if (/\b(email|full_name)\b/.test(node.template.getText(sf))) rawSqlIdentity++;
      }
      // Điểm đúc DUY NHẤT được miễn: `permission/identity-projection.ts` bắt buộc phải ép kiểu một
      // lần để gắn brand (brand là kiểu-thời-biên-dịch, không có giá trị runtime). Mọi nơi khác ép
      // kiểu sang `IdentityGrant` là FORGE một căn cứ — đường duy nhất qua mặt được tầng type.
      // Bắt CẢ `x as IdentityGrant` lẫn `<IdentityGrant>x`, và cả dạng hợp (`as IdentityGrant | null`).
      // ⚠️ VẪN KHÔNG bắt được: một giá trị `any` gán thẳng vào biến kiểu `IdentityGrant` — `any` xuyên
      // qua brand mà không cần lời ép nào. Đó là lý do docblock của L1 nói "chặn được đường ép kiểu
      // TƯỜNG MINH", không nói "đường duy nhất".
      if (
        !isGrantFactory &&
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        /\bIdentityGrant\b/.test(node.type.getText(sf))
      ) {
        asIdentityGrant++;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    if (/export\s+const\s+\w+\s*=\s*alias\(\s*users\s*,/.test(text)) exportedUserAliases++;
  }
  return { bareSelect, rawSqlIdentity, asIdentityGrant, exportedUserAliases };
}
