import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import type { Request, Response } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { linkTaskFileSchema, listTaskFilesQuerySchema } from "@mediaos/contracts";
import { TaskFileService } from "./task-file.service";

class ListTaskFilesQueryDto extends createZodDto(listTaskFilesQuerySchema) {}
class LinkTaskFileDto extends createZodDto(linkTaskFileSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S4-TASK-BE-5 — Task File (đính kèm công việc) surface under /tasks/:taskId/files. TÁI DÙNG NGUYÊN pattern
 * S2-HR-EMPFILE-1 — KHÔNG bảng task_files riêng (Foundation FileService + polymorphic file_links). Class-level
 * PermissionGuard fail-closed; EVERY route @RequirePermission OPT-IN tường minh (thiếu = route MỞ). Permission
 * pairs (seed mig 0485): POST=('file-upload','task') · GET*=('read','task') · DELETE=('file-delete','task').
 * Không có cặp file-view:task — xem/tải attachment tái dùng read:task (cùng cổng với task).
 *
 * Envelope do ResponseEnvelopeInterceptor TOÀN CỤC dựng — controller trả DATA THÔ (KHÔNG double-wrap).
 * Download dùng @Res library-mode ⇒ 302 redirect (KHÔNG qua envelope), KHÔNG lộ storage_path (chỉ signed-url).
 */
@Controller("tasks/:taskId/files")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class TaskFilesController {
  constructor(private readonly svc: TaskFileService) {}

  /** GET /tasks/:taskId/files — list attachments of a task. Gate read:task. */
  @Get()
  @RequirePermission("read", "task")
  list(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Query() query: ListTaskFilesQueryDto,
  ) {
    return this.svc.list(req.user, taskId, query);
  }

  /** GET /tasks/:taskId/files/:fileId — metadata of one attachment. Gate read:task. */
  @Get(":fileId")
  @RequirePermission("read", "task")
  getOne(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.svc.getMetadata(req.user, taskId, fileId);
  }

  /**
   * GET /tasks/:taskId/files/:fileId/download — 302 redirect to a short-lived signed URL. Scan-guard STRICT
   * (Clean/NotRequired only, else 409) inside the service. Gate read:task.
   */
  @Get(":fileId/download")
  @RequirePermission("read", "task")
  async download(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("fileId") fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { url } = await this.svc.getDownloadUrl(req.user, taskId, fileId);
    res.redirect(302, url);
  }

  /** POST /tasks/:taskId/files — link an uploaded+confirmed file. Gate file-upload:task. */
  @Post()
  @RequirePermission("file-upload", "task")
  linkFile(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: LinkTaskFileDto,
  ) {
    return this.svc.link(req.user, taskId, dto.fileId, dto.category);
  }

  // ── S5-TASK-COVER-1: ảnh bìa ────────────────────────────────────────────────────────────────
  //
  // ⚠️ THỨ TỰ KHAI BÁO Ở ĐÂY LÀ MỘT RÀNG BUỘC, KHÔNG PHẢI SỞ THÍCH.
  // Nest khớp route theo THỨ TỰ KHAI BÁO. `@Delete("cover")` PHẢI đứng TRƯỚC `@Delete(":fileId")`
  // bên dưới — nếu không, `DELETE .../files/cover` sẽ rơi vào `remove()` với `fileId = "cover"`,
  // đi tiếp tới `loadLinkedFileOr404("cover")` và chết ở tầng uuid, cho ra lỗi trông như "chưa
  // implement" thay vì "route bị che". Có int-spec khoá riêng tính chất này.
  //
  // Cũng vì controller prefix là `tasks/:taskId/files` nên đường dẫn là `/files/cover`, KHÔNG phải
  // `/tasks/:taskId/cover` như Work Order mô tả — mọi route ở đây bắt buộc mang tiền tố `/files`.

  /** POST /tasks/:taskId/files/:fileId/cover — đặt tệp ĐÃ đính kèm làm ảnh bìa. Gate file-upload:task. */
  @Post(":fileId/cover")
  @RequirePermission("file-upload", "task")
  setCover(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.svc.setCover(req.user, taskId, fileId);
  }

  /**
   * DELETE /tasks/:taskId/files/cover — gỡ ảnh bìa (idempotent). Gate file-upload:task — CÙNG cặp với
   * đặt bìa, KHÔNG phải `file-delete:task`: thao tác này không xoá tệp nào, chỉ tắt một cờ hiển thị.
   * Bắt nó đòi quyền xoá tệp sẽ nghiêm hơn mức cần và lệch với đường đặt bìa.
   */
  @Delete("cover")
  @HttpCode(204)
  @RequirePermission("file-upload", "task")
  clearCover(@Req() req: AuthenticatedRequest, @Param("taskId") taskId: string) {
    return this.svc.clearCover(req.user, taskId);
  }

  /** DELETE /tasks/:taskId/files/:fileId — soft-delete an attachment. Gate file-delete:task. */
  @Delete(":fileId")
  @HttpCode(204)
  @RequirePermission("file-delete", "task")
  remove(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.svc.delete(req.user, taskId, fileId);
  }
}
