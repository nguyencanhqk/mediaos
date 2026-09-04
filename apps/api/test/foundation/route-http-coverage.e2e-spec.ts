/**
 * S10-QA-ROUTEHTTP-1 — PHÉP ĐO độ phủ test HTTP của route API (thay số 98/346 đã cũ ở KI-025).
 *
 * CÂU HỎI TRẢ LỜI: route nào (Controller#method) CHƯA từng bị một test đi qua HTTP THẬT (supertest)
 * chạm tới? Đây KHÔNG phải phép đo permission/guard — dùng `route-census.ts` (S6-SEC-ROUTEMAP-1) cho
 * việc đó. Phép đo này đo ĐỘ PHỦ TEST, một trục hoàn toàn khác.
 *
 * VÌ SAO KHÔNG boot app rồi tự bắn HTTP thật tới từng route (điều đó cần seed dữ liệu/permission cho
 * cả 499 route — quá tốn cho một phép đo). Thay vào đó, đây là SCAN TĨNH có kiểm soát trên các file
 * test đã tồn tại: với mỗi file `*.spec.ts`/`*-spec.ts` dưới `apps/api/test/**` và `apps/api/src/**`
 * có `from "supertest"`, gom (a) tập VERB xuất hiện dạng `.get(`/`.post(`/`.put(`/`.patch(`/`.delete(`
 * và (b) tập chuỗi trông giống PATH (bắt đầu bằng "/") xuất hiện bất kỳ đâu trong file. Một route được
 * tính là "có bằng chứng phủ" nếu tồn tại ÍT NHẤT MỘT file vừa có verb khớp `route.httpMethod` vừa có
 * một path-literal khớp segment-by-segment với route (`:param` ở route và `${expr}` ở literal đều coi
 * là khớp bất kỳ).
 *
 * GIỚI HẠN CỐ Ý — SAI CHIỀU NGUY HIỂM, đọc kỹ trước khi dùng số này (ghi rõ để không ai hiểu nhầm
 * đây là bằng chứng runtime hay trần đo được):
 *   - Không xác nhận verb và path THỰC SỰ được gọi CÙNG NHAU trên cùng một dòng — nhiều file dùng biến
 *     trung gian (`const u = ...; request(app.getHttpServer()).get(u)`); scan gom verb-set và path-set
 *     ở CẤP FILE, không cấp câu lệnh. Hệ quả: một file chỉ cần có `.post(` ở đâu đó TRONG FILE và một
 *     chuỗi path khớp ở đâu đó KHÁC trong CÙNG FILE (không liên quan gì tới nhau) là route đã bị tính
 *     "covered". Đây là RỦI RO CHÍNH của phép đo và là chiều NGUY HIỂM cho mục đích tìm lỗ: số
 *     "covered" có thể CAO HƠN thực tế (false-positive), tức GIẤU khoảng trống thật thay vì lộ nó ra.
 *   - KHÔNG chứng minh test đó có ca ALLOW (2xx) hay chỉ ca DENY — chỉ chứng minh route bị "chạm".
 *   - Vì vậy: số "covered" / % ở đây là CẬN TRÊN (upper bound) của độ phủ thật, KHÔNG phải cận dưới —
 *     độ phủ THẬT chắc chắn ≤ số đo được ở đây. Dùng để XẾP HẠNG rủi ro rồi viết test HTTP thật cho
 *     nhóm cao nhất; TUYỆT ĐỐI KHÔNG tuyên bố "route X đã kiểm đủ" chỉ vì `covered === true` — phải mở
 *     `evidenceFiles` ra đọc thật để biết có ca ALLOW hay chỉ trùng verb/path ngẫu nhiên trong file.
 *
 * KHÔNG cần Postgres: `collectRoutes` chỉ đọc metadata app đã boot (giống openapi-docs.e2e-spec), scan
 * file chỉ đọc filesystem. Vì vậy KHÔNG skipIf(!hasDb) — chạy trong `pnpm test` mặc định.
 */

import "reflect-metadata";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { collectRoutes, routeKey, type RouteInfo } from "./route-census";

