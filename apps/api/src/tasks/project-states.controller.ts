import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ProjectStatesService } from "./project-states.service";
import { CreateProjectStateDto, UpdateProjectStateDto } from "./tasks.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * PM-1 (apps/projects, mig 0420) — project_states (trạng thái tùy biến theo project).
 *
 * Mọi route gated bởi PermissionGuard (@RequirePermission action:`project_state`, seed 0420 is_sensitive=false
 * → grant công ty là đủ). Global JwtAuthGuard + CompanyGuard chạy trước (auth + tenant). Audit ghi ở service
 * trong cùng tx withTenant. SEC-1: service guard project thuộc tenant trước khi CRUD (chặn chéo tenant qua path).
 */
@Controller()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ProjectStatesController {
  constructor(private readonly states: ProjectStatesService) {}

  /** GET /projects/:projectId/states — danh sách trạng thái của project (order theo sort_order). */
  @Get("projects/:projectId/states")
  @RequirePermission("read", "project_state")
  listStates(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.states.listStates(req.user.companyId, projectId);
  }

  /** POST /projects/:projectId/states — tạo trạng thái tùy biến. */
  @Post("projects/:projectId/states")
  @RequirePermission("create", "project_state")
  createState(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() dto: CreateProjectStateDto,
  ) {
    return this.states.createState(req.user, projectId, dto);
  }

  /** PATCH /states/:stateId — sửa trạng thái (rename/recolor/reorder/set-default). */
  @Patch("states/:stateId")
  @RequirePermission("update", "project_state")
  updateState(
    @Req() req: AuthenticatedRequest,
    @Param("stateId") stateId: string,
    @Body() dto: UpdateProjectStateDto,
  ) {
    return this.states.updateState(req.user, stateId, dto);
  }

  /** DELETE /states/:stateId — soft-delete (chặn nếu còn task tham chiếu → 400). */
  @Delete("states/:stateId")
  @HttpCode(204)
  @RequirePermission("delete", "project_state")
  async deleteState(@Req() req: AuthenticatedRequest, @Param("stateId") stateId: string) {
    await this.states.deleteState(req.user, stateId);
  }
}
