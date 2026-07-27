import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { OrgService } from "./org.service";
import {
  AddTeamMemberDto,
  AssignTeamLeaderDto,
  CreateOrgUnitDto,
  CreateTeamDto,
  UpdateOrgUnitDto,
  UpdateTeamDto,
} from "./org.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * OrgController — phòng ban (org_units) + team.
 *
 * Permission (F2, ORG-002/003): MỌI mutation (create/update/delete/leader/head/members) phải qua
 * PermissionGuard + @RequirePermission. resource_type 'org_unit'/'team' khớp catalog seed
 * (migration 0030) + audit object_type (0014).
 *
 * ĐƯỜNG ĐỌC — RANH GIỚI LÀ "CƠ CẤU ≠ NGƯỜI" (S6-SEC-ORG-1, đóng KI-030):
 *
 *   • MỞ cho mọi user tenant (`TENANT_READ`): `units`, `units/tree`, `departments`, `roles`.
 *     Đây là DANH MỤC — tên phòng ban, hình dạng cây, tên vai trò — không nêu ai là ai.
 *     `apps/app` phụ thuộc trực tiếp: `routes/hr/org-chart/OrgChartPage.tsx` và
 *     `layouts/workspace/TaskSidebarTree.tsx` gọi `units/tree`; `roles` nuôi ô chọn vai trò ở FE.
 *     Siết bốn route này = gãy UI của mọi nhân viên, nên chúng ở lại có CHỮ KÝ trong
 *     `apps/api/test/foundation/route-verdicts.ts` chứ không phải vì bị bỏ quên.
 *
 *   • GATE (`employees`, `teams`, `teams/:id/members`): ba route này trả dữ liệu VỀ NGƯỜI —
 *     `employees` trả id·email·fullName·status + team membership của mọi user chưa xoá
 *     (`org.repository.ts` listEmployees), `teams/:id/members` trả cả `userEmail`. Trước
 *     S6-SEC-ORG-1 chúng không mang guard nào ⇒ mọi user đã đăng nhập đọc được trọn danh bạ
 *     tenant, trong khi `/hr/employees` cùng lớp dữ liệu thì ép `read:employee` + data_scope.
 *     Cặp quyền lấy từ seed CÓ THẬT, không phát minh: `read:user` (0005_permissions.sql:205),
 *     `read:team` (0005:200, tái khẳng định 0030:28).
 *
 * ⚠️ `@UseGuards(PermissionGuard)` đặt THEO ROUTE, KHÔNG nâng lên cấp class: PermissionGuard
 *    fail-closed khi route thiếu `@RequirePermission`, nên nâng cấp class sẽ biến cả 4 route cơ cấu
 *    ở trên thành 403. Chốt hồi quy: `test/integration/org-directory-permission.int-spec.ts`.
 *
 * JwtAuthGuard + CompanyGuard toàn cục (app.module) vẫn ép đăng nhập + tenant cho TẤT CẢ route trên.
 */
@Controller("org")
@UsePipes(ZodValidationPipe)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  // ── Departments (org_units) ──────────────────────────────────────────────────

  @Get("units")
  listOrgUnits(@Req() req: AuthenticatedRequest, @Query("status") status?: string) {
    return this.org.listOrgUnits(req.user.companyId, status);
  }

  @Get("units/tree")
  getOrgTree(@Req() req: AuthenticatedRequest) {
    return this.org.getOrgTree(req.user.companyId);
  }

  @Post("units")
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "org_unit")
  createOrgUnit(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrgUnitDto) {
    return this.org.createOrgUnit(req.user.companyId, dto);
  }

  @Patch("units/:id")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "org_unit")
  updateOrgUnit(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateOrgUnitDto,
  ) {
    return this.org.updateOrgUnit(req.user.companyId, id, dto);
  }

  @Delete("units/:id")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("delete", "org_unit")
  deleteOrgUnit(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.org.deleteOrgUnit(req.user.companyId, id);
  }

  // Bí danh cũ của GET /units (G4-1) — cùng dữ liệu CƠ CẤU nên cùng lý do mở (xem docstring đầu file).
  @Get("departments")
  listDepartmentsLegacy(@Req() req: AuthenticatedRequest) {
    return this.org.listOrgUnits(req.user.companyId);
  }

  // Legacy mutation alias — MUST guard too (else a bypass of POST /units).
  @Post("departments")
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "org_unit")
  createDepartmentLegacy(@Req() req: AuthenticatedRequest, @Body() dto: CreateOrgUnitDto) {
    return this.org.createOrgUnit(req.user.companyId, dto);
  }

  // ── Teams ────────────────────────────────────────────────────────────────────

  // Cơ cấu team = dữ liệu VỀ NGƯỜI (ai thuộc nhóm nào) ⇒ gate. Xem docstring đầu file.
  @Get("teams")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "team")
  listTeams(@Req() req: AuthenticatedRequest, @Query("status") status?: string) {
    return this.org.listTeams(req.user.companyId, status);
  }

  @Post("teams")
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "team")
  createTeam(@Req() req: AuthenticatedRequest, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(req.user.companyId, dto);
  }

  @Patch("teams/:id")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "team")
  updateTeam(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.org.updateTeam(req.user.companyId, id, dto);
  }

  @Patch("teams/:id/leader")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "team")
  assignTeamLeader(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: AssignTeamLeaderDto,
  ) {
    return this.org.assignTeamLeader(req.user.companyId, id, dto);
  }

  @Delete("teams/:id")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("delete", "team")
  deleteTeam(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.org.deleteTeam(req.user.companyId, id);
  }

  // Trả `userFullName` + `userEmail` của từng thành viên ⇒ danh bạ, phải gate (cùng cặp với listTeams).
  @Get("teams/:id/members")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "team")
  listTeamMembers(@Req() req: AuthenticatedRequest, @Param("id") teamId: string) {
    return this.org.listTeamMembers(req.user.companyId, teamId);
  }

  @Post("teams/:id/members")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "team")
  addTeamMember(
    @Req() req: AuthenticatedRequest,
    @Param("id") teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.org.addTeamMember(req.user.companyId, teamId, dto);
  }

  @Delete("teams/:id/members/:userId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "team")
  removeTeamMember(
    @Req() req: AuthenticatedRequest,
    @Param("id") teamId: string,
    @Param("userId") userId: string,
  ) {
    return this.org.removeTeamMember(req.user.companyId, teamId, userId);
  }

  // ── Employees (legacy G4-1) ─────────────────────────────────────────────────

  // Danh bạ toàn tenant (id·email·fullName·status + team membership) ⇒ cùng lớp dữ liệu với
  // /hr/employees, phải gate. Đây là lỗ KI-030.
  @Get("employees")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "user")
  listEmployees(@Req() req: AuthenticatedRequest) {
    return this.org.listEmployees(req.user.companyId);
  }

  // ── Roles catalog ─────────────────────────────────────────────────────────────
  // READ mở cho user tenant (như units/units-tree — KHÔNG như teams, vốn đã gate từ S6-SEC-ORG-1):
  // đây là DANH MỤC vai trò, trả đúng { id, name } và KHÔNG nêu ai đang giữ vai trò nào, nên nó không
  // phải danh bạ. Dùng cho dropdown "vai trò mặc định" của chức vụ (F4/F11). RLS lộ role tenant +
  // system (company_id NULL); repo đã loại role operator-plane khỏi đường đọc.
  // JwtAuthGuard + CompanyGuard toàn cục vẫn ép đăng nhập + tenant.
  @Get("roles")
  listRoles(@Req() req: AuthenticatedRequest) {
    return this.org.listRoles(req.user.companyId);
  }
}
