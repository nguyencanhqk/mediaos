import fs from "node:fs";
import path from "node:path";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import {
  RECRUIT_ROUTE_PAIRS,
  type RecruitRouteKey,
} from "../../src/recruit/recruit-route-pairs.const";
import { collectRoutes, type RouteInfo } from "./route-census";

/**
 * S12-RECRUIT-BE-1 — CENSUS 2 TẦNG theo TỪNG ROUTE × MÃ CẶP (plan §9.3, plan-review vòng 2 #3/#4).
 *
 * CẢ HAI tầng so với CÙNG MỘT nguồn sự thật `RECRUIT_ROUTE_PAIRS` — KHÔNG so tầng-với-tầng (hai tầng
 * cùng sai vẫn "khớp nhau"; so với bảng hằng thì một tầng lệch là ĐỎ):
 *   • Tầng 1 (decorator): đọc metadata `@RequirePermission` từ APP ĐÃ BOOT qua `collectRoutes`
 *     (runtime Reflector — KHÔNG regex mã nguồn, tránh bẫy `nestjs-zod-class-level-pipe-does-nothing`).
 *   • Tầng 2 (service): quét TS AST các file `recruit/**` tìm lời gọi `resolveActor(<expr>, "<key>")`
 *     — mọi key của bảng phải được assert lại Ở TẦNG SERVICE ít nhất một lần, và mọi literal dùng
 *     phải là key hợp lệ. (Xấp xỉ có khai báo: AST không lần call-graph handler→service; vế hành vi
 *     per-route do `recruit-be1-scope.int-spec.ts` phủ bằng ma trận A/B 403 thật.)
 *
 * KHÔNG cần Postgres — boot + metadata + đọc file (khuôn route-guard-coverage).
 */

const SRC_RECRUIT = path.join(__dirname, "..", "..", "src", "recruit");

/** Bảng route HTTP → key `RECRUIT_ROUTE_PAIRS` — fixture của census, phủ ĐỦ 32 route API-17. */
const ROUTE_TO_KEY: ReadonlyArray<{ method: string; path: string; key: RecruitRouteKey }> = [
  { method: "GET", path: "/api/v1/job-openings", key: "jobOpeningList" },
  { method: "POST", path: "/api/v1/job-openings", key: "jobOpeningCreate" },
  { method: "GET", path: "/api/v1/job-openings/:id", key: "jobOpeningDetail" },
  { method: "PATCH", path: "/api/v1/job-openings/:id", key: "jobOpeningUpdate" },
  { method: "POST", path: "/api/v1/job-openings/:id/change-status", key: "jobOpeningChangeStatus" },
  { method: "GET", path: "/api/v1/candidates", key: "candidateList" },
  { method: "POST", path: "/api/v1/candidates", key: "candidateCreate" },
  { method: "GET", path: "/api/v1/candidates/check-duplicate", key: "candidateCheckDuplicate" },
  { method: "GET", path: "/api/v1/candidates/summary", key: "candidateSummary" },
  { method: "GET", path: "/api/v1/candidates/export", key: "candidateExport" },
  { method: "GET", path: "/api/v1/candidates/:id", key: "candidateDetail" },
  { method: "PATCH", path: "/api/v1/candidates/:id", key: "candidateUpdate" },
  { method: "POST", path: "/api/v1/candidates/:id/move-stage", key: "candidateMoveStage" },
  { method: "GET", path: "/api/v1/candidates/:id/stage-events", key: "candidateStageEvents" },
  { method: "GET", path: "/api/v1/candidates/:id/notes", key: "candidateNotesList" },
  { method: "POST", path: "/api/v1/candidates/:id/notes", key: "candidateNoteCreate" },
  { method: "PATCH", path: "/api/v1/candidates/:id/notes/:noteId", key: "candidateNoteUpdate" },
  { method: "POST", path: "/api/v1/candidates/:id/convert", key: "candidateConvert" },
  { method: "GET", path: "/api/v1/interviews", key: "interviewList" },
  { method: "POST", path: "/api/v1/interviews", key: "interviewCreate" },
  { method: "GET", path: "/api/v1/interviews/:id", key: "interviewDetail" },
  { method: "PATCH", path: "/api/v1/interviews/:id", key: "interviewUpdate" },
  { method: "POST", path: "/api/v1/interviews/:id/change-status", key: "interviewChangeStatus" },
  { method: "POST", path: "/api/v1/interviews/:id/feedback", key: "interviewFeedbackCreate" },
  { method: "PATCH", path: "/api/v1/interviews/:id/feedback", key: "interviewFeedbackUpdate" },
  { method: "GET", path: "/api/v1/offers", key: "offerList" },
  { method: "POST", path: "/api/v1/offers", key: "offerCreate" },
  { method: "GET", path: "/api/v1/offers/:id", key: "offerDetail" },
  { method: "PATCH", path: "/api/v1/offers/:id", key: "offerUpdate" },
  { method: "POST", path: "/api/v1/offers/:id/change-status", key: "offerChangeStatus" },
  { method: "GET", path: "/api/v1/recruit/pickers/employees", key: "pickerEmployees" },
  { method: "GET", path: "/api/v1/recruit/pickers/recruiter-users", key: "pickerRecruiterUsers" },
];

