import {
  Body,
  Controller,
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
import { SOCIAL_ROUTE_PAIRS as P } from "./social-route-pairs.const";
import { SocialFilesService } from "./social-files.service";
import { SocialFileConfirmBody, SocialFileUploadUrlBody } from "./social.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S16-SOCIAL-BE-1C — `SOCIAL-API-054/055`: cửa own-scope đăng ký tệp đính kèm bài & bình luận.
 * MỎNG: chỉ định tuyến. Lý do đầy đủ + ba ranh giới không được nới: jsdoc `SocialFilesService`.
 *
 * ┌─ ⚠️ CẶP TẦNG-1 LÀ **SÀN**, KHÔNG PHẢI CẶP THẬT CẦN KIỂM (`tier1IsFloor: true`) ────────────────┐
 * │ `SocialFileResolver.canLinkFile` hỏi `create:feed-post` HOẶC `create:feed-comment` tuỳ đích, mà │
 * │ `@RequirePermission` chỉ khai được MỘT cặp tĩnh. Nên decorator giữ `view:feed` — cặp mà chính    │
 * │ `canLinkFile` cũng đòi (vế `readScope`) — và cặp `create` đúng theo `target` được hỏi ở TẦNG 2   │
 * │ (`SocialAccessService.assertFileTarget`, bảng `SOCIAL_FILE_TARGET_PAIRS`).                       │
 * │                                                                                                 │
 * │ 🔴 **ĐỪNG "siết" bằng cách đổi decorator thành `create:feed-post`.** Trông chặt hơn, thực chất   │
 * │ là chặn NHẦM: vai chỉ có `create:feed-comment` sẽ 403 ở cửa trong khi vẫn bình luận được bằng    │
 * │ chữ. Và đừng bỏ decorator đi cho "service tự gác": guard là **opt-in** ở dự án này (KHÔNG        │
 * │ `APP_GUARD`), quên một dòng là route MỞ cho mọi user đã đăng nhập, IM LẶNG.                      │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG nhận `postId`/`commentId`.** Tệp ở bước này chưa gắn vào nội dung nào — nội dung còn
 * CHƯA TỒN TẠI. Quyền trên nội dung đích được kiểm ở đúng một chỗ: lúc GẮN (`canLinkFile` +
 * `SocialAttachmentsService.assertLinkableFilesTx`, trong cùng transaction với INSERT). Thêm một vế
 * "bài này của bạn không" ở đây là dựng bản sao thứ hai của luật `SocialAccessService` — đúng thứ
 * module này sinh ra để không có.
 *
 * ⚠️ `ParseUUIDPipe` ở CẤP METHOD trên MỌI `@Param`: ratchet `param-uuid-ratchet.unit-spec.ts` có
 * `UNPIPED_CEILING = 1` **đã dùng hết**, và assert là ĐẲNG THỨC — thiếu một pipe là đỏ ngay.
 *
 * ⚠️ Controller này PHẢI có mặt trong hằng `SOCIAL_CONTROLLERS` của
 * `social-two-layer-guard-census.unit-spec.ts` — nếu không, census 2 tầng lặng lẽ bỏ qua cả hai route.
 */
@Controller("social/files")
@UsePipes(ZodValidationPipe)
export class SocialFilesController {
  constructor(private readonly svc: SocialFilesService) {}

  /**
   * `054` — POST /api/v1/social/files/upload-url → `{fileId, uploadStatus, uploadUrl, expiresAt}`.
   * Client PUT bytes thẳng lên storage rồi gọi `/{id}/confirm`.
   *
   * `@HttpCode(200)`: đây là bước cấp URL, không phải tạo tài nguyên nghiệp vụ mà client giữ tham
   * chiếu lâu dài — mirror `POST /chat/files/upload-url` và `POST /me/avatar/upload-url`.
   */
  @Post("upload-url")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission(P.fileUploadUrl.action, P.fileUploadUrl.resourceType)
  createUploadUrl(@Req() req: AuthenticatedRequest, @Body() body: SocialFileUploadUrlBody) {
    return this.svc.createUploadUrl(req.user, body);
  }

  /**
   * `055` — POST /api/v1/social/files/{id}/confirm: xác nhận bytes đã lên (`Pending → Uploaded`).
   *
   * Body mang `target` (KHÁC CHAT, nơi body rỗng `{}`) vì cửa này gác theo `target` — xem
   * `socialFileConfirmInputSchema`. Owner-check chạy TRƯỚC khi chạm storage; 200 idempotent khi tệp
   * đã `Uploaded`.
   */
  @Post(":id/confirm")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission(P.fileConfirm.action, P.fileConfirm.resourceType)
  confirmUpload(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SocialFileConfirmBody,
  ) {
    return this.svc.confirmOwnUpload(req.user, id, body.target);
  }
}
