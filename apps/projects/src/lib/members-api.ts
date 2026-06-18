import { z } from "zod";
import { employeeListItemSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Danh bạ nhân sự — dùng để map assigneeUserId → tên/avatar trong picker người nhận.
 * Reuse GET /employees (gated read:employee) như apps/studio + apps/people. Người dùng không có
 * quyền read:employee sẽ nhận 403 → UI fallback hiển thị assignee theo id rút gọn (xem useEmployeeMap).
 */
export const membersApi = {
  listEmployees: () =>
    apiFetch(`/employees?status=active`, z.array(employeeListItemSchema)),
};