const TEST_ROOT = join(__dirname, "..");
const SRC_ROOT = join(__dirname, "..", "..", "src");
type HttpVerb = "get" | "post" | "put" | "patch" | "delete";

/** Route bị coi là "ghi/nhạy cảm" ⇒ xếp hạng rủi ro cao hơn route chỉ đọc. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Ngưỡng riskScore dùng để định nghĩa "route rủi ro cao" cho RATCHET ở cuối file. Dùng CHUNG với
 * `riskScoreOf()` — cổng lọc theo GIÁ TRỊ SCORE (>= ngưỡng), KHÔNG ghim theo tên/path route cụ thể,
 * để route đổi tên hay route mới thêm vào vẫn được xét đúng theo định nghĩa rủi ro thay vì bị bỏ sót
 * vì không khớp một danh sách cứng.
 */
const RISK_GATE_THRESHOLD = 5;

/**
 * Từ khoá miền nhạy cảm (khớp trên `path + controller + permission`, lowercase, substring).
 * Rộng có chủ đích — mục tiêu là KHÔNG bỏ sót, chấp nhận vài false-positive trong xếp hạng.
 */
const SENSITIVE_KEYWORDS = [
  "auth",
  "permission",
  "secret",
  "audit",
  "security",
  "2fa",
  "two-factor",
  "password",
  "token",
  "api-key",
  "apikey",
  "salary",
  "payslip",
  "webhook",
  "encrypt",
  "admin",
  "role",
  "session",
  "login",
  "logout",
  "reset",
  "invite",
  "otp",
  "mail-config",
  "kms",
  "key",
  "impersonat",
];

interface FileEvidence {
  file: string;
  verbs: Set<HttpVerb>;
  pathLiterals: string[][]; // mỗi phần tử là mảng segment đã normalize (lowercase, `${..}` → "*")
}

/** Đệ quy liệt kê mọi file `.ts` dưới `root`, bỏ qua `node_modules`/`dist`. */
function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === "dist") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Spec bị `vitest.config.ts` EXCLUDE — vitest KHÔNG BAO GIỜ chạy chúng.
 *
 * ⚠️ DƯƠNG-TÍNH-GIẢ NẶNG NHẤT của phép đo này, đo được ngày 25/08/2026 (S10-QA-ROUTEHTTP-3):
 * census quét file trên ĐĨA, còn vitest chạy theo DANH SÁCH của nó. Sáu file dưới đây nằm trên đĩa
 * nhưng bị loại khỏi lượt chạy (module park / hoãn theo Phase), nên literal path trong chúng từng
 * đóng dấu "covered" cho **7 route của `WorkflowController`** bằng những lượt HTTP CHƯA TỪNG XẢY RA.
 * Đó là sai đúng chiều NGUY HIỂM: giấu khoảng trống thay vì lộ ra.
 *
 * Giữ ĐỒNG BỘ với mảng `test.exclude` của `apps/api/vitest.config.ts` — có ca ở cuối file ĐỌC file
 * config thật rồi so hai danh sách, nên lệch là ĐỎ chứ không trôi im lặng. Khi một module được
 * un-exclude ở vitest.config, xoá tên khỏi đây trong CÙNG commit.
 */
const VITEST_EXCLUDED_SPECS = [
  "test/integration/finance-cost-controller-deny.int-spec.ts",
  "test/integration/finance-cost-allocation-controller-deny.int-spec.ts",
  "test/integration/finance-revenue-controller-deny.int-spec.ts",
  "test/integration/webhooks-deny.int-spec.ts",
  "test/integration/ui-config-deny.int-spec.ts",
] as const;

/** Đường dẫn hệ thống → dạng posix, để so đuôi với danh sách exclude bất kể Windows/Linux. */
function toPosix(p: string): string {
  return p.split(SEP_BACKSLASH).join("/");
}
const SEP_BACKSLASH = String.fromCharCode(92);

