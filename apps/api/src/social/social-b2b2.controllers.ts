import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { SocialIdeasService } from "./social-ideas.service";
import { SocialKudosService } from "./social-kudos.service";
import { SOCIAL_ROUTE_PAIRS as P } from "./social-route-pairs.const";
import {
  ListIdeasQuery,
  ListKudosBadgesQuery,
  ListKudosQuery,
  ReviewFeedIdeaBody,
} from "./social.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S16-SOCIAL-BE-2B-2 — `SOCIAL-API-045..046` (SÁNG KIẾN). MỎNG: chỉ định tuyến.
 *
 * ⚠️ **THỨ TỰ KHAI: TĨNH TRƯỚC `{id}`** (API-19 §5.2) — `GET /social/ideas` khai trước mẫu
 * `posts/:post_id/idea/review`.
 *
 * ⚠️ **`ParseUUIDPipe` ở CẤP METHOD trên MỌI `@Param`.** Ratchet `param-uuid-ratchet.unit-spec.ts` có
 * `UNPIPED_CEILING = 1`, trần ĐÃ DÙNG HẾT, và assert là ĐẲNG THỨC — thiếu một pipe là đỏ ngay.
 *
 * 🔴 **`046` là route DUY NHẤT của module gác bằng một cặp `approve:*`** — decorator ĐÚNG là cặp thật
 * cần kiểm (nên `tier1IsFloor = false`). Tầng 2 hỏi LẠI chính cặp đó, không phải một cặp khác: guard
 * chỉ ném `Permission denied: <reason>` nên `SOCIAL-ERR-020` bắt buộc phải phát từ service
 * (`assertApproveIdea`). Đừng hạ decorator xuống `view:feed` để "cho service tự gác" — làm thế là tháo
 * tầng-1 của đường DUYỆT.
 *
 * ⚠️ WO này KHÔNG có POST mới ⇒ KHÔNG `@Idempotent()` nào. `046` là `PATCH` và lưới không-điều-kiện
 * của nó ở tầng dữ liệu: `UPDATE … WHERE status = <from>` (lượt hai khớp 0 hàng ⇒ 409, không sinh
 * audit/NOTI thứ hai) — cùng khuôn `044` (API-19 §6.6).
 */
@Controller("social")
export class SocialIdeasController {
  constructor(private readonly ideas: SocialIdeasService) {}

  /** 045 — GET /social/ideas (TĨNH). */
  @Get("ideas")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.ideaList.action, P.ideaList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListIdeasQuery) {
    return this.ideas.list(req.user, {
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  /** 046 — PATCH /social/posts/{post_id}/idea/review. FSM 3 cạnh + audit + NOTI-032. */
  @Patch("posts/:post_id/idea/review")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.ideaReview.action, P.ideaReview.resourceType)
  @UsePipes(ZodValidationPipe)
  review(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
    @Body() dto: ReviewFeedIdeaBody,
  ) {
    return this.ideas.review(req.user, postId, dto);
  }
}

/**
 * S16-SOCIAL-BE-2B-2 — `SOCIAL-API-047..048` (VINH DANH · CATALOG HUY HIỆU). MỎNG.
 *
 * Hai route ĐỌC, cả hai `view:feed`. `047` thừa hưởng phạm vi BÀI CHA trong SQL; `048` là catalog cấp
 * công ty (không JOIN bài).
 *
 * ⚠️ Controller RIÊNG (không gộp vào `SocialIdeasController`) vì `SOCIAL_CONTROLLERS` của census 2 tầng
 * là **DANH SÁCH TRẮNG**: tên không có ở đó ⇒ route VÔ HÌNH với cả bốn assert. Hai cụm nghiệp vụ = hai
 * tên, để một lượt gộp "cho gọn" không lặng lẽ xoá bốn route khỏi phép đo.
 */
@Controller("social")
export class SocialKudosController {
  constructor(private readonly kudos: SocialKudosService) {}

  /** 047 — GET /social/kudos. Lọc `month` (`YYYY-MM`, biên theo múi giờ CÔNG TY). */
  @Get("kudos")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.kudosList.action, P.kudosList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListKudosQuery) {
    return this.kudos.list(req.user, {
      month: query.month,
      page: query.page,
      limit: query.limit,
    });
  }

  /** 048 — GET /social/kudos-badges. Chỉ huy hiệu `is_active = true`. */
  @Get("kudos-badges")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.kudosBadgeList.action, P.kudosBadgeList.resourceType)
  @UsePipes(ZodValidationPipe)
  listBadges(@Req() req: AuthenticatedRequest, @Query() query: ListKudosBadgesQuery) {
    return this.kudos.listBadges(req.user, { page: query.page, limit: query.limit });
  }
}
