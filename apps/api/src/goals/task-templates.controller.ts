import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  ParseUUIDPipe,
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
import { TaskTemplatesService } from "./task-templates.service";
import {
  CreateTaskTemplateDto,
  CreateTaskTemplateItemDto,
  ListTaskTemplatesQueryDto,
  UpdateTaskTemplateDto,
  UpdateTaskTemplateItemDto,
} from "./goals.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-GOAL-TPL-1 — TaskTemplatesController (SPEC-10 §15 GOAL-API-012 · GOAL-SCREEN-006). Prefix
 * `/task-templates` (tài nguyên danh mục đứng riêng — nó dùng được cho nhiều mục tiêu, không nằm dưới
 * `/goals/:id`).
 *
 * Pipeline toàn cục JwtAuthGuard → CompanyGuard chạy TRƯỚC. MỌI route gate ĐÚNG cặp đã seed ở migration
 * 0527: `('manage','task-template')` (is_sensitive=false — data_scope §11 mới là lớp chặn thật, xử lý ở
 * service). Đọc và ghi CÙNG cặp vì SPEC-10 §11 chỉ định nghĩa một cặp `manage` cho danh mục; phạm vi
 * đọc/ghi khác nhau được phân giải Ở SERVICE (đọc thấy cả template dùng-chung, ghi thì không).
 *
 * ⚠️ Route `POST /goals/:id/decompose` (GOAL-API-011) KHÔNG ở đây — nó gate `('update','goal')` nên nằm
 * trong `GoalsController` cùng các đường ghi khác của mục tiêu.
 */
@Controller("task-templates")
@UsePipes(ZodValidationPipe)
export class TaskTemplatesController {
  constructor(private readonly templates: TaskTemplatesService) {}

  /** GET /task-templates — danh sách (KHÔNG kèm items; `itemCount` cho màn hình danh mục). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  list(@Req() req: AuthenticatedRequest, @Query() query: ListTaskTemplatesQueryDto) {
    return this.templates.listTemplates(req.user, query);
  }

  /** GET /task-templates/:id — chi tiết KÈM items (nguồn preview của wizard phân rã). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.templates.getTemplate(req.user, id);
  }

  /** POST /task-templates — tạo header (+ items tuỳ chọn) trong 1 transaction. */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTaskTemplateDto) {
    return this.templates.createTemplate(req.user, dto);
  }

  /** PATCH /task-templates/:id — chỉ HEADER (items có endpoint riêng bên dưới). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskTemplateDto,
  ) {
    return this.templates.updateTemplate(req.user, id, dto);
  }

  /** DELETE /task-templates/:id — xoá MỀM + cascade mềm xuống items (BẤT BIẾN #2). */
  @Delete(":id")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  async remove(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    await this.templates.deleteTemplate(req.user, id);
  }

  // ── Items (GOAL-API-012 "+ items") ────────────────────────────────────────────
  // Luôn NESTED dưới `:templateId`: service authorize HEADER rồi mới tra item theo CẶP
  // (templateId, itemId). Route phẳng `/task-template-items/:id` sẽ là cửa ghi vòng qua gate header.

  @Get(":templateId/items")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  listItems(
    @Req() req: AuthenticatedRequest,
    @Param("templateId", ParseUUIDPipe) templateId: string,
  ) {
    return this.templates.listItems(req.user, templateId);
  }

  @Post(":templateId/items")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  createItem(
    @Req() req: AuthenticatedRequest,
    @Param("templateId", ParseUUIDPipe) templateId: string,
    @Body() dto: CreateTaskTemplateItemDto,
  ) {
    return this.templates.createItem(req.user, templateId, dto);
  }

  @Patch(":templateId/items/:itemId")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  updateItem(
    @Req() req: AuthenticatedRequest,
    @Param("templateId", ParseUUIDPipe) templateId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateTaskTemplateItemDto,
  ) {
    return this.templates.updateItem(req.user, templateId, itemId, dto);
  }

  @Delete(":templateId/items/:itemId")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "task-template")
  async removeItem(
    @Req() req: AuthenticatedRequest,
    @Param("templateId", ParseUUIDPipe) templateId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
  ) {
    await this.templates.deleteItem(req.user, templateId, itemId);
  }
}
