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
export * from "./components/ui/skeleton";
export * from "./components/ui/empty-state";
export * from "./components/ui/data-table";
export * from "./components/ui/avatar";
export * from "./components/ui/badge";
export * from "./components/ui/card";
// HR-PROFILE-UI-1 — primitives mới (khối additive, KHÔNG đổi export cũ)
export * from "./components/ui/tabs";
export * from "./components/ui/checkbox";
export * from "./components/ui/popover";
export * from "./components/ui/stat-card";
export * from "./components/ui/donut-chart";

// Layout chrome
export * from "./components/layout/app-shell";
export * from "./components/layout/app-sidebar";
export * from "./components/layout/page-header";
