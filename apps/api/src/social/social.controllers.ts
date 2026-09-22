import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  CreateFeedCommentBody,
  CreateFeedPostBody,
  ListCommentsQuery,
  ListFeedQuery,
  ListSavedQuery,
  ModerateFeedPostBody,
  PutFeedReactionBody,
  UpdateFeedCommentBody,
  UpdateFeedPostBody,
} from "./social.dto";
import { SocialCommentsService } from "./social-comments.service";
import { SocialPostsModerationService } from "./social-posts-moderation.service";
import { SocialPostsService } from "./social-posts.service";
import { SocialReactionsService } from "./social-reactions.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S16-SOCIAL-BE-1 — 3 controller SOCIAL (`SOCIAL-API-001..019`). MỎNG — chỉ định tuyến.
 *
 * Cặp `@RequirePermission` đọc TỪ `SOCIAL_ROUTE_PAIRS` (KHÔNG literal — census 2 tầng so CẢ decorator
 * lẫn service với CÙNG bảng hằng). Tầng 2 assert lại trong service qua `SocialAccessService
 * .resolveActor`.
 *
 * ⚠️ **THỨ TỰ KHAI: TĨNH TRƯỚC `{id}`** (API-19 §5.2, bài học `goals/tree`) — `saved` · `feed` khai
 * TRƯỚC mọi route `posts/:post_id`.
 *
 * ⚠️ **`ParseUUIDPipe` ở CẤP METHOD trên MỌI param**, không `@UsePipes` cấp class: ratchet
 * `param-uuid-ratchet.unit-spec.ts` có `UNPIPED_CEILING=1` và trần đó ĐÃ DÙNG HẾT — thiếu một pipe
 * là ĐỎ ngay.
 */
@Controller("social")
export class SocialPostsController {
  constructor(
    private readonly posts: SocialPostsService,
    private readonly moderation: SocialPostsModerationService,
  ) {}

  /** 010 — GET /social/saved (TĨNH, khai TRƯỚC `posts/:post_id`). */
  @Get("saved")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.savedList.action, P.savedList.resourceType)
  @UsePipes(ZodValidationPipe)
  listSaved(@Req() req: AuthenticatedRequest, @Query() query: ListSavedQuery) {
    return this.posts.listSaved(req.user, query);
  }

  /** 001 — GET /social/feed (TĨNH). `status` khác `published` đòi `manage:feed-post` (tầng 2). */
  @Get("feed")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.feedList.action, P.feedList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListFeedQuery) {
    return this.posts.list(req.user, query);
  }

  /**
   * 002 — POST /social/posts (@Idempotent — FE sinh key khi mở composer).
   *
   * ⚠️ Cặp decorator `create:feed-post` là **SÀN** (`tier1IsFloor:true`): nhánh `type='news'` còn đòi
   * `manage:feed-news` ở tầng 2 (`SocialPostsService.create`). Đọc decorator một mình sẽ hiểu sai.
   */
  @Post("posts")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postCreate.action, P.postCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateFeedPostBody) {
    return this.posts.create(req.user, dto);
  }

  /** 003 — GET /social/posts/:post_id. */
  @Get("posts/:post_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postDetail.action, P.postDetail.resourceType)
  getOne(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.posts.get(req.user, postId);
  }

  /** 004 — PATCH /social/posts/:post_id (chủ bài HOẶC `manage:feed-post` — tầng 2). */
  @Patch("posts/:post_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postUpdate.action, P.postUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
    @Body() dto: UpdateFeedPostBody,
  ) {
    return this.posts.update(req.user, postId, dto);
  }

  /** 005 — DELETE /social/posts/:post_id (xoá MỀM). */
  @Delete("posts/:post_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postDelete.action, P.postDelete.resourceType)
  remove(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.posts.remove(req.user, postId);
  }

  /**
   * 006 — PATCH /social/posts/:post_id/moderation.
   *
   * ⚠️ Cặp decorator `manage:feed-post` là **SÀN** (`tier1IsFloor:true`): `pinned` đòi
   * `manage:feed-news` ở tầng 2, per-field (API-19 §5.1c).
   */
  @Patch("posts/:post_id/moderation")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postModerate.action, P.postModerate.resourceType)
  @UsePipes(ZodValidationPipe)
  moderate(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
    @Body() dto: ModerateFeedPostBody,
  ) {
    return this.moderation.moderate(req.user, postId, dto);
  }

  /**
   * 007 — POST /social/posts/:post_id/view.
   *
   * KHÔNG `@Idempotent()` dù là POST: PK tổ hợp `(company_id, post_id, user_id)` +
   * `ON CONFLICT DO NOTHING` làm route này idempotent Ở TẦNG DB — gọi lại không tạo hàng trùng và
   * không tăng `view_count`. Khác `002`/`015`, vốn tạo hàng MỚI mỗi lần và không có khoá tự nhiên.
   */
  @Post("posts/:post_id/view")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postView.action, P.postView.resourceType)
  recordView(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.posts.recordView(req.user, postId);
  }

  /** 008 — POST /social/posts/:post_id/save (idempotent ở tầng DB — xem ghi chú ở `007`). */
  @Post("posts/:post_id/save")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postSave.action, P.postSave.resourceType)
  save(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.posts.save(req.user, postId);
  }

  /** 009 — DELETE /social/posts/:post_id/save. */
  @Delete("posts/:post_id/save")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postUnsave.action, P.postUnsave.resourceType)
  unsave(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.posts.unsave(req.user, postId);
  }
}

