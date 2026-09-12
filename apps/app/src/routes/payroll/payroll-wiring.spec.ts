/**
 * S13-PAYROLL-FE-1 — neo phần WIRING của module PAYROLL (pair · registry · sidebar · gate), khuôn
 * `recruit-wiring.spec.ts`. Bốn nhóm ca:
 *
 *  1. **Pair-drift** — `PAYROLL_ENGINE_PAIRS` (constants.ts) phải khớp TỪNG TRƯỜNG với
 *     `apps/api/src/payroll/payroll-route-pairs.const.ts` (đọc bằng `fs`, KHÔNG import chéo package).
 *  2. **Gate màn = gate đường tải** — mọi lối vào PAYROLL đòi ĐỦ `access:payroll` + cặp của route đó
 *     (`read-path-gate-pair-must-match-download-pair`).
 *  3. **«Phiếu lương của tôi» KHÔNG sau cổng payroll** — route/sidebar ME, gate `access:me`.
 *  4. **15 cặp sensitive** (13 của mig `0565` + 2 cặp `payroll-employee` của mig `0571`) — không cặp
 *     nào lọt lưới, và cặp gác MÀN phải nằm trong allowlist BE.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROUTE_REGISTRY, APP_REGISTRY, type SidebarItemMeta } from "@mediaos/web-core";
import {
  PAYROLL_SIDEBAR,
  PAYROLL_SIDEBAR_V2,
  pruneUnbuiltScreens,
  SIDEBAR_REGISTRY,
} from "@/layouts/workspace/sidebar-registry";
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

  it("đọc được đủ 43 route pair từ file BE (regex census không mù)", () => {
    // S15-PAYROLL-BE-1: +8 route track A (036–043) ⇒ 35 → 43.
    expect(beEntries.size).toBe(43);
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

  it("không thiếu/thừa khoá nào so với BE (43 = 43)", () => {
    expect(Object.keys(PAYROLL_ENGINE_PAIRS).sort()).toEqual([...beEntries.keys()].sort());
  });

  it("ĐÚNG 15 cặp DISTINCT is_sensitive (mig 0565 + 0571) — không cặp nào lọt lưới", () => {
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
        "manage:payroll-employee",
        "manage:salary-profile",
        "publish:payroll-period",
        "reopen:payroll-period",
        "view-line:payroll-period",
        "view-own-payslip:payslip",
        "view-payslip:payslip",
        "view:payroll-employee",
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
    // S15-PAYROLL-BE-1: +2 cặp `payroll-employee` ⇒ 16 → 18 cặp distinct có route.
    expect(distinct.size).toBe(18);
  });

  it("15 cặp sensitive ĐỀU có trong SENSITIVE_CAPABILITY_ALLOWLIST của BE", () => {
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

/**
 * S15-UI-SHELL-1 (DEC-020) — sidebar PAYROLL lên **cấu trúc v2 có nhóm gập được**, khai đầy đủ ở
 * `PAYROLL_SIDEBAR_V2` rồi cắt mục chưa có màn (`pruneUnbuiltScreens`). Nên spec này phải đi ĐỆ QUY:
 * duyệt phẳng `PAYROLL_SIDEBAR` như bản v1 sẽ MÙ với mọi mục nằm trong nhóm.
 */
function flattenSidebar(items: readonly SidebarItemMeta[]): SidebarItemMeta[] {
  return items.flatMap((item) => [item, ...flattenSidebar(item.children ?? [])]);
}

