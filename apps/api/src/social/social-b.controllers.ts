import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  CreateFeedReportBody,
  ListBirthdaysQuery,
  ListFeedReportsQuery,
  ListNewsQuery,
  ListPostAcksQuery,
  ListProfilePostsQuery,
  ListTagsQuery,
  ResolveFeedReportBody,
  SearchFeedQuery,
} from "./social.dto";
import { SocialDiscoveryService } from "./social-discovery.service";
import { SocialNewsService } from "./social-news.service";
import { SocialReportsService } from "./social-reports.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S16-SOCIAL-BE-1B — 3 controller Nhóm B (`SOCIAL-API-020..029`). MỎNG — chỉ định tuyến.
 *
 * Cặp `@RequirePermission` đọc TỪ `SOCIAL_ROUTE_PAIRS` (KHÔNG literal — census 2 tầng so CẢ decorator
 * lẫn service với CÙNG bảng hằng). Tầng 2 assert lại trong service qua `resolveActor`.
 *
 * ⚠️ **THỨ TỰ KHAI: TĨNH TRƯỚC `{id}`** (API-19 §5.2, bài học `goals/tree`). Trong file này mọi route
 * TĨNH (`news` · `search` · `tags` · `birthdays` · `reports`) nằm ở controller/method khai TRƯỚC các
 * route có tham số.
 *
 * ⟲ **Đính chính (gate 22/09) — lập luận an toàn KHÔNG nằm ở thứ tự đăng ký.** Bản trước viết
 * «`SocialNewsController` đăng ký trước `SocialPostsController`»: SAI THỰC TẾ — `social.module.ts`
 * liệt kê `SocialPostsController` TRƯỚC (khối BE-1B là phần append ở cuối, đúng luật hot-file). Điều
 * làm nó an toàn là BE-1 **không có route bắt-tất** `GET social/:param`: mọi mẫu của nó bắt đầu bằng
 * đoạn cố định (`posts/` · `comments/` · `feed` · `saved`), nên `social/news` không mẫu nào nuốt.
 * Người thêm route sau phải dựa vào ĐIỀU ĐÓ, không dựa vào một thứ tự đăng ký không tồn tại.
 *
 * ⚠️ **`ParseUUIDPipe` ở CẤP METHOD trên MỌI `@Param`**, không `@UsePipes` cấp class: ratchet
 * `param-uuid-ratchet.unit-spec.ts` có `UNPIPED_CEILING=1` và trần đó ĐÃ DÙNG HẾT — thiếu một pipe là
 * ĐỎ ngay, và nó là ĐẲNG THỨC (`toBe`), không phải trần lỏng.
 */
@Controller("social")
export class SocialNewsController {
  constructor(private readonly news: SocialNewsService) {}

  /** 020 — GET /social/news (TĨNH). */
  @Get("news")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.newsList.action, P.newsList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListNewsQuery) {
    return this.news.list(req.user, query);
  }

  /**
   * 021 — POST /social/posts/:post_id/ack.
   *
   * KHÔNG `@Idempotent()` dù là POST (D9): PK tổ hợp `(company_id, post_id, user_id)` +
   * `ON CONFLICT DO NOTHING` làm route này idempotent Ở TẦNG DB — gọi lại không tạo hàng trùng và
   * không đổi mốc. Cùng lý do với `007`/`008` của BE-1.
   *
   * KHÔNG `@Body()`: người xác nhận LUÔN là `req.user.id` (done_when: «body không nhận trường userId»).
   */
  @Post("posts/:post_id/ack")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postAck.action, P.postAck.resourceType)
  ack(@Req() req: AuthenticatedRequest, @Param("post_id", ParseUUIDPipe) postId: string) {
    return this.news.ack(req.user, postId);
  }

  /** 022 — GET /social/posts/:post_id/acks (cặp `manage:feed-news` — xem `unackedEmployeesFor`). */
  @Get("posts/:post_id/acks")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.postAcksList.action, P.postAcksList.resourceType)
  @UsePipes(ZodValidationPipe)
  listAcks(
    @Req() req: AuthenticatedRequest,
    @Param("post_id", ParseUUIDPipe) postId: string,
    @Query() query: ListPostAcksQuery,
  ) {
    return this.news.listAcks(req.user, postId, query);
  }
}

