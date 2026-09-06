import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * S18-QA-SUPERTESTLISTEN-1 — CENSUS "request supertest chạy SONG SONG trên app CHƯA `listen`".
 *
 * ─── Khuyết tật đang đo ────────────────────────────────────────────────────────────────────────
 * `request(app.getHttpServer())` với một `INestApplication` mới `init()` (chưa `listen`) khiến
 * supertest TỰ mở một server tạm, và nó **tự `close()` khi request ĐẦU TIÊN trả về**. Một request
 * tại một thời điểm thì không ai thấy gì; `Promise.all([r1, r2])` thì request thứ hai rơi vào cái
 * server vừa bị đóng ⇒ `ECONNRESET` — xanh cục bộ, đỏ ở CI của một PR KHÔNG liên quan
 * (memory `supertest-closes-shared-server-on-first-response`). Vá đúng = `await app.listen(0)` ngay
 * sau `app.init()`; server thật sống suốt suite, `afterAll` đóng bằng `app.close()`.
 *
 * ⛔ KHÔNG được "vá" bằng cách đổi `Promise.all` thành vòng `await` tuần tự: supertest quyết định
 * listen LÚC `.then()` đầu tiên, nên một mảng dựng sẵn rồi await lần lượt còn tệ hơn
 * (`ECONNREFUSED` từ request #2), và nó XOÁ chính bất biến mà ca đua đang đo.
 *
 * ─── Vì sao AST + phân tích LAN TRUYỀN, không phải grep ─────────────────────────────────────────
 * Không file nào gọi `request(app.getHttpServer())` THẲNG bên trong `Promise.all`. Chúng gọi qua
 * helper cục bộ (`authPost` → `srv()` → `request(app.getHttpServer())`, hoặc `assign()` → `post()`
 * → `http()`), có nơi qua mảng trung gian (`Promise.all(calls)`). Grep theo cú pháp sẽ nói "không
 * có supertest nào trong `Promise.all`" ở CẢ 11 file thật (họ `refactor-to-helper-blinds-syntax-
 * census`). Nên census LAN TRUYỀN "vết supertest" qua các định danh cục bộ tới điểm bất động.
 *
 * Đổi lại, census CỐ Ý không phân biệt `Promise.all` gieo DB với `Promise.all` gọi HTTP bằng tên —
 * nó hỏi đúng một câu đo được: *đối số của `Promise.all` này có chạm vết supertest không*.
 */

const INTEGRATION_DIR = path.join(__dirname, "..", "integration");

/** Một `Promise.all(...)` trong file, kèm phán quyết "có chạm supertest hay không". */
export interface PromiseAllSite {
  readonly line: number;
  /** Đối số của `Promise.all` chạm `getHttpServer` hoặc một định danh đã nhiễm vết supertest. */
  readonly touchesSupertest: boolean;
}

export interface IntSpecScan {
  /** Tên file (basename) — khoá ổn định, không phụ thuộc số dòng. */
  readonly file: string;
  /** Biến app có gọi `init()` (một file dựng được NHIỀU app — `chat-rt1-realtime` có `app` + `app2`). */
  readonly apps: readonly string[];
  /** App đã `init()` mà CHÍNH NÓ chưa `listen()`. */
  readonly appsWithoutListen: readonly string[];
  /** App đã `listen()` mà CHÍNH NÓ không `close()` ⇒ rò cổng sang spec sau. */
  readonly appsListenedNotClosed: readonly string[];
  readonly promiseAlls: readonly PromiseAllSite[];
}

/**
 * Receiver của mọi `X.<method>(...)` trong file — `X` là TÊN BIẾN, không phải kiểu.
 *
 * ⚠️ Bản đầu của census bắt theo MỖI TÊN METHOD (`.listen(` ở bất kỳ đâu = "đã listen"). Đó là lỗ:
 * một `server.listen(9999)` của mock/WS server không liên quan sẽ dán nhãn AN TOÀN cho file mà
 * `app` thật chưa hề `listen` — cổng tự tắt trong im lặng. Nên phán quyết đi theo TỪNG receiver:
 * app nào `init()` thì chính app đó phải `listen()`.
 */
function receiversOf(sf: ts.SourceFile, method: string): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (
        (ts.isPropertyAccessExpression(callee) || ts.isPropertyAccessChain(callee)) &&
        callee.name.text === method
      ) {
        let recv: ts.Node = callee.expression;
        while (ts.isNonNullExpression(recv) || ts.isParenthesizedExpression(recv))
          recv = recv.expression;
        if (ts.isIdentifier(recv)) out.add(recv.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Mọi định danh xuất hiện trong cây con `n`. */
function identifiersIn(n: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (x: ts.Node): void => {
    if (ts.isIdentifier(x)) out.add(x.text);
    ts.forEachChild(x, visit);
  };
  visit(n);
  return out;
}

/** Gốc định danh của một lời gọi: `http` trong `http().post(u)`, `auth` trong `auth(x)`. */
function calleeRootName(call: ts.CallExpression): string | undefined {
  let cur: ts.Node = call.expression;
  for (;;) {
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isPropertyAccessChain(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur)) cur = cur.expression;
    else if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
    else return undefined;
  }
}

/** Mọi lời gọi trong cây con. */
function callsIn(n: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (x: ts.Node): void => {
    if (ts.isCallExpression(x)) out.push(x);
    ts.forEachChild(x, visit);
  };
  visit(n);
  return out;
}

interface Taint {
  /** Hàm/arrow cục bộ TRẢ VỀ một request supertest (`authPost`, `http`, `assign`…). */
  readonly fns: ReadonlySet<string>;
  /** Biến GIỮ request chưa `await` (`const calls = [authGet(…), authPost(…)]`). */
  readonly vals: ReadonlySet<string>;
}

/**
 * Vết supertest lan qua định danh cục bộ, tới điểm bất động.
 *
 * ⚠️ Vì sao tách `fns` với `vals`, và vì sao BỎ giá trị đã `await`: `const c1 = await createTask(…)`
 * là một **hàng task**, không phải một request đang bay. Coi nó là vết sẽ gắn cờ nhầm
 * `Promise.all([c1.id, c2.id].map(queryTask))` — một lô đọc DB THUẦN — và đó chính là hai dương-tính
 * giả đo được ở `task-subtask-tree` khi viết cổng này. Chỉ request CHƯA await mới đua được trên cùng
 * một server.
 */
function supertestTaint(sf: ts.SourceFile): Taint {
  interface FnDecl {
    readonly name: string;
    readonly body: ts.Node;
  }
  interface ValDecl {
    readonly name: string;
    readonly init: ts.Node;
  }
  const fnDecls: FnDecl[] = [];
  const valDecls: ValDecl[] = [];

  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      fnDecls.push({ name: n.name.text, body: n.body });
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        fnDecls.push({ name: n.name.text, body: init.body });
      } else if (!ts.isAwaitExpression(init)) {
        valDecls.push({ name: n.name.text, init });
      }
    } else if (
      // `calls = [http().get(…)]` — GÁN LẠI, không phải khai báo. Bỏ vế này thì
      // `let calls; calls = […]; await Promise.all(calls)` lọt cổng.
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(n.left) &&
      !ts.isAwaitExpression(n.right)
    ) {
      valDecls.push({ name: n.left.text, init: n.right });
    } else if (
      // `calls.push(http().get(…))` — bồi dần vào mảng. Cùng hình dạng đua, khác cú pháp.
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      (n.expression.name.text === "push" || n.expression.name.text === "unshift")
    ) {
      for (const a of n.arguments)
        if (!ts.isAwaitExpression(a))
          valDecls.push({ name: n.expression.expression.text, init: a });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const hasGetHttpServer = (n: ts.Node): boolean => identifiersIn(n).has("getHttpServer");
  const callsRequestFn = (n: ts.Node, fns: ReadonlySet<string>): boolean =>
    callsIn(n).some((c) => {
      const root = calleeRootName(c);
      return root !== undefined && fns.has(root);
    });

  const fns = new Set(fnDecls.filter((d) => hasGetHttpServer(d.body)).map((d) => d.name));
  for (let i = 0; i <= fnDecls.length; i++) {
    let grew = false;
    for (const d of fnDecls) {
      if (fns.has(d.name)) continue;
      if (callsRequestFn(d.body, fns)) {
        fns.add(d.name);
        grew = true;
      }
    }
    if (!grew) break;
  }

  const vals = new Set(
    valDecls
      .filter((d) => hasGetHttpServer(d.init) || callsRequestFn(d.init, fns))
      .map((d) => d.name),
  );
  return { fns, vals };
}

/** Phân tích MỘT nguồn — tách khỏi I/O để ca test tổng hợp gọi được (chống census xanh-rỗng). */
export function analyzeSource(file: string, text: string): IntSpecScan {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  const taint = supertestTaint(sf);

  const promiseAlls: PromiseAllSite[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "Promise" &&
      n.expression.name.text === "all"
    ) {
      const touches = n.arguments.some((a) => {
        if (identifiersIn(a).has("getHttpServer")) return true;
        if (
          callsIn(a).some((c) => {
            const r = calleeRootName(c);
            return r !== undefined && taint.fns.has(r);
          })
        )
          return true;
        return [...identifiersIn(a)].some((id) => taint.vals.has(id));
      });
      promiseAlls.push({
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        touchesSupertest: touches,
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const inited = receiversOf(sf, "init");
  const listened = receiversOf(sf, "listen");
  const closed = receiversOf(sf, "close");
  return {
    file: path.basename(file),
    apps: [...inited].sort(),
    appsWithoutListen: [...inited].filter((v) => !listened.has(v)).sort(),
    appsListenedNotClosed: [...listened].filter((v) => inited.has(v) && !closed.has(v)).sort(),
    promiseAlls,
  };
}

/** Quét mọi `apps/api/test/integration/*.int-spec.ts`. */
export function scanIntegrationSpecs(): readonly IntSpecScan[] {
  return fs
    .readdirSync(INTEGRATION_DIR)
    .filter((f) => f.endsWith(".int-spec.ts"))
    .sort()
    .map((f) => analyzeSource(f, fs.readFileSync(path.join(INTEGRATION_DIR, f), "utf8")));
}

/** File có request supertest chạy trong `Promise.all` mà app KHÔNG `listen` — cờ đang chờ nổ. */
export function offenders(scans: readonly IntSpecScan[] = scanIntegrationSpecs()): IntSpecScan[] {
  return scans.filter(
    (s) => s.appsWithoutListen.length > 0 && s.promiseAlls.some((p) => p.touchesSupertest),
  );
}

/** File đã `listen(0)` nhưng THIẾU `close()` ⇒ rò cổng sang spec sau. */
export function listenWithoutClose(
  scans: readonly IntSpecScan[] = scanIntegrationSpecs(),
): IntSpecScan[] {
  return scans.filter((s) => s.appsListenedNotClosed.length > 0);
}

/**
 * TRIPWIRE cho lỗ CÒN LẠI: census phân tích TỪNG FILE, không giải import.
 *
 * Hôm nay mọi builder request đều là helper CỤC BỘ trong chính int-spec ⇒ vết lan được. Ngày ai đó
 * gom `http()/authGet()/authPost()` về một `test/helpers/*.ts` dùng chung (đúng quy ước DRY của repo
 * này), MỌI file đã chuyển sẽ hoá vô hình với `touchesSupertest` — và các ca chống-xanh-rỗng đếm
 * theo TOÀN CORPUS vẫn sẽ xanh. Đó đúng là họ `refactor-to-helper-blinds-syntax-census`.
 *
 * Không vá được rẻ (phải giải import + taint xuyên file), nên thay vì im lặng chịu rủi ro, cổng
 * PHÁT HIỆN ĐÚNG NGÀY rủi ro thành hiện thực: helper dùng chung nào chạm `getHttpServer` ⇒ ĐỎ, kèm
 * yêu cầu nâng census. Danh sách rỗng = tiền đề "mọi builder là cục bộ" còn đúng.
 */
export function sharedRequestHelpers(): string[] {
  const dir = path.join(__dirname, "..", "helpers");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("getHttpServer"))
    .sort();
}
