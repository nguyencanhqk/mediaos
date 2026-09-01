/**
 * S13-PAYROLL-FE-1 — neo phần WIRING của module PAYROLL (pair · registry · sidebar · gate), khuôn
 * `recruit-wiring.spec.ts`. Bốn nhóm ca:
 *
 *  1. **Pair-drift** — `PAYROLL_ENGINE_PAIRS` (constants.ts) phải khớp TỪNG TRƯỜNG với
 *     `apps/api/src/payroll/payroll-route-pairs.const.ts` (đọc bằng `fs`, KHÔNG import chéo package).
 *  2. **Gate màn = gate đường tải** — mọi lối vào PAYROLL đòi ĐỦ `access:payroll` + cặp của route đó
 *     (`read-path-gate-pair-must-match-download-pair`).
 *  3. **«Phiếu lương của tôi» KHÔNG sau cổng payroll** — route/sidebar ME, gate `access:me`.
 *  4. **13 cặp sensitive** — không cặp nào lọt lưới, và cặp gác MÀN phải nằm trong allowlist BE.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROUTE_REGISTRY, APP_REGISTRY } from "@mediaos/web-core";
import { PAYROLL_SIDEBAR, SIDEBAR_REGISTRY } from "@/layouts/workspace/sidebar-registry";
import { PAYROLL_ACCESS_PAIR, PAYROLL_ENGINE_PAIRS } from "./constants";

const repoRoot = path.resolve(__dirname, "../../../../..");

describe("PAYROLL wiring — pair-drift (PAYROLL_ENGINE_PAIRS vs payroll-route-pairs.const.ts)", () => {
  const beSrc = fs.readFileSync(
    path.join(repoRoot, "apps/api/src/payroll/payroll-route-pairs.const.ts"),
    "utf8",
  );

  /** `key: pair("action", "resourceType"[, isSensitive[, companyFloor[, objectGrantRequired]]]),`. */
  const ENTRY_RE = /(\w+):\s*pair\(\s*"([^"]+)",\s*"([^"]+)"(?:,\s*(true|false))?/g;
  const beEntries = new Map<
    string,
    { action: string; resourceType: string; isSensitive: boolean }
  >();
  for (const m of beSrc.matchAll(ENTRY_RE)) {
    const [, key, action, resourceType, isSensitive] = m;
    beEntries.set(key, { action, resourceType, isSensitive: isSensitive === "true" });
  }

  it("đọc được đủ 35 route pair từ file BE (regex census không mù)", () => {
    expect(beEntries.size).toBe(35);
  });

  it("mỗi khoá PAYROLL_ENGINE_PAIRS khớp ĐÚNG action/resourceType/isSensitive của BE", () => {
    for (const [key, feEntry] of Object.entries(PAYROLL_ENGINE_PAIRS)) {
      const beEntry = beEntries.get(key);
      expect(beEntry, `BE không có khoá ${key}`).toBeTruthy();
      expect(feEntry.action, `action lệch ở ${key}`).toBe(beEntry?.action);
      expect(feEntry.resourceType, `resourceType lệch ở ${key}`).toBe(beEntry?.resourceType);
      expect(feEntry.isSensitive, `isSensitive lệch ở ${key}`).toBe(beEntry?.isSensitive);
    }
  });

  it("không thiếu/thừa khoá nào so với BE (35 = 35)", () => {
    expect(Object.keys(PAYROLL_ENGINE_PAIRS).sort()).toEqual([...beEntries.keys()].sort());
  });

  it("ĐÚNG 13 cặp DISTINCT is_sensitive (mig 0565) — không cặp nào lọt lưới", () => {
    const sensitive = new Set(
      Object.values(PAYROLL_ENGINE_PAIRS)
        .filter((p) => p.isSensitive)
        .map((p) => `${p.action}:${p.resourceType}`),
    );
    expect([...sensitive].sort()).toEqual(
      [
        "approve:bonus-penalty",
        "approve:payroll-period",
        "calculate:payroll-period",
        "export:payroll",
        "manage:bonus-penalty",
        "manage:salary-profile",
        "publish:payroll-period",
        "reopen:payroll-period",
        "view-line:payroll-period",
        "view-own-payslip:payslip",
        "view-payslip:payslip",
        "view:bonus-penalty",
        "view:salary-profile",
      ].sort(),
    );
  });

  it("`('access','payroll')` CỐ Ý vắng khỏi bảng 35 route (cổng nav, không gác route nào)", () => {
    const inTable = Object.values(PAYROLL_ENGINE_PAIRS).some(
      (p) => p.action === "access" && p.resourceType === "payroll",
    );
    expect(inTable).toBe(false);
    expect(PAYROLL_ACCESS_PAIR).toEqual({
      action: "access",
      resourceType: "payroll",
      isSensitive: false,
    });
    // 17 cặp SPEC-11 §11.1 = 16 cặp có route + `access:payroll`.
    const distinct = new Set(
      Object.values(PAYROLL_ENGINE_PAIRS).map((p) => `${p.action}:${p.resourceType}`),
    );
    expect(distinct.size).toBe(16);
  });

  it("13 cặp sensitive ĐỀU có trong SENSITIVE_CAPABILITY_ALLOWLIST của BE", () => {
    // Thiếu một cặp trong allowlist ⇒ /auth/me không trả nó ⇒ màn/nút biến mất với ĐÚNG vai được cấp
    // quyền, im lặng (`capability-allowlist-hides-admin-screens`).
    const permSrc = fs.readFileSync(
      path.join(repoRoot, "apps/api/src/permission/permission.service.ts"),
      "utf8",
    );
    const sensitive = new Set(
      Object.values(PAYROLL_ENGINE_PAIRS)
        .filter((p) => p.isSensitive)
        .map((p) => `${p.action}:${p.resourceType}`),
    );
    for (const pair of sensitive) {
      expect(permSrc, `${pair} thiếu trong allowlist BE`).toContain(`"${pair}"`);
    }
  });
});

