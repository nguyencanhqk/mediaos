import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PermissionService } from "../permission/permission.service";
import { TaskAttachmentsService } from "./task-attachments.service";
import { CreateAttachmentIntentDto } from "./tasks.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * TaskAttachmentsController — file đính kèm THẬT cho Task Hub (B4).
 *
 * Global JwtAuthGuard + CompanyGuard (auth + tenant) đã đăng ký app-wide (mirror TasksController) →
 * KHÔNG @UseGuards lại ở đây (sẽ ép Nest dựng guard trong injector TasksModule, thiếu TokenService).
 * Gate phân tầng:
 *  - Upload: KHÔNG dùng hard PermissionGuard (nếu dùng, người được giao việc 0-quyền-global bị chặn ở
 *    guard TRƯỚC khi tới service). Thay vào đó controller resolve `create:task` qua PermissionService
 *    rồi OR với owner/assignee ở service — cả 2 nhánh đều cấp được upload.
 *  - List/Download: gate `read:task` (đọc task của tenant). RLS + key-prefix là hàng rào thật.
 *  - Delete: gate `delete:task` (mirror DELETE /tasks). Soft-delete (204).
 */
@Controller("tasks/:taskId/attachments")
@UsePipes(ZodValidationPipe)
export class TaskAttachmentsController {
  constructor(
    private readonly attachments: TaskAttachmentsService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * POST /tasks/:taskId/attachments — tạo upload-intent (presigned PUT). Gate = create:task HOẶC
   * owner/assignee (resolve permission ở đây, OR owner-check ở service).
   */
  @Post()
  async createIntent(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: CreateAttachmentIntentDto,
  ) {
    const decision = await this.permissions.can({
      userId: req.user.id,
      companyId: req.user.companyId,
      action: "create",
      resourceType: "task",
    });
    return this.attachments.createUploadIntent(
      { id: req.user.id, companyId: req.user.companyId },
      taskId,
      dto,
      decision.allow,
    );
  }

  /** GET /tasks/:taskId/attachments — liệt kê attachment của task (gate read:task). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  list(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    return this.attachments.listByTask({ id: req.user.id, companyId: req.user.companyId }, taskId);
  }

  /** GET /tasks/:taskId/attachments/:id/download — presigned GET (gate read:task, scope tenant). */
  @Get(":attachmentId/download")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "task")
  download(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    return this.attachments.getDownloadUrl(
      { id: req.user.id, companyId: req.user.companyId },
      taskId,
      attachmentId,
    );
  }

  /** DELETE /tasks/:taskId/attachments/:id — soft-delete (gate delete:task), 204. */
  @Delete(":attachmentId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("delete", "task")
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    await this.attachments.softDelete(
      { id: req.user.id, companyId: req.user.companyId },
      taskId,
      attachmentId,
    );
  }
}
