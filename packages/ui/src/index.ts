/**
 * @mediaos/ui — component thuần (shadcn primitives + layout chrome), không state nghiệp vụ.
 * Layout (app-shell/app-sidebar) phụ thuộc @mediaos/web-core (auth store, nav helper).
 */

// Tiện ích class
export * from "./lib/utils";

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

// Layout chrome
export * from "./components/layout/app-shell";
export * from "./components/layout/app-sidebar";
export * from "./components/layout/page-header";

// Notification bell (chrome dùng chung — tiêu thụ notificationApi của web-core)
export * from "./components/notification-bell";
