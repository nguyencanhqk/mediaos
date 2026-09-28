import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import {
  feedRecycleBinQuerySchema,
  type FeedPostRestoreResultDto,
  type FeedRecycleBinPageDto,
  type FeedRecycleBinQueryDto,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
// CỐ Ý import HẰNG (không DI) của SOCIAL — khuôn `ORG_EMPLOYEE_DIRECTORY` ở `recycle-bin.service.ts`: cặp quyền
// của route sống ở CÙNG bảng mà tầng 2 (`SocialRecycleBinService` → `resolveActor`) và census 2 tầng đọc.
// Gõ literal ở đây là đẻ nguồn sự thật thứ hai cho cặp của route.
import { SOCIAL_ROUTE_PAIRS as P } from "../social/social-route-pairs.const";
import { RecycleBinRegistry } from "./recycle-bin.registry";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S16-SOCIAL-BE-3C — `SOCIAL-API-057..058` (thùng rác bài viết, owner ký O3: route sống ở recycle-bin). MỎNG:
 * chỉ định tuyến qua `RecycleBinRegistry` tới handler `feed_post` do `SocialModule` đăng ký.
 *
 * ⚠️ Lớp RIÊNG, không thêm method vào `RecycleBinController` (D7): file employee 0 diff, và census 2 tầng SOCIAL
 * lọc route theo TÊN LỚP (`SOCIAL_CONTROLLERS`) — gộp chung sẽ kéo 2 route employee vào phép đo SOCIAL.
 * 🔴 Tên lớp này PHẢI có trong `SOCIAL_CONTROLLERS` của `social-two-layer-guard-census.unit-spec.ts` (allowlist:
 * quên thêm ⇒ 2 route vô hình với census mà mọi assert vẫn XANH).
 *
 * Tham số `:post_id` THỐNG NHẤT với mọi route SOCIAL (census `ROUTE_TO_KEY` · route census JSON · API-19).
 * `058` KHÔNG `@Idempotent`: lượt thứ hai trả 404 (bài không còn trong thùng rác) — không có gì để replay.
 */
@Controller("recycle-bin/feed-posts")
@UseGuards(PermissionGuard)
export class RecycleBinFeedPostsController {
  constructor(private readonly registry: RecycleBinRegistry) {}

  /** 057 — GET /recycle-bin/feed-posts (OFFSET; che tác giả/nội dung theo vị từ audience; KHÔNG audit). */
  @Get()
  @RequirePermission(P.recycleFeedPostList.action, P.recycleFeedPostList.resourceType)
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(feedRecycleBinQuerySchema)) query: FeedRecycleBinQueryDto,
  ): Promise<FeedRecycleBinPageDto> {
    return this.registry.get("feed_post").list(req.user, query);
  }

  /** 058 — POST /recycle-bin/feed-posts/:post_id/restore (khôi phục theo luật D4; audit LUÔN, cùng tx). */
  @Post(":post_id/restore")
  @HttpCode(200)
  @RequirePermission(P.recycleFeedPostRestore.action, P.recycleFeedPostRestore.resourceType)
  restore(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
  ): Promise<FeedPostRestoreResultDto> {
    return this.registry.get("feed_post").restore(req.user, postId);
  }
}