describe("PAYROLL wiring — ROUTE_REGISTRY & gate màn khớp gate đường tải", () => {
  const byKey = (k: string) => ROUTE_REGISTRY.find((r) => r.routeKey === k);

  it("3 route sidebar PAYROLL tồn tại, moduleCode PAYROLL, đúng screenCode", () => {
    const rows = [
      ["payroll.periods", "/payroll/periods", "PAY-SCREEN-001"],
      ["payroll.salaryProfiles", "/payroll/salary-profiles", "PAY-SCREEN-004"],
      ["payroll.bonusPenalties", "/payroll/bonus-penalties", "PAY-SCREEN-005"],
    ] as const;
    for (const [key, p, screen] of rows) {
      const meta = byKey(key);
      expect(meta, `thiếu route ${key}`).toBeTruthy();
      expect(meta?.path).toBe(p);
      expect(meta?.moduleCode).toBe("PAYROLL");
      expect(meta?.screenCode).toBe(screen);
      expect(meta?.showInSidebar).toBe(true);
    }
  });

  it("gate mỗi route = access:payroll + cặp ĐƯỜNG TẢI của chính màn đó", () => {
    expect(byKey("payroll.periods")?.requiredPermissions).toEqual([
      "access:payroll",
      "view:payroll-period",
    ]);
    expect(byKey("payroll.salaryProfiles")?.requiredPermissions).toEqual([
      "access:payroll",
      "view:salary-profile",
    ]);
    expect(byKey("payroll.bonusPenalties")?.requiredPermissions).toEqual([
      "access:payroll",
      "view:bonus-penalty",
    ]);
  });

  it("route danh sách kỳ KHÔNG gate bằng cặp chở-tiền (`view-line`) — nếu không người `approve` mất lối vào", () => {
    const perms = byKey("payroll.periods")?.requiredPermissions ?? [];
    expect(perms).not.toContain("view-line:payroll-period");
  });

  it("thẻ app PAYROLL gate bằng cặp KHÔNG nhạy cảm và trỏ tới màn nó gate", () => {
    const app = APP_REGISTRY.find((a) => a.appKey === "payroll");
    expect(app, "thiếu thẻ app payroll").toBeTruthy();
    expect(app?.moduleCode).toBe("PAYROLL");
    expect(app?.requiredPermissions).toEqual(["access:payroll", "view:payroll-period"]);
    expect(app?.defaultRoute).toBe(byKey("payroll.periods")?.path);
  });
});

describe("PAYROLL wiring — «Phiếu lương của tôi» KHÔNG nằm sau cổng quyền payroll", () => {
  const meta = ROUTE_REGISTRY.find((r) => r.routeKey === "me.payslips");

  it("route tồn tại, thuộc module ME, screenCode PAY-SCREEN-006", () => {
    expect(meta, "thiếu route me.payslips").toBeTruthy();
    expect(meta?.path).toBe("/me/payslips");
    expect(meta?.moduleCode).toBe("ME");
    expect(meta?.screenCode).toBe("PAY-SCREEN-006");
  });

  it("gate là `access:me` — KHÔNG có cặp PAYROLL nào trong gate route", () => {
    expect(meta?.requiredAnyPermissions).toEqual(["access:me"]);
    const all = [...(meta?.requiredPermissions ?? []), ...(meta?.requiredAnyPermissions ?? [])];
    expect(all.some((p) => p.includes("payroll") || p.includes("payslip"))).toBe(false);
  });

  it("mục sidebar me.payslips cũng gate `access:me`, nằm trong ME_SIDEBAR chứ không phải PAYROLL_SIDEBAR", () => {
    const meItems = SIDEBAR_REGISTRY.ME ?? [];
    const item = meItems.find((i) => i.sidebarKey === "me.payslips");
    expect(item, "thiếu mục sidebar me.payslips").toBeTruthy();
    expect(item?.path).toBe("/me/payslips");
    expect(item?.requiredPermissions).toEqual(["access:me"]);
    expect(PAYROLL_SIDEBAR.some((i) => i.path === "/me/payslips")).toBe(false);
  });
});

describe("PAYROLL wiring — sidebar", () => {
  it("SIDEBAR_REGISTRY.PAYROLL === PAYROLL_SIDEBAR và có đúng 3 mục", () => {
    expect(SIDEBAR_REGISTRY.PAYROLL).toBe(PAYROLL_SIDEBAR);
    expect(PAYROLL_SIDEBAR).toHaveLength(3);
  });

  it("mỗi mục sidebar trỏ tới một route CÓ THẬT trong ROUTE_REGISTRY, cùng gate", () => {
    for (const item of PAYROLL_SIDEBAR) {
      const meta = ROUTE_REGISTRY.find((r) => r.path === item.path);
      expect(meta, `sidebar trỏ tới path không có route: ${item.path}`).toBeTruthy();
      expect(item.requiredPermissions, `gate lệch ở ${item.path}`).toEqual(
        meta?.requiredPermissions,
      );
    }
  });

  it("chi tiết kỳ + phiếu lương KHÔNG lên sidebar (màn con)", () => {
    const paths = PAYROLL_SIDEBAR.map((i) => i.path);
    expect(paths).not.toContain("/payroll/periods/$periodId");
    expect(paths).not.toContain("/payroll/payslips/$payslipId");
  });
});