const RECRUIT_CONTROLLERS = new Set([
  "JobOpeningsController",
  "CandidatesController",
  "InterviewsController",
  "OffersController",
  "RecruitPickersController",
]);

/** Mọi literal `resolveActor(<expr>, "<key>")` trong recruit/**.ts (service + convert). */
function serviceResolveActorKeys(): string[] {
  const keys: string[] = [];
  for (const file of fs.readdirSync(SRC_RECRUIT)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_RECRUIT, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "resolveActor" &&
        node.arguments.length === 2 &&
        ts.isStringLiteral(node.arguments[1])
      ) {
        keys.push(node.arguments[1].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return keys;
}

describe("RECRUIT census 2 tầng — decorator + service so với RECRUIT_ROUTE_PAIRS", () => {
  let app: INestApplication;
  let recruitRoutes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    recruitRoutes = collectRoutes(app).filter((r) => RECRUIT_CONTROLLERS.has(r.controller));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("bảng fixture phủ ĐÚNG tập route RECRUIT đã boot — không thiếu, không thừa", () => {
    // Chốt chặn xanh-RỖNG: scanner/boot hỏng ⇒ 0 route ⇒ mọi assert dưới vô nghĩa.
    expect(recruitRoutes.length, "app boot phải thấy 32 route RECRUIT").toBe(32);
    const seen = new Set(recruitRoutes.map((r) => `${r.httpMethod} ${r.path}`));
    const expected = new Set(ROUTE_TO_KEY.map((r) => `${r.method} ${r.path}`));
    expect(
      [...seen].filter((k) => !expected.has(k)),
      "route RECRUIT mọc ngoài bảng census",
    ).toEqual([]);
    expect(
      [...expected].filter((k) => !seen.has(k)),
      "bảng census giữ route không tồn tại",
    ).toEqual([]);
  });

  it("TẦNG 1 — decorator: mỗi route khai ĐÚNG cặp của RECRUIT_ROUTE_PAIRS[key]", () => {
    const bad: string[] = [];
    for (const row of ROUTE_TO_KEY) {
      const route = recruitRoutes.find((r) => r.httpMethod === row.method && r.path === row.path);
      if (!route) continue; // ca trên đã bắt
      const pair = RECRUIT_ROUTE_PAIRS[row.key];
      const want = `${pair.action}:${pair.resourceType}`;
      if (!route.hasPermission || route.permission !== want) {
        bad.push(`${row.method} ${row.path} — decorator '${route.permission}' ≠ bảng '${want}'`);
      }
    }
    expect(bad, "decorator lệch bảng hằng (sửa route hoặc sửa bảng QUA FULL gate)").toEqual([]);
  });

  it("TẦNG 2 — service: đủ 32 key được assert lại qua resolveActor, không literal lạ", () => {
    const used = serviceResolveActorKeys();
    // Chốt chặn xanh-RỖNG cho scanner AST.
    expect(used.length, "scanner resolveActor trả quá ít — nó hỏng").toBeGreaterThanOrEqual(32);
    const validKeys = new Set(Object.keys(RECRUIT_ROUTE_PAIRS));
    expect(
      used.filter((k) => !validKeys.has(k)),
      "literal routeKey KHÔNG có trong RECRUIT_ROUTE_PAIRS",
    ).toEqual([]);
    const missing = [...validKeys].filter((k) => !used.includes(k));
    expect(
      missing,
      "route có decorator nhưng KHÔNG được assert lại ở tầng service (thiếu tầng 2)",
    ).toEqual([]);
  });

  it("cờ sensitive của bảng khớp seed: đúng 7 cặp resource candidate", () => {
    const sensitive = Object.values(RECRUIT_ROUTE_PAIRS).filter((p) => p.isSensitive);
    expect(new Set(sensitive.map((p) => `${p.action}:${p.resourceType}`)).size).toBe(7);
    expect(sensitive.every((p) => p.resourceType === "candidate")).toBe(true);
  });
});
