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
import { ProjectsService } from "./projects.service";
// S4-TASK-BE-4 (additive) — Kanban board (GET /projects/:id/kanban, TASK-API-212).
import { TaskKanbanService } from "./task-kanban.service";
import {
  AddMemberDto,
  CloseTaskProjectDto,
  CreateTaskProjectDto,
  ListTaskProjectsQueryDto,
  UpdateMemberRoleDto,
  UpdateTaskProjectDto,
} from "./projects.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S4-TASK-BE-1 — ProjectsController (SPEC-06 Project + member). Prefix /projects.
 *
 * Guard pipeline toàn cục JwtAuthGuard → CompanyGuard chạy TRƯỚC (auth + tenant). MỖI route
 * @UseGuards(PermissionGuard) + @RequirePermission ĐÚNG cặp seed 0485 (read/create/update:project
 * non-sensitive; close/delete/manage-member:project is_sensitive=true). Business logic + owner-check +
 * data-scope + audit + activity ở ProjectsService (KHÔNG ở controller). DTO validate ở biên qua
 * ZodValidationPipe (@mediaos/contracts).
 *
 * S4-TASK-BE-5 (L3, additive): HIỆN THỰC view-report:project (GET /projects/:id/report — SENSITIVE 0485).
 * OUT-OF-SCOPE còn lại (ghi nhận tường minh — KHÔNG route chết im lặng): archive:project (đã seed 0485)
 * → S4-TASK-BE sau. Enforcement data-scope/owner-check trên /tasks legacy → S4-TASK-BE-2.
 */
@Controller("projects")
@UsePipes(ZodValidationPipe)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    // S4-TASK-BE-4 — Kanban board.
    private readonly kanban: TaskKanbanService,
  ) {}

  /** GET /projects — danh sách (read:project). Data-scope: employee @Own · manager @Team · hr/admin @Company. */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "project")
  list(@Req() req: AuthenticatedRequest, @Query() query: ListTaskProjectsQueryDto) {
    return this.projects.listProjects(req.user, query);
  }

  /** POST /projects — tạo dự án (create:project). Creator=Owner khi actor có employee mapping active. */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "project")
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTaskProjectDto) {
    return this.projects.createProject(req.user, dto);
  }

  /** GET /projects/:id — chi tiết (read:project, cùng data-scope với list). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "project")
  getOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.projects.getProject(req.user, id);
  }

  /** PATCH /projects/:id — cập nhật (update:project). KHÔNG đổi status ở đây (đi qua verb close). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "project")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateTaskProjectDto,
  ) {
    return this.projects.updateProject(req.user, id, dto);
  }

  /**
   * POST /projects/:id/close — đóng dự án (close:project, sensitive → owner-check khi manager @Team).
   * @HttpCode(200): action-verb POST mutate-and-return-resource (convention 15+ verb POST đã dùng 200:
   * leave/att/profile-change approve·reject·cancel, api-keys revoke) + đối xứng @HttpCode(204) của remove.
   */
  @Post(":id/close")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("close", "project", { isSensitive: true })
  close(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: CloseTaskProjectDto,
  ) {
    return this.projects.closeProject(req.user, id, dto);
  }

  /** DELETE /projects/:id — soft-delete (delete:project, sensitive → owner-check khi manager @Team). */
  @Delete(":id")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("delete", "project", { isSensitive: true })
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    await this.projects.deleteProject(req.user, id);
  }

  /** GET /projects/:id/members — danh sách thành viên (read:project, cùng data-scope với detail). */
  @Get(":id/members")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "project")
  listMembers(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.projects.getMembers(req.user, id);
  }

  /** POST /projects/:id/members — thêm thành viên (manage-member:project, sensitive → owner-check). */
  @Post(":id/members")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage-member", "project", { isSensitive: true })
  addMember(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: AddMemberDto) {
    return this.projects.addMember(req.user, id, dto);
  }

  /** PATCH /projects/:id/members/:memberId — đổi vai trò (manage-member:project, sensitive → owner-check). */
  @Patch(":id/members/:memberId")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage-member", "project", { isSensitive: true })
  updateMember(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("memberId") memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.projects.updateMemberRole(req.user, id, memberId, dto);
  }

  /** DELETE /projects/:id/members/:memberId — soft-remove (manage-member:project, sensitive → owner-check). */
  @Delete(":id/members/:memberId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage-member", "project", { isSensitive: true })
  async removeMember(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("memberId") memberId: string,
  ) {
    await this.projects.removeMember(req.user, id, memberId);
  }

  /**
   * GET /projects/:id/kanban (S4-TASK-BE-4, TASK-API-212) — board task theo cột `task_status` (Todo/In
   * Progress/In Review/Done/Cancelled). Gate `view-kanban:task` (seed 0485, resource `task` — KHÔNG phải
   * `project`, dù URL nằm dưới /projects). Kéo-thả đổi cột đi qua route riêng `POST /tasks/:id/move`.
   */
  @Get(":id/kanban")
  @UseGuards(PermissionGuard)
  @RequirePermission("view-kanban", "task")
  getKanban(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.kanban.getBoard(req.user, id);
  }

  /**
   * GET /projects/:id/report (S4-TASK-BE-5, SPEC-06 §16.1 · TASK-API) — báo cáo tổng hợp 1 dự án
   * (countsByStatus / overdueCount / assigneeWorkload). Gate `view-report:project` (SENSITIVE, seed 0485):
   * manager @Team chỉ project trong team; hr/admin @Company; employee KHÔNG grant → 403 (PermissionGuard).
   * Project ngoài scope/cross-tenant → 404 (không lộ tồn tại — ProjectsService.getReport).
   */
  @Get(":id/report")
  @UseGuards(PermissionGuard)
  @RequirePermission("view-report", "project", { isSensitive: true })
  getReport(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.projects.getReport(req.user, id);
  }
}
