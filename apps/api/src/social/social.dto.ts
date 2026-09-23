import { createZodDto } from "nestjs-zod";
import {
  createFeedCommentSchema,
  createFeedPostSchema,
  createFeedGroupSchema,
  createFeedReportSchema,
  listFeedGroupMembersQuerySchema,
  listFeedGroupsQuerySchema,
  listBirthdaysQuerySchema,
  listCommentsQuerySchema,
  listFeedQuerySchema,
  listFeedReportsQuerySchema,
  listNewsQuerySchema,
  listPostAcksQuerySchema,
  listProfilePostsQuerySchema,
  listSavedQuerySchema,
  listTagsQuerySchema,
  moderateFeedPostSchema,
  putFeedReactionSchema,
  resolveFeedReportSchema,
  searchFeedQuerySchema,
  updateFeedCommentSchema,
  updateFeedGroupSchema,
  updateFeedPostSchema,
} from "@mediaos/contracts";

/**
 * S16-SOCIAL-BE-1 — lớp DTO (nestjs-zod) cho 19 route Nhóm A. Nguồn sự thật là schema ở
 * `packages/contracts/src/social-api.ts`; file này chỉ bọc chúng thành class cho Nest/OpenAPI.
 *
 * ⚠️ Hậu tố `Body`/`Query` (không phải `Dto`) có chủ đích: tên `…Dto` đã thuộc về KIỂU suy ra từ
 * schema ở contracts (`CreateFeedPostDto`). Trùng tên giữa class ở đây và type ở đó là hai thứ khác
 * nhau mang một tên — chỗ dễ nhầm nhất khi đọc service.
 */

export class ListFeedQuery extends createZodDto(listFeedQuerySchema) {}
export class ListSavedQuery extends createZodDto(listSavedQuerySchema) {}
export class ListCommentsQuery extends createZodDto(listCommentsQuerySchema) {}
export class CreateFeedPostBody extends createZodDto(createFeedPostSchema) {}
export class UpdateFeedPostBody extends createZodDto(updateFeedPostSchema) {}
export class ModerateFeedPostBody extends createZodDto(moderateFeedPostSchema) {}
export class CreateFeedCommentBody extends createZodDto(createFeedCommentSchema) {}
export class UpdateFeedCommentBody extends createZodDto(updateFeedCommentSchema) {}
export class PutFeedReactionBody extends createZodDto(putFeedReactionSchema) {}

// ── S16-SOCIAL-BE-1B — Nhóm B (`SOCIAL-API-020..029`) ──
export class ListNewsQuery extends createZodDto(listNewsQuerySchema) {}
export class ListPostAcksQuery extends createZodDto(listPostAcksQuerySchema) {}
export class SearchFeedQuery extends createZodDto(searchFeedQuerySchema) {}
export class ListTagsQuery extends createZodDto(listTagsQuerySchema) {}
export class ListProfilePostsQuery extends createZodDto(listProfilePostsQuerySchema) {}
export class ListBirthdaysQuery extends createZodDto(listBirthdaysQuerySchema) {}
export class CreateFeedReportBody extends createZodDto(createFeedReportSchema) {}
export class ListFeedReportsQuery extends createZodDto(listFeedReportsQuerySchema) {}
export class ResolveFeedReportBody extends createZodDto(resolveFeedReportSchema) {}

// ── S16-SOCIAL-BE-2A — NHÓM (`SOCIAL-API-030..039`) ──
export class ListFeedGroupsQuery extends createZodDto(listFeedGroupsQuerySchema) {}
export class CreateFeedGroupBody extends createZodDto(createFeedGroupSchema) {}
export class UpdateFeedGroupBody extends createZodDto(updateFeedGroupSchema) {}
export class ListFeedGroupMembersQuery extends createZodDto(listFeedGroupMembersQuerySchema) {}
/**
 * ⚠️ **`038` KHÔNG có class DTO ở đây — có lý do, đừng "bổ sung cho đủ bộ".**
 *
 * `decideFeedGroupMemberSchema` là một **UNION** hai dạng loại trừ nhau (D12), và `createZodDto` yêu
 * cầu kiểu đầu ra là một object có thành viên tĩnh: bọc union ⇒ `TS2509` ("Base constructor return
 * type is not an object type"). Đường duy nhất KHÔNG làm hỏng hình dạng union là truyền schema
 * thẳng cho pipe ở controller: `@Body(new ZodValidationPipe(decideFeedGroupMemberSchema))` — khuôn
 * đã dùng ở `employees/employee-code-config.controller.ts:40`.
 *
 * Cách "sửa" sai mà người sau dễ chọn: đổi union thành `z.object({decision?, role?})` cho bọc được.
 * Làm vậy là cho phép gửi CẢ HAI trường trong một request, và thứ tự áp dụng trở thành luật ngầm
 * không ai viết ra — đúng cái D12 loại bỏ.
 */
