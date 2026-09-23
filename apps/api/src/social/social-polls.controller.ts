import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { SOCIAL_ROUTE_PAIRS as P } from "./social-route-pairs.const";
import { SocialPollsService } from "./social-polls.service";
import { ListPollsQuery, VotePollBody } from "./social.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S16-SOCIAL-BE-2B-1 — `SOCIAL-API-040..044` (bình chọn). MỎNG: chỉ định tuyến.
 *
 * ⚠️ **THỨ TỰ KHAI: TĨNH TRƯỚC `{id}`** (API-19 §5.2) — `GET /social/polls` khai trước mọi mẫu
 * `posts/:post_id/poll/...`.
 *
 * ⚠️ **`ParseUUIDPipe` ở CẤP METHOD trên MỌI `@Param`.** Ratchet `param-uuid-ratchet.unit-spec.ts`
 * có `UNPIPED_CEILING = 1`, trần ĐÃ DÙNG HẾT, và assert là ĐẲNG THỨC — thiếu một pipe là đỏ ngay.
 *
 * 🔴 **Cặp quyền đọc TỪ `SOCIAL_ROUTE_PAIRS`, không literal** — census 2 tầng so CẢ decorator lẫn
 * service với CÙNG bảng hằng. Cả năm route gác `view:feed` ở tầng 1; vế phân quyền thật nằm ở tầng
 * 2: bài cha có thấy được không (`assertPostVisible`), và với `044` là chủ bài hoặc
 * `manage:feed-post`. Đọc decorator một mình sẽ kết luận sai là "gate lỏng".
 *
 * 🔴 **`044` là POST DUY NHẤT của WO** và nó có `@Idempotent()`. `041` là `PUT` (idempotent theo
 * bản chất: cùng payload ⇒ cùng trạng thái cuối), `042` là `DELETE` (đã idempotent).
 */
@Controller("social")
export class SocialPollsController {
  constructor(private readonly polls: SocialPollsService) {}

  /** 040 — GET /social/polls (TĨNH). */
  @Get("polls")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pollList.action, P.pollList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListPollsQuery) {
    return this.polls.list(req.user, {
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  /** 041 — PUT /social/posts/{post_id}/poll/vote. Bỏ/đổi phiếu. */
  @Put("posts/:post_id/poll/vote")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pollVote.action, P.pollVote.resourceType)
  @UsePipes(ZodValidationPipe)
  vote(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
    @Body() dto: VotePollBody,
  ) {
    return this.polls.vote(req.user, postId, dto.optionIds);
  }

  /** 042 — DELETE /social/posts/{post_id}/poll/vote. Rút phiếu (no-op nếu chưa bỏ). */
  @Delete("posts/:post_id/poll/vote")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pollVoteWithdraw.action, P.pollVoteWithdraw.resourceType)
  withdraw(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.polls.withdrawVote(req.user, postId);
  }

  /** 043 — GET /social/posts/{post_id}/poll/results. KHÔNG BAO GIỜ trả `user_id` (SOC-DEC-009). */
  @Get("posts/:post_id/poll/results")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pollResults.action, P.pollResults.resourceType)
  results(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.polls.results(req.user, postId);
  }

  /**
   * 044 — POST /social/posts/{post_id}/poll/close. Đóng tay; chủ bài HOẶC `manage:feed-post`.
   *
   * `@Idempotent()` với khoá **suy từ nội dung** (đường dẫn mang `post_id`): gửi lại vì mạng chập
   * không được sinh dòng audit / NOTI thứ hai. Khoá theo timestamp sẽ làm decorator vô dụng.
   *
   * ⚠️ **Decorator là NỬA CÓ ĐIỀU KIỆN, không phải lưới.** `IdempotencyInterceptor` (toàn cục,
   * `APP_INTERCEPTOR`) chỉ khoá khi client CÓ gửi header `Idempotency-Key`; thiếu header thì nó
   * `next.handle()` thẳng — back-compat có chủ ý, ghi rõ ở `idempotency.decorator.ts:12`. Lưới
   * KHÔNG-ĐIỀU-KIỆN của `044` vì vậy là `closeManualTx`: `WHERE status='open' … RETURNING` ⇒ lượt
   * thứ hai khớp 0 hàng ⇒ `close()` ném, không có dòng audit/NOTI thứ hai (ca `P-11`). Đừng đọc
   * decorator thành "đã có khoá server-side" — mà cũng đừng đọc thành "chỉ là `SetMetadata`".
   */
  @Post("posts/:post_id/poll/close")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pollClose.action, P.pollClose.resourceType)
  close(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.polls.close(req.user, postId);
  }
}
