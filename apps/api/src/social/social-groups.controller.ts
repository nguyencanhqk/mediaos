import {
  Body,
  Controller,
  Delete,
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
import { decideFeedGroupMemberSchema, type DecideFeedGroupMemberDto } from "@mediaos/contracts";
import type { Request } from "express";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { SOCIAL_ROUTE_PAIRS as P } from "./social-route-pairs.const";
import {
  CreateFeedGroupBody,
  ListFeedGroupMembersQuery,
  ListFeedGroupsQuery,
  UpdateFeedGroupBody,
} from "./social.dto";
import { SocialGroupsService } from "./social-groups.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S16-SOCIAL-BE-2A — `SOCIAL-API-030..039` (nhóm). MỎNG — chỉ định tuyến; mọi quyết định ở service.
 *
 * ⚠️ **THỨ TỰ KHAI: TĨNH TRƯỚC `{id}`** (API-19 §5.2). Ở đây `GET /social/groups` và
 * `POST /social/groups` khai TRƯỚC mọi mẫu `groups/:group_id`. Hai mẫu `groups/:group_id` và
 * `groups/:group_id/members` khác ĐỘ SÂU nên không nuốt nhau.
 *
 * ⚠️ **`ParseUUIDPipe` ở CẤP METHOD trên MỌI `@Param`**, không `@UsePipes` cấp class: ratchet
 * `param-uuid-ratchet.unit-spec.ts` có `UNPIPED_CEILING=1` và trần đó ĐÃ DÙNG HẾT — thiếu một pipe
 * là ĐỎ ngay, và nó là ĐẲNG THỨC (`toBe`), không phải trần lỏng.
 *
 * 🔴 **Cặp quyền đọc TỪ `SOCIAL_ROUTE_PAIRS`, KHÔNG literal** — census 2 tầng so CẢ decorator lẫn
 * service với CÙNG bảng hằng. Chín trong mười route gác bằng `view:feed`; vế thật sự phân quyền là
 * **vai trò HÀNG** trong nhóm (SOC-DEC-006), assert ở tầng 2 (`assertGroupRoleTx`). Đọc decorator
 * một mình sẽ kết luận sai là "gate lỏng" — xem `social-groups.service.ts`.
 */
@Controller("social")
export class SocialGroupsController {
  constructor(private readonly groups: SocialGroupsService) {}

  /** 030 — GET /social/groups (TĨNH). */
  @Get("groups")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupsList.action, P.groupsList.resourceType)
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListFeedGroupsQuery) {
    return this.groups.list(req.user, query);
  }

  /**
   * 031 — POST /social/groups (TĨNH). Cặp RIÊNG `create:feed-group`.
   *
   * `@Idempotent()`: tạo một hàng MỚI mỗi lần và không có khoá tự nhiên nào chặn lượt gửi lại (tên
   * trùng thì 409, nhưng "tạo nhóm Marketing 2" hai lần do mạng chập là hai nhóm thật). D11 đòi
   * **mọi POST** của WO này có decorator — `031`/`035`/`036`.
   */
  @Post("groups")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupCreate.action, P.groupCreate.resourceType)
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateFeedGroupBody) {
    return this.groups.create(req.user, dto);
  }

  /** 032 — GET /social/groups/:group_id. */
  @Get("groups/:group_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupGet.action, P.groupGet.resourceType)
  get(@Req() req: AuthenticatedRequest, @Param("group_id", ParseUUIDPipe) groupId: string) {
    return this.groups.get(req.user, groupId);
  }

  /** 033 — PATCH /social/groups/:group_id (vai `owner|admin`, hoặc `manage:feed-group` + audit). */
  @Patch("groups/:group_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupUpdate.action, P.groupUpdate.resourceType)
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("group_id", ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateFeedGroupBody,
  ) {
    return this.groups.update(req.user, groupId, dto);
  }

  /** 034 — DELETE /social/groups/:group_id (xoá mềm; vai **`owner` MỘT MÌNH** — API-19 dòng 102). */
  @Delete("groups/:group_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupDelete.action, P.groupDelete.resourceType)
  remove(@Req() req: AuthenticatedRequest, @Param("group_id", ParseUUIDPipe) groupId: string) {
    return this.groups.remove(req.user, groupId);
  }

  /** 035 — POST /social/groups/:group_id/join. */
  @Post("groups/:group_id/join")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupJoin.action, P.groupJoin.resourceType)
  join(@Req() req: AuthenticatedRequest, @Param("group_id", ParseUUIDPipe) groupId: string) {
    return this.groups.join(req.user, groupId);
  }

  /** 036 — POST /social/groups/:group_id/leave (cũng là đường HUỶ yêu cầu `pending` của chính mình). */
  @Post("groups/:group_id/leave")
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupLeave.action, P.groupLeave.resourceType)
  leave(@Req() req: AuthenticatedRequest, @Param("group_id", ParseUUIDPipe) groupId: string) {
    return this.groups.leave(req.user, groupId);
  }

  /** 037 — GET /social/groups/:group_id/members (ĐIỂM CHIẾU DANH TÍNH — xem `listMembersTx`). */
  @Get("groups/:group_id/members")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupMembersList.action, P.groupMembersList.resourceType)
  @UsePipes(ZodValidationPipe)
  listMembers(
    @Req() req: AuthenticatedRequest,
    @Param("group_id", ParseUUIDPipe) groupId: string,
    @Query() query: ListFeedGroupMembersQuery,
  ) {
    return this.groups.listMembers(req.user, groupId, query);
  }

  /**
   * 038 — PATCH /social/groups/:group_id/members/:user_id.
   *
   * KHÔNG `@Idempotent()`: đây là PATCH lên một hàng đã tồn tại, và mọi nhánh đều idempotent ở tầng
   * DB (`WHERE status = …` trong chính câu ghi ⇒ lượt thứ hai không đổi gì và trả 409, không tạo
   * hàng trùng). Cùng lý lẽ với `021` của BE-1B.
   */
  @Patch("groups/:group_id/members/:user_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupMemberDecide.action, P.groupMemberDecide.resourceType)
  decideMember(
    @Req() req: AuthenticatedRequest,
    @Param("group_id", ParseUUIDPipe) groupId: string,
    @Param("user_id", ParseUUIDPipe) targetUserId: string,
    // Schema UNION ⇒ truyền THẲNG cho pipe, không qua `createZodDto` (xem `social.dto.ts`).
    @Body(new ZodValidationPipe(decideFeedGroupMemberSchema)) dto: DecideFeedGroupMemberDto,
  ) {
    return this.groups.decideMember(req.user, groupId, targetUserId, dto);
  }

  /** 039 — DELETE /social/groups/:group_id/members/:user_id (mời ra; audit LUÔN). */
  @Delete("groups/:group_id/members/:user_id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.groupMemberRemove.action, P.groupMemberRemove.resourceType)
  removeMember(
    @Req() req: AuthenticatedRequest,
    @Param("group_id", ParseUUIDPipe) groupId: string,
    @Param("user_id", ParseUUIDPipe) targetUserId: string,
  ) {
    return this.groups.removeMember(req.user, groupId, targetUserId);
  }
}