/** `SOCIAL-API-023..026` — tìm kiếm · thẻ · trang cá nhân · sinh nhật. */
@Controller("social")
export class SocialDiscoveryController {
  constructor(private readonly discovery: SocialDiscoveryService) {}

  /** 023 — GET /social/search (TĨNH). */
  @Get("search")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.search.action, P.search.resourceType)
  @UsePipes(ZodValidationPipe)
  search(@Req() req: AuthenticatedRequest, @Query() query: SearchFeedQuery) {
    return this.discovery.search(req.user, query);
  }

  /** 024 — GET /social/tags (TĨNH). */
  @Get("tags")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.tagsList.action, P.tagsList.resourceType)
  @UsePipes(ZodValidationPipe)
  listTags(@Req() req: AuthenticatedRequest, @Query() query: ListTagsQuery) {
    return this.discovery.listTags(req.user, query);
  }

  /** 026 — GET /social/birthdays (TĨNH). Gate `view:feed`, KHÔNG cặp HR nào (SOC-DEC-007). */
  @Get("birthdays")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.birthdays.action, P.birthdays.resourceType)
  @UsePipes(ZodValidationPipe)
  birthdays(@Req() req: AuthenticatedRequest, @Query() query: ListBirthdaysQuery) {
    return this.discovery.birthdays(req.user, query);
  }

  /** 025 — GET /social/profiles/:employee_id/posts (khai SAU mọi route TĨNH của controller này). */
  @Get("profiles/:employee_id/posts")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.profilePosts.action, P.profilePosts.resourceType)
  @UsePipes(ZodValidationPipe)
  profilePosts(
    @Req() req: AuthenticatedRequest,
    @Param("employee_id", ParseUUIDPipe) employeeId: string,
    @Query() query: ListProfilePostsQuery,
  ) {
    return this.discovery.profilePosts(req.user, employeeId, query);
  }
}

/** `SOCIAL-API-027..029` — báo cáo vi phạm. 🔴 Cụm crown-jewel của WO. */
@Controller("social")
export class SocialReportsController {
  constructor(private readonly reports: SocialReportsService) {}

  /**
   * 027 — POST /social/reports (TĨNH).
   *
   * `@Idempotent()` (KHÁC `021`): route này tạo một hàng MỚI mỗi lần và KHÔNG có khoá tự nhiên chặn
   * — partial UNIQUE `feed_reports_open_uq` chỉ chặn TRÙNG KHI cái cũ còn `open`, nên một lượt gửi
   * lại sau khi báo cáo cũ đã xử lý sẽ tạo hàng thật. Cùng hình dạng `002`/`015` của BE-1.
   */
  @Post("reports")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.reportCreate.action, P.reportCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateFeedReportBody) {
    return this.reports.create(req.user, dto);
  }

  /**
   * 028 — GET /social/reports (TĨNH).
   *
   * 🔴 Route DUY NHẤT của SOCIAL có `companyFloor:false` (`dataScope:"Department"`): `resolveActor`
   * KHÔNG ép sàn Company ở đây, nên toàn bộ phạm vi do repository ép TRONG SQL (`scopeCondition`,
   * `switch` vét cạn). Đọc decorator một mình sẽ hiểu sai là "gate lỏng".
   */
  @Get("reports")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.reportsList.action, P.reportsList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListFeedReportsQuery) {
    return this.reports.list(req.user, query);
  }

  /** 029 — PATCH /social/reports/:report_id (cặp `manage:feed-report`, sàn Company). */
  @Patch("reports/:report_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.reportResolve.action, P.reportResolve.resourceType)
  @UsePipes(ZodValidationPipe)
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param("report_id", ParseUUIDPipe) reportId: string,
    @Body() dto: ResolveFeedReportBody,
  ) {
    return this.reports.resolve(req.user, reportId, dto);
  }
}
