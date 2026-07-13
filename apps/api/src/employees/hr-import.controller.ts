import {
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { hrEmployeeImportQuerySchema, type HrEmployeeImportQuery } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { HrEmployeeImportService, MAX_IMPORT_BYTES } from "./hr-employee-import.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-HR-IMPORT-BE-1 — bulk employee import (API-03 / SPEC-03 §7). Sits under `@Controller("hr")` alongside
 * the other HR controllers. Both routes are gated by PermissionGuard with the SEEDED sensitive pair
 * import:employee (mig 0496 flipped is_sensitive → true + granted hr/company-admin at Company scope): a
 * missing pair is rejected with 403 BEFORE the handler → a denied caller writes NOTHING (no parse, no
 * insert, no audit). FileInterceptor limits SIZE (~5MB); the service re-checks size + validates MIME/
 * extension + parses content explicitly, so a bad file returns 400 (never a raw 500).
 */
@Controller("hr")
@UseGuards(PermissionGuard)
export class HrImportController {
  constructor(private readonly importService: HrEmployeeImportService) {}

  @Post("employees/import")
  @RequirePermission("import", "employee", { isSensitive: true })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_BYTES } }))
  importEmployees(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query(new ZodValidationPipe(hrEmployeeImportQuerySchema)) query: HrEmployeeImportQuery,
  ) {
    return this.importService.import(req.user, file, query.dryRun);
  }

  @Get("employees/import/template")
  @RequirePermission("import", "employee", { isSensitive: true })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="employee-import-template.csv"')
  importTemplate(): string {
    return this.importService.getTemplateCsv();
  }
}