/** File nằm trong danh sách EXCLUDE của vitest ⇒ nó KHÔNG chạy ⇒ không phải bằng chứng. */
function isVitestExcluded(path: string): boolean {
  const posix = toPosix(path);
  return VITEST_EXCLUDED_SPECS.some((e) => posix.endsWith(`/${e}`) || posix.endsWith(e));
}

/**
 * File test HTTP = có `.spec.ts`/`-spec.ts` trong tên VÀ import `supertest` VÀ **thật sự được vitest
 * chạy**. Vế thứ ba là bản vá dương-tính-giả nói ở `VITEST_EXCLUDED_SPECS`.
 */
function isHttpTestFile(path: string, content: string): boolean {
  const isSpec = path.endsWith(".spec.ts") || path.endsWith("-spec.ts");
  return isSpec && !isVitestExcluded(path) && content.includes('from "supertest"');
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/** Chuẩn hoá một literal path bắt gặp trong test: cắt query-string, `${expr}` → "*", lowercase. */
function normalizeLiteralPath(literal: string): string[] {
  const withoutQuery = literal.split("?")[0];
  const wildcarded = withoutQuery.replace(/\$\{[^}]*\}/g, "*");
  return segmentsOf(wildcarded).map((s) => s.toLowerCase());
}

/** Route segment pattern: `:id` → "*", còn lại literal lowercase. */
function routeSegments(path: string): string[] {
  return segmentsOf(path).map((s) => (s.startsWith(":") ? "*" : s.toLowerCase()));
}

function segmentsMatch(routeSegs: string[], litSegs: string[]): boolean {
  if (routeSegs.length !== litSegs.length) return false;
  return routeSegs.every((rs, i) => rs === "*" || litSegs[i] === "*" || rs === litSegs[i]);
}

/**
 * Literal trông giống PATH trong file test.
 *
 * ⚠️ HAI LỚP ÂM-TÍNH-GIẢ đã đo được (S10-QA-ROUTEHTTP-3, 25/08/2026) và bản vá của chúng — đọc trước
 * khi siết lại lớp ký tự này, vì cả hai đều làm route CÓ test HTTP thật bị đếm là "chưa phủ":
 *
 *   (1) BIỂU THỨC TRONG `${...}`. Bản cũ gộp `$`/`{`/`}` vào CÙNG lớp ký tự với phần path, nên literal
 *       chỉ khớp khi mọi ký tự trong `${...}` cũng thuộc lớp đó. Một dấu `!` (non-null assertion,
 *       `${pending!.id}`), `[`/`]`, `(`/`)`, dấu phẩy hay khoảng trắng là ĐỦ để cả literal KHÔNG khớp
 *       gì cả. Đo thật: `workflow-lifecycle.e2e-spec.ts` gọi
 *       `.post(`/workflow/approval-requests/${pending!.id}/request-revision`)` mà route đó vẫn bị đếm
 *       "chưa phủ". Vá: tách `\$\{[^{}]*\}` thành một nhánh RIÊNG — trong ngoặc cho phép mọi ký tự.
 *
 *   (2) QUERY-STRING. Bản cũ không có `?` trong lớp ký tự, nên MỌI literal dạng
 *       `` `/attendance/reports/team?${q}` `` đều không khớp — và hệ quả kín tiếng hơn: dòng
 *       `literal.split("?")[0]` ở `normalizeLiteralPath` là CODE CHẾT, vì regex không bao giờ giao cho
 *       nó một literal có `?`. Vá: cho `?=&%+,` vào lớp ký tự; việc cắt query vẫn do
 *       `normalizeLiteralPath` làm (giờ mới thật sự chạy).
 *
 * Cả hai bản vá đều NỚI phạm vi khớp ⇒ đẩy số đo về phía "covered" nhiều hơn, tức CÙNG CHIỀU với sai
 * số đã khai ở đầu file (số covered là CẬN TRÊN). Chúng sửa âm-tính-giả, KHÔNG làm phép đo chặt hơn.
 * Ca tự-kiểm ở cuối file ghim CẢ HAI hình dạng — sửa regex mà làm hỏng chúng thì ĐỎ ngay.
 */