/** `SOCIAL-API-011..013` (bài) + `018..019` (bình luận) — cùng một bảng `feed_reactions` ĐA HÌNH. */
@Controller("social")
export class SocialReactionsController {
  constructor(private readonly reactions: SocialReactionsService) {}

  /** 011 — PUT /social/posts/:post_id/reaction (idempotent theo bản chất: đặt trạng thái). */
  @Put("posts/:post_id/reaction")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postReactionPut.action, P.postReactionPut.resourceType)
  @UsePipes(ZodValidationPipe)
  putPostReaction(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
    @Body() dto: PutFeedReactionBody,
  ) {
    return this.reactions.putOnPost(req.user, postId, dto.emoji);
  }

  /** 012 — DELETE /social/posts/:post_id/reaction. */
  @Delete("posts/:post_id/reaction")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postReactionDelete.action, P.postReactionDelete.resourceType)
  deletePostReaction(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
  ) {
    return this.reactions.removeOnPost(req.user, postId);
  }

  /** 013 — GET /social/posts/:post_id/reactions. */
  @Get("posts/:post_id/reactions")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postReactionList.action, P.postReactionList.resourceType)
  listReactors(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.reactions.listReactors(req.user, postId);
  }

  /** 018 — PUT /social/comments/:comment_id/reaction. */
  @Put("comments/:comment_id/reaction")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.commentReactionPut.action, P.commentReactionPut.resourceType)
  @UsePipes(ZodValidationPipe)
  putCommentReaction(
    @Req() req: AuthenticatedRequest,
    @Param("comment_id", ParseUUIDPipe) commentId: string,
    @Body() dto: PutFeedReactionBody,
  ) {
    return this.reactions.putOnComment(req.user, commentId, dto.emoji);
  }

  /** 019 — DELETE /social/comments/:comment_id/reaction. */
  @Delete("comments/:comment_id/reaction")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.commentReactionDelete.action, P.commentReactionDelete.resourceType)
  deleteCommentReaction(
    @Req() req: AuthenticatedRequest,
    @Param("comment_id", ParseUUIDPipe) commentId: string,
  ) {
    return this.reactions.removeOnComment(req.user, commentId);
  }
}

/** `SOCIAL-API-014..017` — bình luận 1 cấp. */
@Controller("social")
export class SocialCommentsController {
  constructor(private readonly comments: SocialCommentsService) {}

  /** 014 — GET /social/posts/:post_id/comments. */
  @Get("posts/:post_id/comments")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.commentList.action, P.commentList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
    @Query() query: ListCommentsQuery,
  ) {
    return this.comments.list(req.user, postId, query);
  }

  /** 015 — POST /social/posts/:post_id/comments (@Idempotent — FE sinh key khi mở ô soạn). */
  @Post("posts/:post_id/comments")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.commentCreate.action, P.commentCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  create(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
    @Body() dto: CreateFeedCommentBody,
  ) {
    return this.comments.create(req.user, postId, dto);
  }

  /** 016 — PATCH /social/comments/:comment_id (chủ bình luận HOẶC `manage:feed-post`). */
  @Patch("comments/:comment_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.commentUpdate.action, P.commentUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("comment_id", ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateFeedCommentBody,
  ) {
    return this.comments.update(req.user, commentId, dto);
  }

  /** 017 — DELETE /social/comments/:comment_id (xoá MỀM). */
  @Delete("comments/:comment_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.commentDelete.action, P.commentDelete.resourceType)
  remove(@Req() req: AuthenticatedRequest, @Param("comment_id", ParseUUIDPipe) commentId: string) {
    return this.comments.remove(req.user, commentId);
  }
}
