import { z } from "zod";
import {
  feedGroupSchema,
  type FeedGroupDto,
  feedGroupPageSchema,
  type FeedGroupPageDto,
  feedGroupMemberPageSchema,
  type FeedGroupMemberPageDto,
  feedGroupMemberMutationSchema,
  type FeedGroupMemberMutationDto,
  type CreateFeedGroupDto,
  type UpdateFeedGroupDto,
  type DecideFeedGroupMemberDto,
  type ListFeedGroupsQueryDto,
  type ListFeedGroupMembersQueryDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";
import { idempotencyKeyFor } from "./api-idempotency";
import { feedDeletedResultSchema, type FeedDeletedResultDto } from "./social-api";

/**
 * S16-SOCIAL-FE-2B — client NHÓM (`SOCIAL-API-030..039`). Tách khỏi `social-api.ts` để file đó không
 * phình quá trần (CLAUDE.md §5); cùng tiền tố BE `/social`, cùng khuôn `apiFetch` + schema contracts.
 *
 * Hình dạng phản hồi ĐO LẠI 29/09/2026 (plan FE-2B §1.a) trên `social-groups.service.ts`:
 * `030`/`037` = trang OFFSET `{data,page,limit,total}` · `031/032/033/035` = `FeedGroupDto` ·
 * `038` = `{userId, role, status}` · **`034` và `039` = `{deleted:true}`** · **`036` = `{left:true}`**
 * (HTTP 201). Docblock cũ của contracts từng khai `039` trả mutation DTO — parse bằng schema đó là NÉM
 * ZodError SAU KHI người đó đã bị mời ra thật, nên ở đây dùng đúng literal.
 */

/**
 * Phản hồi `036` rời nhóm / huỷ yêu cầu — `{ left: true }`.
 *
 * Khai TẠI ĐÂY, không ở contracts, cùng lý do với `feedDeletedResultSchema`: BE trả literal thẳng từ
 * service (`social-groups.service.ts#leave`) không qua schema contracts nào. `literal(true)` +
 * `.strict()` như tiền lệ: BE đổi hình dạng thì ta biết bằng một lỗi parse ồn ào.
 */
export const feedGroupLeftResultSchema = z.object({ left: z.literal(true) }).strict();
export type FeedGroupLeftResultDto = z.infer<typeof feedGroupLeftResultSchema>;

const groupPath = (groupId: string): string => `/social/groups/${groupId}`;
const memberPath = (groupId: string, userId: string): string =>
  `${groupPath(groupId)}/members/${userId}`;

export const socialGroupsApi = {
  /**
   * GET /social/groups (030). `membership='mine'` = chỉ nhóm actor `active`; mặc định `all` = public ∪
   * nhóm actor có hàng (active HOẶC pending). Query `.strict()` ⇒ không nhét khoá lạ.
   */
  list: (query?: Partial<ListFeedGroupsQueryDto>): Promise<FeedGroupPageDto> =>
    apiFetch(`/social/groups${buildQueryString(query ?? {})}`, feedGroupPageSchema),

  /**
   * POST /social/groups (031) — cặp `create:feed-group`. `@Idempotent()` ⇒ khoá suy-từ-nội-dung
   * (khuôn `createPost`).
   *
   * ⚠️ Giới hạn đã biết: tạo X → xoá X → tạo lại X đúng thân trong cửa sổ 15 phút của server ⇒ server
   * PHÁT LẠI phản hồi cũ (nhóm đã xoá) ⇒ trang nhóm 404. Hiếm và không mất dữ liệu; chấp nhận.
   */
  create: (body: CreateFeedGroupDto): Promise<FeedGroupDto> =>
    apiFetch(
      "/social/groups",
      feedGroupSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("social-group-create", body) },
    ),

  /** GET /social/groups/:groupId (032). Nhóm kín mà actor không `active` (không có `manage`) ⇒ 404 ERR-012. */
  get: (groupId: string): Promise<FeedGroupDto> => apiFetch(groupPath(groupId), feedGroupSchema),

  /** PATCH /social/groups/:groupId (033) — owner/admin hoặc `manage:feed-group`. Body rỗng ⇒ 400. */
  update: (groupId: string, body: UpdateFeedGroupDto): Promise<FeedGroupDto> =>
    apiFetch(groupPath(groupId), feedGroupSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /social/groups/:groupId (034) — xoá MỀM, owner MỘT MÌNH hoặc `manage:feed-group`. */
  remove: (groupId: string): Promise<FeedDeletedResultDto> =>
    apiFetch(groupPath(groupId), feedDeletedResultSchema, { method: "DELETE" }),

  /**
   * POST /social/groups/:groupId/join (035) — public ⇒ `active`, private ⇒ `pending`.
   *
   * 🔴 **CỐ Ý KHÔNG gửi `Idempotency-Key`** dù route mang `@Idempotent()` — ngoại lệ có chủ đích của
   * luật «khoá suy từ nội dung» (plan FE-2B D2):
   *  1. join/leave là TOGGLE: khoá suy từ `{groupId}` làm chuỗi join → leave → join trong 15 phút nhận
   *     lại phản hồi 201 CŨ mà server **không tạo hàng nào** — hỏng im lặng, nút báo «đã tham gia»;
   *  2. mutation không retry (`main.tsx` `mutations.retry=false`) và `apiFetch` không tự thử lại ⇒
   *     khoá không chống được lượt gửi lặp nào;
   *  3. lượt trùng đã có luật nghiệp vụ chặn: 409 `SOCIAL-ERR-013` (đã có hàng) + nút khoá khi đang gửi.
   * Header là TUỲ CHỌN phía server (`idempotency.interceptor.ts`: không có khoá ⇒ chạy thường).
   */
  join: (groupId: string): Promise<FeedGroupDto> =>
    apiFetch(`${groupPath(groupId)}/join`, feedGroupSchema, { method: "POST" }),

  /**
   * POST /social/groups/:groupId/leave (036) — rời nhóm, CŨNG là đường huỷ yêu cầu `pending` của chính
   * mình. Chủ nhóm cuối ⇒ 409 `SOCIAL-ERR-015`. KHÔNG gửi khoá — cùng lý do với `join`.
   */
  leave: (groupId: string): Promise<FeedGroupLeftResultDto> =>
    apiFetch(`${groupPath(groupId)}/leave`, feedGroupLeftResultSchema, { method: "POST" }),

  /**
   * GET /social/groups/:groupId/members (037). `status` tuỳ chọn phía server — KHÔNG truyền là LẪN cả
   * `pending` ⇒ caller luôn truyền rõ `active` (tab Thành viên) hoặc `pending` (tab Yêu cầu).
   */
  listMembers: (
    groupId: string,
    query?: Partial<ListFeedGroupMembersQueryDto>,
  ): Promise<FeedGroupMemberPageDto> =>
    apiFetch(
      `${groupPath(groupId)}/members${buildQueryString(query ?? {})}`,
      feedGroupMemberPageSchema,
    ),

  /**
   * PATCH /social/groups/:groupId/members/:userId (038) — `{decision}` cho hàng `pending` HOẶC
   * `{role}` cho hàng `active` (union, không bao giờ cả hai). Không `@Idempotent` ở server.
   */
  decideMember: (
    groupId: string,
    userId: string,
    body: DecideFeedGroupMemberDto,
  ): Promise<FeedGroupMemberMutationDto> =>
    apiFetch(memberPath(groupId, userId), feedGroupMemberMutationSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /social/groups/:groupId/members/:userId (039) — mời ra. Trả `{deleted:true}`. */
  removeMember: (groupId: string, userId: string): Promise<FeedDeletedResultDto> =>
    apiFetch(memberPath(groupId, userId), feedDeletedResultSchema, { method: "DELETE" }),
};
