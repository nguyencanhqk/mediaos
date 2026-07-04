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
import type { Request, Response } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import {
  confirmUploadInputSchema,
  linkFileInputSchema,
  listFilesQuerySchema,
  uploadFileInputSchema,
  type ConfirmUploadInput,
  type LinkFileInput,
  type ListFilesQuery,
  type UploadFileInput,
} from "@mediaos/contracts";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { paginated, toPagination } from "../../common/pagination";
import { FileService } from "./files.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S1-FND-FILE-1 + S1-FND-WIRE-DRIFT-1 — HTTP surface cho file subsystem (BACKEND-04 §9.6, route khớp
 * API-09 §137-139). Global JwtAuthGuard + CompanyGuard (auth + tenant); class-level PermissionGuard
 * fail-closed (mọi route @RequirePermission). Resource = 'foundation-file' (seed mig 0435).
 *
 * Envelope do ResponseEnvelopeInterceptor TOÀN CỤC dựng — controller TRẢ DATA THÔ (KHÔNG tự bọc
 * {success,message,data} nữa, tránh double-wrap). List trả `paginated(...)` → pagination thành block đỉnh.
 * Route chuẩn spec: POST /foundation/files/upload · GET /foundation/files · GET /:id · GET /:id/download-url
 * · GET /:id/download (302 → URL) · POST /:id/links · DELETE /:id/links/:link_id · DELETE /:id.
 */
@Controller("foundation/files")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class FilesController {
  constructor(private readonly files: FileService) {}

  /**
   * POST /foundation/files/upload — REGISTER (pha 1): đăng ký metadata (Private/Pending) + trả presigned-PUT
   * {fileId, uploadStatus:'Pending', uploadUrl, expiresAt} để client PUT bytes trực tiếp. Gate upload:foundation-file.
   */
  @Post("upload")
  @RequirePermission("upload", "foundation-file")
  upload(@Req() req: AuthenticatedRequest, @Body() body: UploadFileInput) {
    const input = uploadFileInputSchema.parse(body);
    return this.files.upload(req.user, input);
  }

  /**
   * POST /foundation/files/:id/confirm — CONFIRM (pha 3): sau khi client PUT bytes, verify object tồn tại +
   * size khớp + tính checksum server-side → upload_status='Uploaded'. Sai size/absent → 'Failed' + 409/422.
   * Gate upload:foundation-file. Body rỗng hợp lệ (fileId lấy từ route). 200 (idempotent nếu đã Uploaded).
   */
  @Post(":id/confirm")
  @HttpCode(200)
  @RequirePermission("upload", "foundation-file")
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: ConfirmUploadInput,
  ) {
    const input = confirmUploadInputSchema.parse(body ?? {});
    return this.files.confirmUpload(req.user, id, input);
  }

  /** GET /foundation/files — liệt kê metadata file của tenant (pagination block). Gate view:foundation-file. */
  @Get()
  @RequirePermission("view", "foundation-file")
  async list(@Req() req: AuthenticatedRequest, @Query() query: ListFilesQuery) {
    const parsed = listFilesQuerySchema.parse(query);
    const { data, meta } = await this.files.list(req.user, parsed);
    return paginated(data, toPagination(meta.total, meta.page, meta.limit));
  }

  /** GET /foundation/files/:id — metadata 1 file (FilePolicy.canView là chốt). Gate view:foundation-file. */
  @Get(":id")
  @RequirePermission("view", "foundation-file")
  getOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.files.getMetadata(req.user, id);
  }

  /**
   * GET /foundation/files/:id/download-url — URL tải TTL-ngắn (FilePolicy.canDownload là chốt; deny → 403 +
   * log). Trả {url, expiresAt}. Gate download:foundation-file.
   */
  @Get(":id/download-url")
  @RequirePermission("download", "foundation-file")
  downloadUrl(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.files.getDownloadUrl(req.user, id);
  }

  /**
   * GET /foundation/files/:id/download — tải trực tiếp: 302 redirect tới URL TTL-ngắn (FilePolicy.canDownload
   * là chốt). @Res library-mode ⇒ KHÔNG qua envelope interceptor (redirect là response thật). Gate
   * download:foundation-file. KHÔNG lộ storage_path (chỉ signed-url ngắn hạn).
   */
  @Get(":id/download")
  @RequirePermission("download", "foundation-file")
  async download(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { url } = await this.files.getDownloadUrl(req.user, id);
    res.redirect(302, url);
  }

  /** POST /foundation/files/:id/links — gắn file vào entity (FilePolicy.canLink là chốt). Gate link:foundation-file. */
  @Post(":id/links")
  @RequirePermission("link", "foundation-file")
  link(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: LinkFileInput) {
    // fileId trong body PHẢI khớp :id route (chống nhầm/lừa fileId khác). Ép từ route.
    const input = linkFileInputSchema.parse({ ...body, fileId: id });
    return this.files.link(req.user, input);
  }

  /**
   * DELETE /foundation/files/:id/links/:link_id — gỡ link (soft-delete, FilePolicy.canUnlink là chốt). Gate
   * unlink:foundation-file. 204 No Content. :id (file) khoanh phạm vi; service kiểm link thuộc cùng tenant.
   */
  @Delete(":id/links/:linkId")
  @HttpCode(204)
  @RequirePermission("unlink", "foundation-file")
  async unlink(@Req() req: AuthenticatedRequest, @Param("linkId") linkId: string) {
    await this.files.unlink(req.user, linkId);
  }

  /** DELETE /foundation/files/:id — soft-delete file (FilePolicy.canDelete là chốt). Gate delete:foundation-file. 204. */
  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("delete", "foundation-file")
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    await this.files.deleteFile(req.user, id);
  }
}
