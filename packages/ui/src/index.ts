/**
 * @mediaos/ui — component thuần (shadcn primitives + layout chrome), không state nghiệp vụ.
 * Layout (app-shell/app-sidebar) phụ thuộc @mediaos/web-core (auth store, nav helper).
 */

// Tiện ích class
export * from "./lib/utils";

// Theme light/dark (token ở src/styles/theme.css — bootstrap trong index.html từng app)
export * from "./hooks/use-theme";
export * from "./components/ui/theme-toggle";

// UI primitives
export * from "./components/ui/button";
export * from "./components/ui/input";
export * from "./components/ui/select";
export * from "./components/ui/dialog";
// S5-TASK-BOARD-UX-1 — panel trượt phải (chi tiết mở từ board, giữ ngữ cảnh nền)
export * from "./components/ui/sheet";
export * from "./components/ui/skeleton";
export * from "./components/ui/empty-state";
export * from "./components/ui/data-table";
// S14-FE-DEBT-1 — footer phân trang SERVER-side dùng chung (khối additive)
export * from "./components/ui/pagination-footer";
export * from "./components/ui/avatar";
export * from "./components/ui/badge";
export * from "./components/ui/card";
// HR-PROFILE-UI-1 — primitives mới (khối additive, KHÔNG đổi export cũ)
export * from "./components/ui/tabs";
export * from "./components/ui/checkbox";
export * from "./components/ui/popover";
export * from "./components/ui/stat-card";
export * from "./components/ui/donut-chart";
// S17-CHAT-UX2-FE-4 — accordion (bảng thông tin phòng chat v2, khối additive)
export * from "./components/ui/accordion";
// S15-UI-SHELL-1 (DEC-020) — vỏ UI dùng chung mọi module: toolbar chuẩn · ⚙ chọn cột · footer bảng ·
// pill trạng thái. Khối additive, KHÔNG đổi export cũ (UI-07 §26.1).
export * from "./components/ui/data-toolbar";
export * from "./components/ui/column-picker";
export * from "./components/ui/table-footer";
export * from "./components/ui/status-pill";
export * from "./hooks/use-local-pref";
export * from "./hooks/use-column-visibility";

// Layout chrome
export * from "./components/layout/app-shell";
export * from "./components/layout/app-sidebar";
export * from "./components/layout/page-header";
// S15-UI-SHELL-1 — header màn CHI TIẾT (UI-07 §13.7). THAY `PageHeader` trên màn chi tiết.
export * from "./components/layout/detail-page-header";
