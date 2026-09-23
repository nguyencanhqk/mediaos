import { type SidebarItemMeta } from "@mediaos/web-core";
import { pruneUnbuiltScreens } from "./prune-unbuilt";

// ═══════════════════════════════════════════════════════════════════════════
// PAYROLL — sidebar v2 (S15-UI-SHELL-1 · DEC-020 · UI-07 §21.8 · SPEC-11 §9.1)
// ═══════════════════════════════════════════════════════════════════════════
//
// Cấu trúc v2 khai **ĐẦY ĐỦ** ở `PAYROLL_SIDEBAR_V2`, kể cả màn của các WO sau. Mục nào CHƯA có
// route thật thì `pruneUnbuiltScreens` cắt đi trước khi đăng ký ⇒ **không có link chết**, và mỗi WO
// sau chỉ cần thêm route là mục tự hiện — không phải quay lại sửa file này lần nữa.
//
// ⚠️ «Bảng công kỳ» (PAY-SCREEN-008) CỐ Ý VẮNG: đường dẫn của nó là `/payroll/periods/:id/timesheet`
// (SPEC-11 §9.1) — bám theo MỘT kỳ cụ thể, nên không có đường vào ổn định từ sidebar. Nó thuộc màn
// chi tiết kỳ (tab), không phải một mục điều hướng. Sơ đồ UI-07 §21.8 vẽ nó dưới «Dữ liệu tính
// lương» — chỗ đó và §9.1 lệch nhau; §9.1 (có đường dẫn thật) là bản được theo.
//
// ⚠️ «Phiếu lương của tôi» (PAY-SCREEN-006) và «Tạm ứng của tôi» (017) KHÔNG ở đây — chúng thuộc
// sidebar ME, gate `access:me`. Dữ liệu của chính người dùng không nằm sau cổng module quản trị
// tiền lương (`personal-prefs-must-not-sit-behind-permission-gate`).
//
// S16-SOCIAL-FE-1 (D9): `pruneUnbuiltScreens` đã TÁCH sang `./prune-unbuilt.ts` — SOCIAL là module
// thứ hai cần nó. File này chỉ còn RE-EXPORT lại để đường import công khai cũ không chết.

export { pruneUnbuiltScreens };

