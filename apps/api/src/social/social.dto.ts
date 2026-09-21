import { createZodDto } from "nestjs-zod";
import {
  createFeedCommentSchema,
  createFeedPostSchema,
  listCommentsQuerySchema,
  listFeedQuerySchema,
  listSavedQuerySchema,
  moderateFeedPostSchema,
  putFeedReactionSchema,
  updateFeedCommentSchema,
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