describe("PAYROLL wiring — sidebar", () => {
  it("SIDEBAR_REGISTRY.PAYROLL === PAYROLL_SIDEBAR (bản ĐÃ cắt mục chưa có màn)", () => {
    expect(SIDEBAR_REGISTRY.PAYROLL).toBe(PAYROLL_SIDEBAR);
  });

  it("mọi mục CÓ path (kể cả trong nhóm) trỏ tới route CÓ THẬT trong ROUTE_REGISTRY, cùng gate", () => {
    const leaves = flattenSidebar(PAYROLL_SIDEBAR).filter((i) => i.path);
    // Neo số: đúng 3 màn PAYROLL đã dựng hôm nay. Thêm màn ở WO sau ⇒ sửa số này CÙNG lúc thêm route.
    expect(leaves).toHaveLength(3);

    for (const item of leaves) {
      const meta = ROUTE_REGISTRY.find((r) => r.path === item.path);
      expect(meta, `sidebar trỏ tới path không có route: ${item.path}`).toBeTruthy();
      expect(item.requiredPermissions, `gate lệch ở ${item.path}`).toEqual(
        meta?.requiredPermissions,
      );
    }
  });

  it("KHÔNG còn hàng đại diện nhóm nào RỖNG sau khi cắt (chevron mở ra chỗ trống)", () => {
    for (const item of flattenSidebar(PAYROLL_SIDEBAR)) {
      if (item.path) continue;
      expect(
        item.children?.length,
        `nhóm rỗng vẫn được đăng ký: ${item.sidebarKey}`,
      ).toBeGreaterThan(0);
    }
  });

  it("cấu trúc v2 khai ĐỦ 11 mục có màn của SPEC-11 §9.1 + 3 màn v1 (kể cả màn chưa dựng)", () => {
    const declared = flattenSidebar(PAYROLL_SIDEBAR_V2)
      .filter((i) => i.path)
      .map((i) => i.path);
    expect(declared).toEqual(
      expect.arrayContaining([
        "/payroll", // 015 Tổng quan
        "/payroll/employees", // 007
        "/payroll/salary-profiles", // 004 (v1)
        "/payroll/salary-components", // 009
        "/payroll/templates", // 010
        "/payroll/bonus-penalties", // 005 (v1)
        "/payroll/periods", // 001 (v1)
        "/payroll/advances", // 012
        "/payroll/budgets", // 014
        "/payroll/payment-batches", // 013
        "/payroll/reports", // 016
        "/payroll/settings/statutory-rates", // 011
      ]),
    );
  });

  it("node LAI (có path riêng + con) mà màn của CHÍNH nó chưa dựng ⇒ hạ thành hàng nhóm, KHÔNG nuốt con đã dựng", () => {
    // Hình dạng này CHƯA có trong PAYROLL_SIDEBAR_V2 nhưng kiểu dữ liệu cho phép, và các WO PAYROLL
    // sau là nơi nó dễ xuất hiện. Bản đầu `return []` ngay khi path chưa dựng ⇒ cả nhánh biến mất
    // IM LẶNG, kéo theo mục con đã chạy được.
    const hybrid: SidebarItemMeta[] = [
      {
        sidebarKey: "payroll.hybrid",
        moduleCode: "PAYROLL",
        label: "Chưa dựng nhưng có con đã dựng",
        path: "/payroll/chua-dung-bao-gio",
        order: 10,
        requiredPermissions: ["access:payroll"],
        children: [
          {
            sidebarKey: "payroll.hybrid.child",
            moduleCode: "PAYROLL",
            label: "Kỳ lương",
            path: "/payroll/periods",
            order: 11,
            requiredPermissions: ["access:payroll", "view:payroll-period"],
          },
        ],
      },
    ];

    const pruned = pruneUnbuiltScreens(hybrid);
    expect(pruned).toHaveLength(1);
    // `path` chết bị GỠ (không còn link chết) nhưng nhánh vẫn còn, con vẫn tới được.
    expect(pruned[0].path).toBeUndefined();
    expect(pruned[0].children?.map((c) => c.path)).toEqual(["/payroll/periods"]);
  });

  it("node LAI mà CẢ nó lẫn con đều chưa dựng ⇒ bỏ hẳn", () => {
    const dead: SidebarItemMeta[] = [
      {
        sidebarKey: "payroll.dead",
        moduleCode: "PAYROLL",
        label: "Chết cả cụm",
        path: "/payroll/khong-co",
        order: 10,
        children: [
          {
            sidebarKey: "payroll.dead.child",
            moduleCode: "PAYROLL",
            label: "Con cũng chết",
            path: "/payroll/cung-khong-co",
            order: 11,
          },
        ],
      },
    ];
    expect(pruneUnbuiltScreens(dead)).toEqual([]);
  });

  it("«Phiếu lương/Tạm ứng của tôi» + màn con KHÔNG lên sidebar PAYROLL (đệ quy)", () => {
    const paths = flattenSidebar(PAYROLL_SIDEBAR_V2).map((i) => i.path);
    expect(paths).not.toContain("/payroll/periods/$periodId");
    expect(paths).not.toContain("/payroll/payslips/$payslipId");
    expect(paths).not.toContain("/me/payslips");
    expect(paths).not.toContain("/me/payroll-advances");
    // PAY-SCREEN-008 «Bảng công kỳ» bám theo MỘT kỳ (`/payroll/periods/:id/timesheet`, SPEC-11 §9.1)
    // ⇒ là TAB của màn chi tiết kỳ, không phải mục điều hướng.
    expect(paths.some((p) => p?.includes("timesheet"))).toBe(false);
  });
});
