import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { RECRUIT_ROUTE_PAIRS as P } from "./recruit-route-pairs.const";
import { RecruitCandidateFileUploadUrlDto } from "./recruit.dto";
import { RecruitCandidateFileService } from "./recruit-candidate-file.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S14-RECRUIT-FILEGRANT-1 — bề mặt tệp CV của module RECRUIT (RECRUIT-API-033..037, SPEC-12 §15).
 * MỎNG — chỉ định tuyến; luật ở `RecruitCandidateFileService` + `RecruitCandidateFileResolver`.
 *
 * Cặp `@RequirePermission` đọc TỪ `RECRUIT_ROUTE_PAIRS` (KHÔNG literal — census 2 tầng
 * `recruit-two-layer-guard-census.unit-spec.ts` so CẢ decorator lẫn service với CÙNG bảng hằng).
 * Tầng 2 assert lại trong service qua `RecruitAccessService.resolveActor`, nơi sàn scope Company và
 * cờ `isSensitive` được ép.
 *
 * ĐƯỜNG ĐỌC (033/034) gác bằng `view:candidate` — CÙNG cặp gác màn hồ sơ ứng viên
 * (`read-path-gate-pair-must-match-download-pair`). ĐƯỜNG GHI (035-037) gác bằng cặp MỚI
 * `upload:candidate-file` (seed 0569, is_sensitive=TRUE).
 *
 * ⚠️ `ParseUUIDPipe` trên CẢ `:id` lẫn `:fileId`: param rác đi thẳng tới cột uuid ⇒ `22P02` ⇒ **500**
 * vô danh (lớp KI-068/KI-077), không phải 400.
 *
 * Envelope do `ResponseEnvelopeInterceptor` TOÀN CỤC dựng — controller trả DATA THÔ.
 * Đường tải trả `{url, expiresAt}` (KHÔNG 302 redirect như HR) để FE mở tab đã chuẩn bị sẵn trong
 * cùng tick click — popup-blocker chặn `window.open` sau `await`.
 */
@Controller("candidates/:id/files")
export class RecruitCandidateFileController {
  constructor(private readonly svc: RecruitCandidateFileService) {}

  /** 033 — GET /candidates/:id/files. Mảng TRẦN, không phong bì phân trang. */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateFileList.action, P.candidateFileList.resourceType)
  list(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) candidateId: string) {
    return this.svc.list(req.user, candidateId);
  }

  /** 034 — GET /candidates/:id/files/:fileId/download-url (TTL ngắn; IDOR chặn ở service ⇒ 404). */
  @Get(":fileId/download-url")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateFileDownload.action, P.candidateFileDownload.resourceType)
  downloadUrl(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) candidateId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
  ) {
    return this.svc.getDownloadUrl(req.user, candidateId, fileId);
  }

  /** 035 — POST /candidates/:id/files/upload-url ⇒ 200 (đăng ký, chưa tạo tài nguyên con). */
  @Post("upload-url")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateFileUploadUrl.action, P.candidateFileUploadUrl.resourceType)
  @UsePipes(ZodValidationPipe)
  createUploadUrl(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) candidateId: string,
    @Body() dto: RecruitCandidateFileUploadUrlDto,
  ) {
    return this.svc.createUploadUrl(req.user, candidateId, dto);
  }

  /** 036 — POST /candidates/:id/files/:fileId/confirm ⇒ 200 (idempotent theo FileService). */
  @Post(":fileId/confirm")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateFileConfirm.action, P.candidateFileConfirm.resourceType)
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) candidateId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
  ) {
    return this.svc.confirmOwnUpload(req.user, candidateId, fileId);
  }

  /** 037 — POST /candidates/:id/files/:fileId/link ⇒ 201 (tạo `file_links`). */
  @Post(":fileId/link")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.candidateFileLink.action, P.candidateFileLink.resourceType)
  link(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) candidateId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
  ) {
    return this.svc.link(req.user, candidateId, fileId);
  }
}