const PATH_LITERAL_RE = /(["'`])(\/(?:\$\{[^{}]*\}|[\w\-./:?=&%+,])+)\1/g;
const VERB_CALL_RE = /\.(get|post|put|patch|delete)\(/g;

function extractEvidence(file: string, content: string): FileEvidence {
  const verbs = new Set<HttpVerb>();
  for (const m of content.matchAll(VERB_CALL_RE)) verbs.add(m[1] as HttpVerb);

  const pathLiterals: string[][] = [];
  for (const m of content.matchAll(PATH_LITERAL_RE)) {
    const segs = normalizeLiteralPath(m[2]);
    if (segs.length > 0) pathLiterals.push(segs);
  }
  return { file, verbs, pathLiterals };
}

/** `/api/v1/...` (đúng runtime) VÀ dạng KHÔNG tiền tố (đa số test dựng app không gọi setGlobalPrefix). */
function candidatePathsForRoute(route: RouteInfo): string[][] {
  const withPrefix = routeSegments(route.path);
  const stripped = route.path.startsWith("/api/v1") ? routeSegments(route.path.slice(7)) : null;
  return stripped ? [withPrefix, stripped] : [withPrefix];
}

function fileCoversRoute(evidence: FileEvidence, route: RouteInfo): boolean {
  if (
    route.httpMethod !== "ALL" &&
    !evidence.verbs.has(route.httpMethod.toLowerCase() as HttpVerb)
  ) {
    return false;
  }
  const candidates = candidatePathsForRoute(route);
  return evidence.pathLiterals.some((lit) => candidates.some((cand) => segmentsMatch(cand, lit)));
}

export interface RouteCoverage {
  route: RouteInfo;
  covered: boolean;
  evidenceFiles: string[];
  riskScore: number;
}

export function riskScoreOf(route: RouteInfo): number {
  let score = 0;
  const mutating = MUTATING_METHODS.has(route.httpMethod);
  if (mutating) score += 2;
  const haystack = `${route.path} ${route.controller} ${route.permission ?? ""}`.toLowerCase();
  if (SENSITIVE_KEYWORDS.some((k) => haystack.includes(k))) score += 3;
  if (route.isPublic && mutating) score += 2;
  if (!route.hasPermission && !route.isPublic) score += 1; // ungated = tự nó đã là rủi ro
  return score;
}

/** Hàm đo CHÍNH — export để tái dùng (script khác/CI có thể import thay vì copy logic). */
export function measureRouteHttpCoverage(
  routes: RouteInfo[],
  testFiles: string[],
): RouteCoverage[] {
  const evidences: FileEvidence[] = [];
  for (const file of testFiles) {
    const content = readFileSync(file, "utf8");
    if (!isHttpTestFile(file, content)) continue;
    evidences.push(extractEvidence(file, content));
  }

  return routes.map((route) => {
    const matches = evidences.filter((e) => fileCoversRoute(e, route));
    return {
      route,
      covered: matches.length > 0,
      evidenceFiles: matches.map((m) => m.file),
      riskScore: riskScoreOf(route),
    };
  });
}

/**
 * RATCHET — mốc mới đo THẬT ngày **28/08/2026** sau khi `S10-CLEAN-WORKFLOWCLUSTER-2` land:
 * **coveredCount = 468/468 (100%), uncovered = 0 ở MỌI mức risk.**
 *
 * ⚠️ **471 → 468 CŨNG LÀ NỚI SÀN, VÀ ĐÂY LÀ LÝ DO BẰNG VĂN BẢN.** Sàn tụt 3 vì 3 ROUTE bị xoá:
 * `S10-CLEAN-WORKFLOWCLUSTER-2` gỡ `ApprovalInboxController` (`GET /approval/inbox` ·
 * `POST /approval/requests/:id/approve` · `POST /approval/requests/:id/reject`) cùng cả cụm
 * workflow/approval. TỬ SỐ và MẪU SỐ tụt CÙNG 3, tỉ lệ vẫn 100%, `MAX_UNCOVERED_TOTAL = 0` KHÔNG
 * bị nới. Số 3 là số đo RUNTIME lúc RED — `src` của WO ghi 5, KHÔNG tái hiện được.
 *
 * Mốc trước đó (27/08, `S10-CLEAN-WORKFLOWPARK-1`) — cũng tụt do GỠ ROUTE, không do vá:
 *
 * ⚠️ **500 → 471 LÀ NỚI SÀN, VÀ ĐÂY LÀ LÝ DO BẰNG VĂN BẢN mà quy tắc dưới đòi.** Sàn tụt 29 KHÔNG
 * phải vì test HTTP nào bị xoá — mà vì 29 ROUTE bị xoá: `S10-CLEAN-WORKFLOWPARK-1` gỡ hai controller
 * `/workflow` (13) + `/workflow-templates` (16) của module PARK. TỬ SỐ và MẪU SỐ tụt CÙNG một lượng,
 * tỉ lệ vẫn 100% và `MAX_UNCOVERED_TOTAL = 0` — CỔNG CHÍNH — KHÔNG hề bị nới.
 *   Cách phân biệt hai chuyện đó nếu ca này lại đỏ: nếu `uncovered > 0` thì là MẤT TEST (nợ thật, cấm
 *   hạ sàn); nếu `uncovered == 0` mà tổng tụt thì là ROUTE BỊ GỠ — và khi đó vẫn phải khai WO ở đây.
 *
 * Các mốc trước (giữ để thấy đường đi): 370/499 (14/08, 12 route risk≥5 chưa phủ) → 383/499 (18/08,
 * risk≥5 về 0) → 500/500 (25/08, phần đuôi risk≤3 đóng nốt).
 *
 * ⚠️ CON SỐ 25/08 KHÔNG SO SÁNH TRỰC TIẾP ĐƯỢC với 383/499 của 18/08: phép đo đã được VÁ trong cùng
 * WO đó (ba lớp lỗi — xem docstring của `PATH_LITERAL_RE` và `VITEST_EXCLUDED_SPECS`). Đo lại master
 * `90d26aee` bằng phiên bản CŨ cho 386/500; bằng phiên bản đã vá và chỉ tính file vitest THẬT chạy cho
 * **382/500**. Đó mới là điểm xuất phát đúng của đợt này.
 *
 * `MAX_UNCOVERED_TOTAL = 0` giờ là CỔNG CHÍNH: thêm BẤT KỲ route nào — mức risk nào cũng vậy — mà
 * không có test HTTP thật ⇒ CI ĐỎ ngay tại PR đó. `MAX_UNCOVERED_HIGH_RISK` giữ lại làm thông điệp
 * lỗi RIÊNG cho nhóm nguy hiểm (đọc log biết ngay là nợ loại nào), không phải thừa.
 *
 * Ratchet CHỈ được SIẾT xuống (MAX giảm / MIN tăng). NỚI ngưỡng lên PHẢI có WO + lý do bằng văn bản
 * kèm commit sửa hằng số này — KHÔNG tự nới cho xanh khi có route mới hoặc khi test HTTP bị xoá.
 *
 * ⚠️ 100% Ở ĐÂY LÀ 100% CỦA "ĐÃ BỊ CHẠM", KHÔNG PHẢI 100% ĐỘ PHỦ HÀNH VI. Giới hạn cố ý ghi ở đầu
 * file vẫn nguyên giá trị: khớp verb×path ở CẤP FILE ⇒ số này là CẬN TRÊN. Đừng đọc nó thành "API đã
 * được kiểm đủ".
 */
const MAX_UNCOVERED_HIGH_RISK = 0;
const MAX_UNCOVERED_TOTAL = 0;
// S13-PAYROLL-BE-1 (01/09/2026): 468 → 486 (+18 route PAYROLL `001..006` · `019..028` · `034..035`).
// S13-PAYROLL-BE-2 (01/09/2026): 486 → 503 (+17 route PAYROLL `007..018` · `029..033`).
// S14-RECRUIT-FILEGRANT-1 (04/09/2026): 503 → 508 (+5 route tệp CV `RECRUIT-API-033..037`).
// Nâng CÙNG COMMIT với WO — `MAX_UNCOVERED_TOTAL = 0` là cổng chính, nên mỗi route mới phải có file
// test chạm ĐÚNG literal path (int-spec `payroll-be1-*` · `payroll-be2-*` · `s14-recruit-filegrant1-cv`).
const MIN_COVERED_COUNT = 508;

describe("Route HTTP coverage census (S10-QA-ROUTEHTTP-1) — phép đo lặp lại được", () => {
  let app: INestApplication;
  let routes: RouteInfo[];
  let coverage: RouteCoverage[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    routes = collectRoutes(app);

    const files = [...listTsFiles(TEST_ROOT), ...listTsFiles(SRC_ROOT)];
    coverage = measureRouteHttpCoverage(routes, files);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("non-vacuous: census thấy > 400 route (khớp cỡ 499 đo 13/08/2026)", () => {
    expect(routes.length).toBeGreaterThan(400);
  });

  it("positive-control: POST /auth/login (route ĐÃ BIẾT có hàng chục test HTTP) được tính là covered", () => {
    const loginRoute = coverage.find(
      (c) => c.route.httpMethod === "POST" && c.route.path === "/api/v1/auth/login",
    );
    expect(loginRoute, "route POST /auth/login phải tồn tại trong census").toBeDefined();
    expect(loginRoute?.covered, "cơ chế đo phải nhận ra route được test rất nhiều lần").toBe(true);
    expect(loginRoute?.evidenceFiles.length ?? 0).toBeGreaterThan(0);
  });

  it("IN BẢNG: tổng phủ + top rủi ro cao chưa có bằng chứng test HTTP (xem console output của test này)", () => {
    const total = coverage.length;
    const coveredCount = coverage.filter((c) => c.covered).length;
    const uncovered = coverage
      .filter((c) => !c.covered)
      .sort(
        (a, b) => b.riskScore - a.riskScore || routeKey(a.route).localeCompare(routeKey(b.route)),
      );

    console.log(
      `\n[S10-QA-ROUTEHTTP-1] Route HTTP coverage: ${coveredCount}/${total} (${((coveredCount / total) * 100).toFixed(1)}%) — CHƯA phủ: ${uncovered.length}`,
    );
    console.log(`[S10-QA-ROUTEHTTP-1] Top 30 route CHƯA phủ, xếp theo risk score (giảm dần):`);
    for (const c of uncovered.slice(0, 30)) {
      console.log(
        `  risk=${c.riskScore}  ${c.route.httpMethod.padEnd(6)} ${c.route.path}  [${c.route.controller}#${c.route.method}]  perm=${c.route.permission ?? "-"}`,
      );
    }

    // Sanity: phép đo phải khác rỗng theo cả hai chiều (nếu 0 covered hoặc 0 uncovered thì cơ chế hỏng).
    expect(coveredCount).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
  });

  it("RATCHET (CỔNG, không chỉ báo cáo): route rủi ro cao chưa phủ không được TĂNG, tổng đã phủ không được GIẢM", () => {
    const uncoveredHighRisk = coverage.filter(
      (c) => !c.covered && c.riskScore >= RISK_GATE_THRESHOLD,
    );
    const coveredCount = coverage.filter((c) => c.covered).length;

    expect(
      uncoveredHighRisk.length,
      `route rủi ro cao (risk>=${RISK_GATE_THRESHOLD}) chưa phủ = ${uncoveredHighRisk.length}, vượt ngưỡng ratchet ${MAX_UNCOVERED_HIGH_RISK}. Xem bảng xếp hạng ở test "IN BẢNG" phía trên. Nếu route mới vừa thêm vào thì đây là nợ THẬT — viết test HTTP thật rồi SIẾT hằng số MAX_UNCOVERED_HIGH_RISK xuống; TUYỆT ĐỐI không nới hằng số lên mà không có WO + lý do.`,
    ).toBeLessThanOrEqual(MAX_UNCOVERED_HIGH_RISK);

    expect(
      coveredCount,
      `tổng route đã phủ = ${coveredCount}, tụt xuống dưới sàn ratchet ${MIN_COVERED_COUNT} — có test HTTP đã bị xoá/đổi tên khiến scan không còn khớp verb/path?`,
    ).toBeGreaterThanOrEqual(MIN_COVERED_COUNT);

    // CỔNG CHÍNH từ 25/08/2026: nợ về 0 ở MỌI mức risk ⇒ mọi route MỚI phải mang theo test HTTP thật.
    const uncoveredAll = coverage.filter((c) => !c.covered);
    expect(
      uncoveredAll.length,
      `route CHƯA có bằng chứng test HTTP = ${uncoveredAll.length}, vượt ngưỡng ratchet ${MAX_UNCOVERED_TOTAL}.\n` +
        uncoveredAll
          .slice(0, 20)
          .map(
            (c) =>
              `  risk=${c.riskScore} ${c.route.httpMethod} ${c.route.path} [${c.route.controller}#${c.route.method}]`,
          )
          .join("\n") +
        `\nViết test HTTP THẬT cho chúng (khuôn: test/integration/routehttp3-*.int-spec.ts). TUYỆT ĐỐI không nới hằng số này để lấy màu xanh.`,
    ).toBeLessThanOrEqual(MAX_UNCOVERED_TOTAL);
  });

  it("non-vacuous: ratchet trên không được tự xanh khi phép đo hỏng và trả mảng rỗng", () => {
    // Nếu measureRouteHttpCoverage() hỏng (vd routes=[] hoặc coverage=[]), uncoveredHighRisk sẽ là
    // mảng rỗng và assert "<=" ở test RATCHET phía trên xanh giả (0 <= MAX luôn đúng).
    //
    // ⚠️ MỐC 18/08/2026 (S10-QA-ROUTEHTTP-2): chốt chặn CŨ là "phải còn ÍT NHẤT một route rủi ro cao
    // CHƯA phủ". Nó đúng khi còn nợ, nhưng nợ đã trả hết (uncovered risk>=5 = 0) nên chốt đó tự đỏ và
    // sẽ ép người sau NỚI ratchet để làm nó xanh — hỏng đúng thứ nó định bảo vệ. Neo lại vào thứ KHÔNG
    // phụ thuộc độ phủ: DÂN SỐ route rủi ro cao phải khác rỗng, và ít nhất một trong số đó phải được
    // NHẬN là covered. Census hỏng (rỗng/không khớp bằng chứng nào) ⇒ cả hai vế sập ⇒ ĐỎ.
    expect(coverage.length).toBeGreaterThan(0);
    const highRisk = coverage.filter((c) => c.riskScore >= RISK_GATE_THRESHOLD);
    expect(
      highRisk.length,
      "census không thấy route rủi ro cao nào — phép đo hỏng",
    ).toBeGreaterThan(0);
    expect(
      highRisk.some((c) => c.covered),
      "không route rủi ro cao nào được nhận là covered — cơ chế khớp bằng chứng hỏng",
    ).toBe(true);
  });

  /**
   * TỰ-KIỂM BỘ RÚT LITERAL — ghim BA lớp lỗi đã đo được ngày 25/08/2026 (S10-QA-ROUTEHTTP-3).
   *
   * Không ca nào ở trên phát hiện được chúng: cả ba đều làm `pathLiterals` THIẾU phần tử, mà thiếu thì
   * route chỉ bị đếm "chưa phủ" — im lặng, không có assert nào sập. Ba ca dưới đây gọi thẳng
   * `extractEvidence` trên chuỗi dựng sẵn nên chúng ĐỎ ngay khi ai đó siết lại regex.
   */
  it("tự-kiểm regex: literal có `${expr}` chứa ký tự lạ (`!`, `[`, gọi hàm) VẪN được rút", () => {
    const sample = [
      "await request(app).post(`/workflow/approval-requests/${pending!.id}/request-revision`);",
      "await request(app).get(`/hr/employees/${rows[0].id}/contracts`);",
      "await request(app).delete(`/labels/${makeId()}`);",
    ].join("\n");
    const ev = extractEvidence("sample-spec.ts", sample);
    const asPaths = ev.pathLiterals.map((segs) => segs.join("/"));
    expect(asPaths, "`${pending!.id}` không được làm hỏng cả literal").toContain(
      "workflow/approval-requests/*/request-revision",
    );
    expect(asPaths, "`${rows[0].id}` — chỉ số mảng trong biểu thức").toContain(
      "hr/employees/*/contracts",
    );
    expect(asPaths, "`${makeId()}` — lời gọi hàm trong biểu thức").toContain("labels/*");
  });

  it("tự-kiểm regex: literal có QUERY-STRING được rút, và query bị cắt đúng", () => {
    const sample = [
      "await request(app).get(`/attendance/reports/team?fromDate=${a}&toDate=${b}`);",
      'await request(app).get("/leave/reports?page=1&pageSize=50");',
    ].join("\n");
    const ev = extractEvidence("sample-spec.ts", sample);
    const asPaths = ev.pathLiterals.map((segs) => segs.join("/"));
    expect(asPaths, "query-string không được làm literal biến mất").toContain(
      "attendance/reports/team",
    );
    expect(asPaths).toContain("leave/reports");
    expect(
      asPaths.some((p) => p.includes("?")),
      "phần query PHẢI bị cắt trước khi tách segment",
    ).toBe(false);
  });

  it("tự-kiểm exclude: danh sách VITEST_EXCLUDED_SPECS phải KHỚP `test.exclude` của vitest.config.ts", () => {
    // Ghim ĐỊNH NGHĨA chứ không ghim tên: đọc file config THẬT rồi so hai tập. Un-exclude một module ở
    // vitest.config mà quên xoá ở đây ⇒ census tiếp tục bỏ qua bằng chứng THẬT (âm-tính-giả); thêm
    // exclude mới mà quên khai ở đây ⇒ census tính bằng chứng của file KHÔNG CHẠY (dương-tính-giả).
    const configPath = join(__dirname, "..", "..", "vitest.config.ts");
    const config = readFileSync(configPath, "utf8");
    const excludeBlock = config.slice(config.indexOf("exclude: ["));
    const inConfig = [...excludeBlock.slice(0, excludeBlock.indexOf("]")).matchAll(/"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((p) => p.startsWith("test/"));

    expect(inConfig.length, "không đọc được mảng exclude của vitest.config.ts").toBeGreaterThan(0);
    expect([...inConfig].sort()).toEqual([...VITEST_EXCLUDED_SPECS].sort());
  });

  it("tự-kiểm exclude: file bị vitest EXCLUDE KHÔNG được tính là bằng chứng", () => {
    // ⚠️ Ví dụ CŨ trỏ `test/workflow-lifecycle.e2e-spec.ts`; file đó ĐÃ XOÁ ở
    // S10-CLEAN-WORKFLOWCLUSTER-2 nên nó cũng rời `VITEST_EXCLUDED_SPECS`. Ví dụ PHẢI trỏ một mục
    // CÒN trong danh sách — giữ tên cũ thì ca này xanh vì lý do SAI (`isVitestExcluded` trả false
    // do tên không còn trong danh sách, chứ không phải vì hàm chạy đúng).
    const content = 'import request from "supertest";\nrequest(app).post("/webhooks/x");';
    expect(
      isHttpTestFile("C:/repo/apps/api/test/integration/webhooks-deny.int-spec.ts", content),
      "spec nằm trong vitest exclude ⇒ vitest KHÔNG chạy ⇒ không phải bằng chứng",
    ).toBe(false);
    expect(
      isHttpTestFile(
        "C:/repo/apps/api/test/integration/routehttp3-workflow-instance.int-spec.ts",
        content,
      ),
      "spec CHẠY THẬT phải vẫn được tính (chống ca trên xanh vì `isHttpTestFile` hỏng hẳn)",
    ).toBe(true);
  });
});
