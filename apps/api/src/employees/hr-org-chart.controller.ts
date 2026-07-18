import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { HrOrgChartService } from "./hr-org-chart.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-HR-ORGCHART-BE-1 — GET /hr/org-chart/employees (SPEC-03 §14). Distinct controller prefix `hr/org-chart`
 * so it never collides with HrReadController's `hr/employees/:id`. Coarse gate = PermissionGuard +
 * @RequirePermission("read","employee"); the service re-resolves the scope (resolveAndAssert) as the fine
 * data-scope gate (defense-in-depth) and bounds the tree to the caller's scoped active employees.
 */
@Controller("hr/org-chart")
@UseGuards(PermissionGuard)
export class HrOrgChartController {
  constructor(private readonly svc: HrOrgChartService) {}

  @Get("employees")
  @RequirePermission("read", "employee")
  getEmployeeOrgChart(@Req() req: AuthenticatedRequest) {
    return this.svc.getEmployeeOrgChart(req.user);
  }
}
