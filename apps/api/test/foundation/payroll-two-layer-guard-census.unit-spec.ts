import fs from "node:fs";
import path from "node:path";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import {
  PAYROLL_PENDING_BE2,
  PAYROLL_ROUTE_PAIRS,
  type PayrollRouteKey,
} from "../../src/payroll/payroll-route-pairs.const";
import { collectRoutes, type RouteInfo } from "./route-census";

/**
 * S13-PAYROLL-BE-1 — CENSUS 2 TẦNG theo TỪNG ROUTE × MÃ CẶP (khuôn `recruit-two-layer-guard-census`).
 *
 * CẢ HAI tầng so với CÙNG MỘT nguồn sự thật `PAYROLL_ROUTE_PAIRS` — KHÔNG so tầng-với-tầng (hai tầng
 * cùng sai vẫn "khớp nhau"):
 *   • Tầng 1 (decorator): metadata `@RequirePermission` từ APP ĐÃ BOOT qua `collectRoutes` (runtime
 *     Reflector — không regex mã nguồn).
 *   • Tầng 2 (service): quét TS AST `payroll/**` tìm `resolveActor(<expr>, "<key>")`, pin
 *     `Class#method ↔ key` (không chỉ "key xuất hiện ≥ 1 lần" — route assert nhầm key của route KHÁC
 *     cùng cặp vẫn xanh nếu chỉ đếm).
 *
 * `PAYROLL_PENDING_BE2` là **CỔNG, không phải lời hứa**: ca (5) assert hợp = toàn bộ **và** giao = ∅
 * ⇒ BE-2 nối dây một key mà quên gỡ khỏi danh sách là ĐỎ (chống census xanh-rỗng).
 *
 * KHÔNG cần Postgres — boot + metadata + đọc file.
 */

const SRC_PAYROLL = path.join(__dirname, "..", "..", "src", "payroll");

/** 18 route của BE-1 (`001..006` · `019..028` · `034..035`). */
const ROUTE_TO_KEY: ReadonlyArray<{ method: string; path: string; key: PayrollRouteKey }> = [
  { method: "GET", path: "/api/v1/payroll-periods", key: "periodList" },
  { method: "POST", path: "/api/v1/payroll-periods", key: "periodCreate" },
  { method: "POST", path: "/api/v1/payroll-periods/:id/collect", key: "periodCollect" },
  { method: "GET", path: "/api/v1/payroll-periods/:id/readiness", key: "periodReadiness" },
  { method: "GET", path: "/api/v1/payroll-periods/:id", key: "periodDetail" },
  { method: "PATCH", path: "/api/v1/payroll-periods/:id", key: "periodUpdate" },
  { method: "GET", path: "/api/v1/salary-profiles", key: "salaryProfileList" },
  { method: "POST", path: "/api/v1/salary-profiles", key: "salaryProfileCreate" },
  { method: "GET", path: "/api/v1/salary-profiles/:id", key: "salaryProfileDetail" },
  { method: "PATCH", path: "/api/v1/salary-profiles/:id", key: "salaryProfileUpdate" },
  { method: "GET", path: "/api/v1/bonus-penalties", key: "bonusPenaltyList" },
  { method: "POST", path: "/api/v1/bonus-penalties", key: "bonusPenaltyCreate" },
  { method: "POST", path: "/api/v1/bonus-penalties/:id/approve", key: "bonusPenaltyApprove" },
  { method: "POST", path: "/api/v1/bonus-penalties/:id/reject", key: "bonusPenaltyReject" },
  { method: "GET", path: "/api/v1/bonus-penalties/:id", key: "bonusPenaltyDetail" },
  { method: "PATCH", path: "/api/v1/bonus-penalties/:id", key: "bonusPenaltyUpdate" },
  { method: "GET", path: "/api/v1/payroll/pickers/people", key: "pickerPeople" },
  {
    method: "GET",
    path: "/api/v1/payroll/pickers/attendance-periods",
    key: "pickerAttendancePeriods",
  },
];

const PAYROLL_CONTROLLERS = new Set([
  "PayrollPeriodsController",
  "SalaryProfilesController",
  "BonusPenaltiesController",
  "PayrollPickersController",
]);

