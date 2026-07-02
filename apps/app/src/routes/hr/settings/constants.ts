/**
 * Hằng dùng cho /hr/settings/employee-code (S2-FE-HR-8 — UI-08 §26 / UI-HR-SCREEN-017).
 *
 * Cổng quyền = cặp ENGINE THỰC (`view`/`update`:`employee-code-config`, `preview`:`employee-code`) —
 * seed THẬT mig 0459 + 0445 (HR_ENGINE_PAIRS trong ../constants). Literal string dùng cho
 * requiredAnyPermissions của RouteMeta/sidebar — createPermissionChecker khớp TRỰC TIẾP với
 * capabilities map (KHÔNG cần đăng ký thêm PERMISSION_CODE_TO_PAIR trong web-core, tránh drift —
 * bài học S1-FND-MODULE/S3-FE-wave2).
 */
import { type RouteMeta } from "@mediaos/web-core";
import { HR_ENGINE_PAIRS } from "../constants";

export const EMPLOYEE_CODE_CONFIG_PATH = "/hr/settings/employee-code";

export const EMPLOYEE_CODE_CONFIG_VIEW_PERMISSION = `${HR_ENGINE_PAIRS.VIEW_EMPLOYEE_CODE_CONFIG.action}:${HR_ENGINE_PAIRS.VIEW_EMPLOYEE_CODE_CONFIG.resourceType}`;
export const EMPLOYEE_CODE_CONFIG_UPDATE_PERMISSION = `${HR_ENGINE_PAIRS.UPDATE_EMPLOYEE_CODE_CONFIG.action}:${HR_ENGINE_PAIRS.UPDATE_EMPLOYEE_CODE_CONFIG.resourceType}`;
export const EMPLOYEE_CODE_PREVIEW_PERMISSION = `${HR_ENGINE_PAIRS.PREVIEW_EMPLOYEE_CODE.action}:${HR_ENGINE_PAIRS.PREVIEW_EMPLOYEE_CODE.resourceType}`;

/**
 * RouteMeta CỤC BỘ (KHÔNG đưa vào ROUTE_REGISTRY web-core — không cần thiết vì gate đã đủ literal,
 * cùng kỹ thuật systemLoginLogsRoute/hrOrgChartRoute trong router.tsx).
 */
export const EMPLOYEE_CODE_CONFIG_ROUTE_META: RouteMeta = {
  routeKey: "hr.employee-code-config",
  path: EMPLOYEE_CODE_CONFIG_PATH,
  layout: "MODULE_WORKSPACE",
  moduleCode: "HR",
  screenCode: "HR-SCREEN-EMPLOYEE-CODE-CONFIG",
  titleKey: "routeTitle.hrEmployeeCodeConfig",
  requiredAnyPermissions: [EMPLOYEE_CODE_CONFIG_VIEW_PERMISSION],
  showInSidebar: true,
  order: 25,
};
