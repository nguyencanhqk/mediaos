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

/** File test HTTP = có `.spec.ts`/`-spec.ts` trong tên VÀ import `supertest`. */
function isHttpTestFile(path: string, content: string): boolean {
  const isSpec = path.endsWith(".spec.ts") || path.endsWith("-spec.ts");
  return isSpec && content.includes('from "supertest"');
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

const PATH_LITERAL_RE = /(["'`])(\/[\w\-./:${}]+)\1/g;
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
 * RATCHET — đo THẬT ngày 18/08/2026, sau khi **S10-QA-ROUTEHTTP-2** land (12 route risk=5 còn nợ đều
 * có test HTTP thật): coveredCount=383/499 (76.8%), uncovered route risk>=RISK_GATE_THRESHOLD = **0**.
 * Mốc trước: 370/499 (74.1%) với 12 route risk cao chưa phủ (S10-QA-ROUTEHTTP-1, 14/08/2026).
 * Nguồn: `npx vitest run test/foundation/route-http-coverage.e2e-spec.ts` (console log của test
 * "IN BẢNG" bên dưới) — KHÔNG ước lượng.
 *
 * MAX = 0 nghĩa là: thêm BẤT KỲ route risk>=5 nào mà không có test HTTP thật ⇒ CI ĐỎ ngay ở PR đó.
 * Ratchet CHỈ được SIẾT xuống (MAX giảm / MIN tăng) khi lane sau land thêm test HTTP thật làm độ
 * phủ tăng thật. NỚI ngưỡng lên (MAX tăng / MIN giảm) PHẢI có WO + lý do bằng văn bản kèm theo commit
 * sửa hằng số này — KHÔNG tự nới cho xanh khi có route mới xuất hiện hoặc test HTTP bị xoá.
 */
const MAX_UNCOVERED_HIGH_RISK = 0;
const MIN_COVERED_COUNT = 383;

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
});