/** Sổ pin method↔key — đổi handler/key là ĐỎ, phải sửa CÓ CHỦ ĐÍCH qua FULL gate. */
const SERVICE_SITE_TO_KEYS: Readonly<Record<string, readonly string[]>> = {
  "PayrollPeriodsService#list": ["periodList"],
  "PayrollPeriodsService#create": ["periodCreate"],
  "PayrollPeriodsService#get": ["periodDetail"],
  "PayrollPeriodsService#update": ["periodUpdate"],
  "PayrollPeriodsService#collect": ["periodCollect"],
  "PayrollPeriodsService#readiness": ["periodReadiness"],
  "PayrollPeriodsService#pickAttendancePeriods": ["pickerAttendancePeriods"],
  "SalaryProfilesService#list": ["salaryProfileList"],
  "SalaryProfilesService#create": ["salaryProfileCreate"],
  "SalaryProfilesService#get": ["salaryProfileDetail"],
  "SalaryProfilesService#update": ["salaryProfileUpdate"],
  "SalaryProfilesService#pickPeople": ["pickerPeople"],
  "BonusPenaltiesService#list": ["bonusPenaltyList"],
  "BonusPenaltiesService#create": ["bonusPenaltyCreate"],
  "BonusPenaltiesService#get": ["bonusPenaltyDetail"],
  "BonusPenaltiesService#update": ["bonusPenaltyUpdate"],
  // `approve`/`reject` (027/028) đi chung `decide` — key chọn theo tham số `status`, nên site này
  // mang HAI key. Đó là hình dạng ĐÚNG, không phải thiếu pin: hai route dùng CÙNG resource
  // `bonus-penalty` + CÙNG action `approve`, chỉ khác đích FSM.
  "BonusPenaltiesService#decide": ["bonusPenaltyApprove", "bonusPenaltyReject"],
};

