import { type SidebarItemMeta } from "@mediaos/web-core";
import { AUDIT_LOG_VIEW_PERMISSION } from "@/routes/system/auth-logs/constants";
import { FOUNDATION_FILE_VIEW_PERMISSION } from "@/routes/system/files/constants";
import {
  FOUNDATION_PATH,
  SYSTEM_FILE_ACCESS_LOGS_ROUTE_META,
  SYSTEM_HEALTH_ROUTE_META,
  SYSTEM_JOBS_ROUTE_META,
  SYSTEM_RETENTION_ROUTE_META,
  SYSTEM_SETTINGS_ROUTE_META,
} from "@/routes/system/foundation/constants";
import { FOUNDATION_MODULE_VIEW_PERMISSION } from "@/routes/system/modules/constants";

// ---------------------------------------------------------------------------
// FOUNDATION — Hệ thống
// ---------------------------------------------------------------------------
export const SYSTEM_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "system.overview",
    moduleCode: "FOUNDATION",
    label: "Tổng quan hệ thống",
    path: "/system",
    icon: "settings",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["FOUNDATION.SETTING.VIEW", "AUTH.USER.VIEW"],
  },
  // S2-FE-FND-1 (FND1-APP) — ADDITIVE. Gate theo cặp seed THẬT mig 0435 (FOUNDATION.COMPANY.VIEW →
  // view:foundation-company; FOUNDATION.SETTING.VIEW → view:foundation-setting). filterSidebarItems ẩn
  // khi thiếu — KHÔNG hard-code role.
  {
    sidebarKey: "system.company",
    moduleCode: "FOUNDATION",
    label: "Hồ sơ công ty",
    path: "/system/company",
    icon: "building-2",
    group: "admin",
    order: 15,
    requiredAnyPermissions: ["FOUNDATION.COMPANY.VIEW"],
  },
  {
    sidebarKey: "system.company-settings",
    moduleCode: "FOUNDATION",
    label: "Cấu hình công ty",
    path: "/system/company/settings",
    icon: "sliders-horizontal",
    group: "admin",
    order: 16,
    requiredAnyPermissions: ["FOUNDATION.SETTING.VIEW"],
  },
  {
    sidebarKey: "system.users",
    moduleCode: "FOUNDATION",
    label: "Người dùng",
    path: "/system/users",
    icon: "users",
    group: "admin",
    order: 20,
    requiredAnyPermissions: ["AUTH.USER.VIEW"],
  },
  {
    sidebarKey: "system.roles",
    moduleCode: "FOUNDATION",
    label: "Vai trò",
    path: "/system/roles",
    icon: "shield",
    group: "admin",
    order: 30,
    requiredAnyPermissions: ["AUTH.ROLE.VIEW"],
  },
  // S2-FE-AUTH-4 (lane FE batch C) — danh mục quyền toàn cục (đọc).
  {
    sidebarKey: "system.permissions",
    moduleCode: "FOUNDATION",
    label: "Danh mục quyền",
    path: "/system/permissions",
    icon: "key-round",
    group: "admin",
    order: 31,
    requiredAnyPermissions: ["AUTH.PERMISSION.VIEW"],
  },
  // S2-FE-FND-2: gate theo cặp ENGINE THỰC ('view:audit-log', seed mig 0340, grant company-admin) —
  // literal pair (cùng kỹ thuật system.login-logs), KHÔNG dùng mã FE FOUNDATION.AUDIT_LOG.VIEW qua
  // PERMISSION_CODE_TO_PAIR (bài học drift: cặp map cũ 'view:foundation-audit-log' KHÔNG được
  // AuditController enforce — sẽ tạo hố FE-hiện-BE-403).
  {
    sidebarKey: "system.audit-logs",
    moduleCode: "FOUNDATION",
    label: "Audit log",
    path: "/system/audit-logs",
    icon: "file-clock",
    group: "report",
    order: 40,
    requiredAnyPermissions: [AUDIT_LOG_VIEW_PERMISSION],
  },
  // S2-AUTH-BE-5 — viewer nhật ký bảo mật. Gate theo cặp ENGINE THỰC ('view:audit-log',
  // seed mig 0340, grant company-admin), KHÔNG mã FE → filterSidebarItems khớp trực tiếp
  // capabilities (tránh drift PERMISSION_CODE_TO_PAIR).
  {
    sidebarKey: "system.login-logs",
    moduleCode: "FOUNDATION",
    label: "Nhật ký đăng nhập",
    path: "/system/login-logs",
    icon: "log-in",
    group: "report",
    order: 41,
    requiredAnyPermissions: [AUDIT_LOG_VIEW_PERMISSION],
  },
  {
    sidebarKey: "system.security-events",
    moduleCode: "FOUNDATION",
    label: "Sự kiện bảo mật",
    path: "/system/security-events",
    icon: "shield-alert",
    group: "report",
    order: 42,
    requiredAnyPermissions: [AUDIT_LOG_VIEW_PERMISSION],
  },
  // S2-FE-FND-2 — viewer file metadata. Cặp seed THẬT view:foundation-file (mig 0435, is_sensitive=false,
  // bulk-grant company-admin qua LIKE 'foundation-%').
  {
    sidebarKey: "system.files",
    moduleCode: "FOUNDATION",
    label: "Tệp tin",
    path: "/system/files",
    icon: "file",
    group: "report",
    order: 43,
    requiredAnyPermissions: [FOUNDATION_FILE_VIEW_PERMISSION],
  },
  // S2-FE-FND-3 — Module Catalog admin. Cặp seed THẬT view:foundation-module (mig 0435 dòng 338,
  // is_sensitive=false, bulk-grant company-admin qua LIKE 'foundation-%') — cặp ModuleAdminController
  // thật sự @RequirePermission (S2-FND-BE-1).
  {
    sidebarKey: "system.modules",
    moduleCode: "FOUNDATION",
    label: "Danh mục module",
    path: "/system/modules",
    icon: "layout-grid",
    group: "admin",
    order: 21,
    requiredAnyPermissions: [FOUNDATION_MODULE_VIEW_PERMISSION],
  },
  // S2-FE-FND-5 (lane FE batch C) — Sequence counters + Seed status (ops admin). Gate theo cặp SEED
  // THẬT mig 0435 (view:foundation-sequence / view:foundation-seed) qua PERMISSION_CODE_TO_PAIR.
  {
    sidebarKey: "system.sequences",
    moduleCode: "FOUNDATION",
    label: "Bộ đếm mã",
    path: "/system/sequences",
    icon: "hash",
    group: "admin",
    order: 35,
    requiredAnyPermissions: ["FOUNDATION.SEQUENCE.VIEW"],
  },
  {
    sidebarKey: "system.seeds",
    moduleCode: "FOUNDATION",
    label: "Trạng thái Seed",
    path: "/system/seeds",
    icon: "database",
    group: "admin",
    order: 36,
    requiredAnyPermissions: ["FOUNDATION.SEED.VIEW"],
  },
  // S2-FE-FND-7 (H8/§7) — 3 màn System đã wired (S2-FE-FND-4/6) nhưng THIẾU visibility trong sidebar.
  // requiredAnyPermissions = CHÍNH mảng của route-meta (foundation/constants) → sidebar pair ===
  // route-meta pair, chống pair-drift. filterSidebarItems ẩn theo cặp — KHÔNG hard-code role.
  //
  // S5-LEAVE-HOLIDAYS-MOVE-1: entry "system.public-holidays" (Ngày nghỉ lễ) ĐÃ GỠ khỏi đây — màn RE-HOME
  // sang LEAVE_SIDEBAR bên dưới (path /leave/public-holidays, cùng gate FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS).
  // Retention: gate view:foundation-retention (KHÔNG manage — manage sensitive, ẩn nhầm company-admin).
  {
    sidebarKey: "system.retention",
    moduleCode: "FOUNDATION",
    label: "Chính sách lưu trữ",
    path: FOUNDATION_PATH.RETENTION,
    icon: "archive",
    group: "admin",
    order: 37,
    requiredAnyPermissions: SYSTEM_RETENTION_ROUTE_META.requiredAnyPermissions,
  },
  // Health: gate ĐỦ CẢ 2 cặp [view:foundation-setting, view:user] khớp systemHealthMeta (1 cặp = mismatch).
  {
    sidebarKey: "system.health",
    moduleCode: "FOUNDATION",
    label: "Tình trạng hệ thống",
    path: FOUNDATION_PATH.HEALTH,
    icon: "activity",
    group: "report",
    order: 44,
    requiredAnyPermissions: SYSTEM_HEALTH_ROUTE_META.requiredAnyPermissions,
  },
  {
    sidebarKey: "system.file-access-logs",
    moduleCode: "FOUNDATION",
    label: "Nhật ký truy cập tệp",
    path: FOUNDATION_PATH.FILE_ACCESS_LOGS,
    icon: "file-search",
    group: "report",
    order: 45,
    requiredAnyPermissions: SYSTEM_FILE_ACCESS_LOGS_ROUTE_META.requiredAnyPermissions,
  },
  // S5-FND-JOBS-OBS-1 — /system/jobs (System Jobs observability, READ-ONLY). Gate view:foundation-job
  // (KHÔNG sensitive, company-admin có sẵn qua bulk-grant mig 0435).
  {
    sidebarKey: "system.jobs",
    moduleCode: "FOUNDATION",
    label: "Nhật ký system job",
    path: FOUNDATION_PATH.SYSTEM_JOBS,
    icon: "activity",
    group: "report",
    order: 46,
    requiredAnyPermissions: SYSTEM_JOBS_ROUTE_META.requiredAnyPermissions,
  },
  // S2-FE-FND-8 — /system/settings (System Settings admin, UI-SYSTEM-SCREEN-004). Trước đây gộp vào
  // "Cấu hình công ty" (system.company-settings) chờ BE endpoint riêng — BE đã ship (S2-FND-BE-8), tách
  // entry riêng. requiredAnyPermissions dùng CHUNG route-meta (chống pair-drift, giống 4 entry S2-FE-FND-7).
  {
    sidebarKey: "system.settings",
    moduleCode: "FOUNDATION",
    label: "Cấu hình hệ thống",
    path: FOUNDATION_PATH.SYSTEM_SETTINGS,
    icon: "shield-alert",
    group: "admin",
    order: 17,
    requiredAnyPermissions: SYSTEM_SETTINGS_ROUTE_META.requiredAnyPermissions,
  },
];
