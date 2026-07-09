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
import { linkEmployeeFileSchema, listEmployeeFilesQuerySchema } from "@mediaos/contracts";
import { EmployeeFileService } from "./employee-file.service";

class ListEmployeeFilesQueryDto extends createZodDto(listEmployeeFilesQuerySchema) {}
class LinkEmployeeFileDto extends createZodDto(linkEmployeeFileSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-HR-EMPFILE-1 — Employee File (hồ sơ đính kèm nhân viên) surface. API-03 HR-API-801..805 under
 * /hr/employees/:id/files. Class-level PermissionGuard fail-closed (mọi route @RequirePermission).
 * Permission pairs (seed mig 0477, hr/company-admin → Company): POST=('file-upload','employee') ·
 * GET*=('file-view','employee') · DELETE=('file-delete','employee'). Manager/Employee KHÔNG có grant ⇒ 403.
 *
 * Envelope do ResponseEnvelopeInterceptor TOÀN CỤC dựng — controller trả DATA THÔ (KHÔNG double-wrap).
 * Download dùng @Res library-mode ⇒ 302 redirect (KHÔNG qua envelope), KHÔNG lộ storage_path (chỉ signed-url).
 */
@Controller("hr/employees/:id/files")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class EmployeeFileController {
  constructor(private readonly svc: EmployeeFileService) {}

  /** GET /hr/employees/:id/files — HR-API-802: list documents of a profile. Gate file-view:employee. */
  @Get()
  @RequirePermission("file-view", "employee")
  list(
    @Req() req: AuthenticatedRequest,
    @Param("id") employeeId: string,
    @Query() query: ListEmployeeFilesQueryDto,
  ) {
    return this.svc.list(req.user, employeeId, query);
  }

  /** GET /hr/employees/:id/files/:fileId — HR-API-803: metadata of one document. Gate file-view:employee. */
  @Get(":fileId")
  @RequirePermission("file-view", "employee")
  getOne(
    @Req() req: AuthenticatedRequest,
    @Param("id") employeeId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.svc.getMetadata(req.user, employeeId, fileId);
  }

  /**
   * GET /hr/employees/:id/files/:fileId/download — HR-API-804: 302 redirect to a short-lived signed URL.
   * Scan-guard STRICT (Clean/NotRequired only, else 409) inside the service. Gate file-view:employee.
   */
  @Get(":fileId/download")
  @RequirePermission("file-view", "employee")
  async download(
    @Req() req: AuthenticatedRequest,
    @Param("id") employeeId: string,
    @Param("fileId") fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { url } = await this.svc.getDownloadUrl(req.user, employeeId, fileId);
    res.redirect(302, url);
  }

  /** POST /hr/employees/:id/files — HR-API-801: link an uploaded+confirmed file. Gate file-upload:employee. */
  @Post()
  @RequirePermission("file-upload", "employee")
  link(
    @Req() req: AuthenticatedRequest,
    @Param("id") employeeId: string,
    @Body() dto: LinkEmployeeFileDto,
  ) {
    return this.svc.link(req.user, employeeId, dto.fileId, dto.category);
  }

  /** DELETE /hr/employees/:id/files/:fileId — HR-API-805: soft-delete a document. Gate file-delete:employee. */
  @Delete(":fileId")
  @HttpCode(204)
  @RequirePermission("file-delete", "employee")
  remove(
    @Req() req: AuthenticatedRequest,
    @Param("id") employeeId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.svc.delete(req.user, employeeId, fileId);
  }
}