function serviceResolveActorCalls(): Array<{ site: string; key: string }> {
  const calls: Array<{ site: string; key: string }> = [];
  for (const file of fs.readdirSync(SRC_PAYROLL)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_PAYROLL, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, cls: string, method: string): void => {
      let nextCls = cls;
      let nextMethod = method;
      if (ts.isClassDeclaration(node) && node.name) nextCls = node.name.text;
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) nextMethod = node.name.text;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "resolveActor" &&
        node.arguments.length === 2 &&
        ts.isStringLiteral(node.arguments[1])
      ) {
        calls.push({ site: `${nextCls}#${nextMethod}`, key: node.arguments[1].text });
      }
      // `decide` chọn key qua toán tử điều kiện — hai literal, không phải lời gọi. Bắt riêng để sổ
      // pin không bị rỗng ở site đó.
      if (
        ts.isConditionalExpression(node) &&
        ts.isStringLiteral(node.whenTrue) &&
        ts.isStringLiteral(node.whenFalse) &&
        node.whenTrue.text in PAYROLL_ROUTE_PAIRS &&
        node.whenFalse.text in PAYROLL_ROUTE_PAIRS
      ) {
        calls.push({ site: `${nextCls}#${nextMethod}`, key: node.whenTrue.text });
        calls.push({ site: `${nextCls}#${nextMethod}`, key: node.whenFalse.text });
      }
      ts.forEachChild(node, (c) => visit(c, nextCls, nextMethod));
    };
    visit(sf, "?", "?");
  }
  // Site `decide` xuất hiện 2 lần từ nhánh conditional + 1 lần từ `resolveActor(user, routeKey)`
  // (biến, không phải literal ⇒ không bắt). De-dup theo (site,key).
  const seen = new Set<string>();
  return calls.filter((c) => {
    const k = `${c.site}→${c.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

describe("PAYROLL census 2 tầng — decorator + service so với PAYROLL_ROUTE_PAIRS", () => {
  let app: INestApplication;
  let payrollRoutes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    payrollRoutes = collectRoutes(app).filter((r) => PAYROLL_CONTROLLERS.has(r.controller));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("(1) bảng fixture phủ ĐÚNG tập route PAYROLL đã boot — không thiếu, không thừa", () => {
    // Chốt chặn xanh-RỖNG: scanner/boot hỏng ⇒ 0 route ⇒ mọi assert dưới vô nghĩa.
    expect(payrollRoutes.length, "app boot phải thấy 18 route PAYROLL của BE-1").toBe(18);
    const seen = new Set(payrollRoutes.map((r) => `${r.httpMethod} ${r.path}`));
    const expected = new Set(ROUTE_TO_KEY.map((r) => `${r.method} ${r.path}`));
    expect(
      [...seen].filter((k) => !expected.has(k)),
      "route PAYROLL mọc ngoài bảng census",
    ).toEqual([]);
    expect(
      [...expected].filter((k) => !seen.has(k)),
      "bảng census giữ route không tồn tại",
    ).toEqual([]);
  });

  it("(2) TẦNG 1 — decorator khai ĐÚNG cặp VÀ đúng cờ isSensitive", () => {
    const bad: string[] = [];
    for (const row of ROUTE_TO_KEY) {
      const route = payrollRoutes.find((r) => r.httpMethod === row.method && r.path === row.path);
      if (!route) continue;
      const pair = PAYROLL_ROUTE_PAIRS[row.key];
      const want = `${pair.action}:${pair.resourceType}`;
      if (!route.hasPermission || route.permission !== want) {
        bad.push(`${row.method} ${row.path} — decorator '${route.permission}' ≠ bảng '${want}'`);
      }
    }
    expect(bad, "decorator lệch bảng hằng (sửa route hoặc sửa bảng QUA FULL gate)").toEqual([]);
  });

  it("(3) TẦNG 2 — service: ĐÚNG method dùng ĐÚNG key (map pin, không chỉ đếm)", () => {
    const calls = serviceResolveActorCalls();
    expect(calls.length, "scanner resolveActor trả quá ít — nó hỏng").toBeGreaterThanOrEqual(18);
    const validKeys = new Set(Object.keys(PAYROLL_ROUTE_PAIRS));
    expect(
      calls.filter((c) => !validKeys.has(c.key)).map((c) => `${c.site}→${c.key}`),
      "literal routeKey KHÔNG có trong PAYROLL_ROUTE_PAIRS",
    ).toEqual([]);
    const bySite = new Map<string, string[]>();
    for (const c of calls) {
      const cur = bySite.get(c.site);
      if (cur) cur.push(c.key);
      else bySite.set(c.site, [c.key]);
    }
    const actual = Object.fromEntries(
      [...bySite.entries()].map(([site, keys]) => [site, [...keys].sort()]),
    );
    const expected = Object.fromEntries(
      Object.entries(SERVICE_SITE_TO_KEYS).map(([site, keys]) => [site, [...keys].sort()]),
    );
    expect(actual, "map Class#method → routeKey lệch sổ pin SERVICE_SITE_TO_KEYS").toEqual(
      expected,
    );
  });

  it("(4) mọi route CÓ decorator đều được assert lại ở tầng service (đủ tầng 2)", () => {
    const used = new Set(serviceResolveActorCalls().map((c) => c.key));
    const routed = new Set(ROUTE_TO_KEY.map((r) => r.key));
    expect(
      [...routed].filter((k) => !used.has(k)),
      "route có decorator nhưng KHÔNG được assert lại ở tầng service (thiếu tầng 2)",
    ).toEqual([]);
  });

  it("(5) PENDING_BE2 là CỔNG: hợp = toàn bộ 35 key, giao với key đã dùng = ∅", () => {
    const all = new Set(Object.keys(PAYROLL_ROUTE_PAIRS));
    const used = new Set(ROUTE_TO_KEY.map((r) => r.key as string));
    const pending = new Set<string>(PAYROLL_PENDING_BE2);
    expect(all.size, "bảng hằng phải khai đủ 35 route API-18").toBe(35);
    expect(
      [...pending].filter((k) => used.has(k)),
      "key ĐÃ có route mà vẫn nằm trong PENDING_BE2",
    ).toEqual([]);
    expect(
      [...all].filter((k) => !used.has(k) && !pending.has(k)),
      "key không có route và cũng không khai PENDING_BE2 — vùng mù im lặng",
    ).toEqual([]);
    expect(pending.size, "BE-2 còn 17 route").toBe(17);
  });

  it("(6) SÀN SCOPE Company — đúng 3 route /me/payslips* được miễn", () => {
    const noFloor = Object.entries(PAYROLL_ROUTE_PAIRS)
      .filter(([, p]) => !p.companyFloor)
      .map(([k]) => k)
      .sort();
    expect(noFloor).toEqual(["mePayslipAck", "mePayslipDetail", "mePayslipList"]);
  });

  it("(7) objectGrantRequired chỉ được khai `false`, và đúng cho 3 route Own", () => {
    const declared = Object.entries(PAYROLL_ROUTE_PAIRS).filter(
      ([, p]) => p.objectGrantRequired !== undefined,
    );
    // ⚠️ Khai `true` = deny-object-required fail-closed ⇒ 403 CẢ ROUTE (permission.decide.ts:93-97).
    expect(
      declared.filter(([, p]) => p.objectGrantRequired !== false).map(([k]) => k),
      "objectGrantRequired=true là 403 cả route — KHÔNG BAO GIỜ khai",
    ).toEqual([]);
    expect(declared.map(([k]) => k).sort()).toEqual([
      "mePayslipAck",
      "mePayslipDetail",
      "mePayslipList",
    ]);
  });

  it("(8) cờ sensitive khớp seed mig 0565 — đúng 13 cặp is_sensitive trên 16 cặp có route", () => {
    const pairs = Object.values(PAYROLL_ROUTE_PAIRS);
    const sensitive = new Set(
      pairs.filter((p) => p.isSensitive).map((p) => `${p.action}:${p.resourceType}`),
    );
    const notSensitive = new Set(
      pairs.filter((p) => !p.isSensitive).map((p) => `${p.action}:${p.resourceType}`),
    );
    expect(sensitive.size, "13 cặp sensitive (SPEC-11 §11.1)").toBe(13);
    // 16 cặp CÓ route; cặp thứ 17 `access:payroll` là cổng nav, không gác route nào.
    expect(sensitive.size + notSensitive.size).toBe(16);
    expect([...notSensitive].sort()).toEqual([
      "acknowledge-own-payslip:payslip",
      "manage:payroll-period",
      "view:payroll-period",
    ]);
    // Một cặp KHÔNG được vừa sensitive vừa không — cờ phải nhất quán trên mọi route dùng nó.
    expect(
      [...sensitive].filter((p) => notSensitive.has(p)),
      "cờ sensitive lệch giữa hai route cùng cặp",
    ).toEqual([]);
  });
});
