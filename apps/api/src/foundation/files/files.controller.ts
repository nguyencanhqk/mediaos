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
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import {
  linkFileInputSchema,
  listFilesQuerySchema,
  uploadFileInputSchema,
  type LinkFileInput,
  type ListFilesQuery,
  type UploadFileInput,
} from "@mediaos/contracts";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { FileService } from "./files.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S1-FND-FILE-1 — HTTP surface cho file subsystem (BACKEND-04 §9.6). Global JwtAuthGuard + CompanyGuard
 * (auth + tenant) đã đăng ký app-wide; class-level PermissionGuard fail-closed (mọi route phải có
 * @RequirePermission). Resource = 'foundation-file' (seed mig 0435): upload/view/download/link/unlink/
 * delete. FilePolicyService (trong FileService) là CHỐT quyết định view/download/link/unlink/delete —
 * controller KHÔNG tự phán quyền (chỉ ép gate cấp permission qua guard).
 *
 * Envelope {success,message,data} thống nhất; meta cho list (total/page/limit).
 */
@Controller("files")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class FilesController {
  constructor(private readonly files: FileService) {}

  /** POST /files — đăng ký metadata upload (Private/Pending). Gate upload:foundation-file. */
  @Post()
  @RequirePermission("upload", "foundation-file")
  async upload(@Req() req: AuthenticatedRequest, @Body() body: UploadFileInput) {
    const input = uploadFileInputSchema.parse(body);
    const data = await this.files.upload(req.user, input);
    return { success: true, message: "Đã đăng ký file", data };
  }

  /** GET /files — liệt kê metadata file của tenant (pagination). Gate view:foundation-file. */
  @Get()
  @RequirePermission("view", "foundation-file")
  async list(@Req() req: AuthenticatedRequest, @Query() query: ListFilesQuery) {
    const parsed = listFilesQuerySchema.parse(query);
    const { data, meta } = await this.files.list(req.user, parsed);
    return { success: true, message: "OK", data, meta };
  }

  /** GET /files/:id — metadata 1 file (FilePolicy.canView là chốt). Gate view:foundation-file. */
  @Get(":id")
  @RequirePermission("view", "foundation-file")
  async getOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const data = await this.files.getMetadata(req.user, id);
    return { success: true, message: "OK", data };
  }

  /**
   * GET /files/:id/download — URL tải TTL-ngắn (FilePolicy.canDownload là chốt; deny → 403 + log).
   * Gate download:foundation-file.
   */
  @Get(":id/download")
  @RequirePermission("download", "foundation-file")
  async download(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const data = await this.files.getDownloadUrl(req.user, id);
    return { success: true, message: "OK", data };
  }

  /** POST /files/:id/link — gắn file vào entity (FilePolicy.canLink là chốt). Gate link:foundation-file. */
  @Post(":id/link")
  @RequirePermission("link", "foundation-file")
  async link(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: LinkFileInput,
  ) {
    // fileId trong body PHẢI khớp :id route (chống nhầm/lừa fileId khác). Ép từ route.
    const input = linkFileInputSchema.parse({ ...body, fileId: id });
    const data = await this.files.link(req.user, input);
    return { success: true, message: "Đã liên kết file", data };
  }

  /**
   * DELETE /files/links/:linkId — gỡ link (soft-delete, FilePolicy.canUnlink là chốt). Gate
   * unlink:foundation-file. 204 No Content. (Khai báo TRƯỚC DELETE /:id — khác độ sâu path, không đụng.)
   */
  @Delete("links/:linkId")
  @HttpCode(204)
  @RequirePermission("unlink", "foundation-file")
  async unlink(@Req() req: AuthenticatedRequest, @Param("linkId") linkId: string) {
    await this.files.unlink(req.user, linkId);
  }

  /** DELETE /files/:id — soft-delete file (FilePolicy.canDelete là chốt). Gate delete:foundation-file. 204. */
  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("delete", "foundation-file")
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    await this.files.deleteFile(req.user, id);
  }
}