/** Cấu trúc ĐẦY ĐỦ của sidebar PAYROLL v2 — gồm cả màn chưa dựng (bị cắt lúc đăng ký). */
export const PAYROLL_SIDEBAR_V2: readonly SidebarItemMeta[] = [
  {
    // PAY-SCREEN-015 — trang gốc /payroll, gác cặp ĐỌC báo cáo + sàn scope Company (server ép).
    sidebarKey: "payroll.overview",
    moduleCode: "PAYROLL",
    label: "Tổng quan",
    path: "/payroll",
    icon: "layout-dashboard",
    group: "overview",
    order: 10,
    requiredPermissions: ["access:payroll", "view:payroll-report"],
  },

  // ── Dữ liệu gốc ──────────────────────────────────────────────────────────
  {
    // PAY-SCREEN-007
    sidebarKey: "payroll.employees",
    moduleCode: "PAYROLL",
    label: "Nhân viên",
    path: "/payroll/employees",
    icon: "users",
    group: "master-data",
    order: 20,
    requiredPermissions: ["access:payroll", "view:payroll-employee"],
  },
  {
    // PAY-SCREEN-004 (v1 — ĐANG CHẠY)
    sidebarKey: "payroll.salaryProfiles",
    moduleCode: "PAYROLL",
    label: "Hồ sơ lương",
    path: "/payroll/salary-profiles",
    icon: "wallet",
    group: "master-data",
    order: 30,
    requiredPermissions: ["access:payroll", "view:salary-profile"],
  },
  {
    // PAY-SCREEN-009
    sidebarKey: "payroll.salaryComponents",
    moduleCode: "PAYROLL",
    label: "Thành phần lương",
    path: "/payroll/salary-components",
    icon: "list-tree",
    group: "master-data",
    order: 40,
    requiredPermissions: ["access:payroll", "view:salary-component"],
  },
  {
    // PAY-SCREEN-010
    sidebarKey: "payroll.templates",
    moduleCode: "PAYROLL",
    label: "Mẫu bảng lương",
    path: "/payroll/templates",
    icon: "table-2",
    group: "master-data",
    order: 50,
    requiredPermissions: ["access:payroll", "view:payroll-template"],
  },

  // ── Nghiệp vụ ────────────────────────────────────────────────────────────
  {
    // Hàng ĐẠI DIỆN NHÓM — không có màn riêng, chỉ gom mục con (UI-07 §21.8).
    sidebarKey: "payroll.inputData",
    moduleCode: "PAYROLL",
    label: "Dữ liệu tính lương",
    icon: "database",
    group: "operation",
    order: 60,
    collapsible: true,
    defaultCollapsed: true,
    requiredPermissions: ["access:payroll"],
    children: [
      {
        // PAY-SCREEN-005 (v1 — ĐANG CHẠY). Nhãn GIỮ «Thưởng / phạt»: đổi sang «Thu nhập/khấu trừ
        // khác» là việc của Track C, lúc màn thật sự nhận thêm hai loại dữ liệu đó.
        sidebarKey: "payroll.bonusPenalties",
        moduleCode: "PAYROLL",
        label: "Thưởng / phạt",
        path: "/payroll/bonus-penalties",
        icon: "circle-dollar-sign",
        group: "operation",
        order: 61,
        requiredPermissions: ["access:payroll", "view:bonus-penalty"],
      },
    ],
  },
  {
    sidebarKey: "payroll.calculation",
    moduleCode: "PAYROLL",
    label: "Tính lương",
    icon: "calculator",
    group: "operation",
    order: 70,
    collapsible: true,
    requiredPermissions: ["access:payroll"],
    children: [
      {
        // PAY-SCREEN-001 (v1 — ĐANG CHẠY)
        sidebarKey: "payroll.periods",
        moduleCode: "PAYROLL",
        label: "Kỳ lương",
        path: "/payroll/periods",
        icon: "calendar-days",
        group: "operation",
        order: 71,
        requiredPermissions: ["access:payroll", "view:payroll-period"],
      },
      {
        // PAY-SCREEN-012
        sidebarKey: "payroll.advances",
        moduleCode: "PAYROLL",
        label: "Tạm ứng",
        path: "/payroll/advances",
        icon: "hand-coins",
        group: "operation",
        order: 72,
        requiredPermissions: ["access:payroll", "view:payroll-advance"],
      },
      {
        // PAY-SCREEN-014
        sidebarKey: "payroll.budgets",
        moduleCode: "PAYROLL",
        label: "Ngân sách lương",
        path: "/payroll/budgets",
        icon: "piggy-bank",
        group: "operation",
        order: 73,
        requiredPermissions: ["access:payroll", "view:payroll-budget"],
      },
    ],
  },
  {
    // PAY-SCREEN-013
    sidebarKey: "payroll.paymentBatches",
    moduleCode: "PAYROLL",
    label: "Chi trả",
    path: "/payroll/payment-batches",
    icon: "banknote",
    group: "operation",
    order: 80,
    requiredPermissions: ["access:payroll", "view:payment-batch"],
  },

  // ── Báo cáo ──────────────────────────────────────────────────────────────
  {
    // PAY-SCREEN-016
    sidebarKey: "payroll.reports",
    moduleCode: "PAYROLL",
    label: "Báo cáo",
    path: "/payroll/reports",
    icon: "bar-chart-3",
    group: "report",
    order: 90,
    requiredPermissions: ["access:payroll", "view:payroll-report"],
  },

  // ── Thiết lập ────────────────────────────────────────────────────────────
  // Nhóm «Thiết lập» của UI-07 §21.8 = chính SECTION HEADER `group: "settings"` (GROUP_LABELS
  // dịch ra «Thiết lập»). Không bọc thêm một hàng cha cùng tên — hai nhãn «Thiết lập» chồng nhau.
  {
    // PAY-SCREEN-011
    sidebarKey: "payroll.statutoryRates",
    moduleCode: "PAYROLL",
    label: "Tỉ lệ luật định",
    path: "/payroll/settings/statutory-rates",
    icon: "scale",
    group: "settings",
    order: 100,
    requiredPermissions: ["access:payroll", "view:statutory-rate"],
  },
];

/**
 * Bản ĐĂNG KÝ = cấu trúc v2 đã cắt mục chưa có màn. Hôm nay còn 3 màn thật (kỳ lương · hồ sơ lương ·
 * thưởng/phạt); mỗi WO sau thêm route là mục tương ứng tự xuất hiện.
 */
export const PAYROLL_SIDEBAR: readonly SidebarItemMeta[] = pruneUnbuiltScreens(PAYROLL_SIDEBAR_V2);
