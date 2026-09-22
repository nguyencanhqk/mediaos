import { z } from "zod";
import {
  feedGroupRoleSchema,
  feedGroupVisibilitySchema,
  feedGroupMemberStatusSchema,
} from "./social";
import { FEED_ADMIN_PAGE_LIMIT_MAX, FEED_PAGE_MAX } from "./social-api-b";

/**
 * S16-SOCIAL-BE-2A — DTO request/response **NHÓM** (10 route `SOCIAL-API-030..039`).
 *
 * TÁCH KHỎI `./social-api-b` theo đúng luật đã tách `social-api-b` khỏi `social-api` (trần 800 dòng,
 * CLAUDE.md §5 — không cổng nào ép tự động, memory `file-over-800-has-no-gate`): `social-api-b.ts`
 * đang ~360 dòng và BE-2B còn `040..048` chưa có chỗ. File này import NGƯỢC và **KHÔNG re-export**
 * tên nào của hai file kia.
 *
 * 🔴 **LUẬT HÌNH DẠNG (nợ (f) của DB-2):** mọi DTO GHI là allowlist `.strict()` dựng TỪ ĐẦU hoặc
 * `.pick()` rồi `.strict()` — **CẤM `.extend()` core schema**. `feedGroupMemberCoreSchema` mang
 * `role`/`status`/`userId` (cột do SERVER quyết định); `.extend()` nó làm body = mass-assignment:
 * người xin vào nhóm tự gửi `{role:'owner', status:'active'}` là tự lên chủ nhóm.
 *
 * ⚠️ `feedGroupCoreSchema` **dựng mới ở đây** — đo ngày 22/09: `packages/contracts/src/social.ts`
 * chỉ có `feedGroupMemberCoreSchema`/`feedPollCoreSchema`/`feedIdeaCoreSchema` (M5, 0 hit cho
 * `feedGroupCoreSchema`), nên không có gì để mở rộng.
 */

/** UUID — bản sao CỤC BỘ (helper cùng tên ở hai file kia là `const` nội bộ, không export). */
const uuid = () => z.string().uuid();

/** Mirror `varchar(255)` của `feed_groups.name` (giới hạn KIỂU). Tên trống/chỉ khoảng trắng bị chặn ở Zod. */
export const FEED_GROUP_NAME_MAX = 255;
/** Mirror `text` + giới hạn nghiệp vụ cho `feed_groups.description`. */
export const FEED_GROUP_DESC_MAX = 2000;

/**
 * LÕI `feed_groups` — mirror hai CHECK của `0580`: `chk_feed_groups_visibility` (public|private) và
 * `chk_feed_groups_member_count` (`>= 0`).
 *
 * KHÔNG `.strict()` (đây là lõi để `.pick()`, không phải body route), và **mang cột do SERVER quyết
 * định** (`memberCount`) ⇒ áp đúng cảnh báo ở đầu file cho mọi DTO ghi dựng từ nó.
 */
export const feedGroupCoreSchema = z.object({
  id: uuid(),
  name: z.string().trim().min(1).max(FEED_GROUP_NAME_MAX),
  description: z.string().trim().max(FEED_GROUP_DESC_MAX).nullish(),
  visibility: feedGroupVisibilitySchema,
  avatarFileId: uuid().nullish(),
  memberCount: z.number().int().min(0),
});
export type FeedGroupCoreDto = z.infer<typeof feedGroupCoreSchema>;

// ─────────────────────────── 030 · GET /social/groups ───────────────────────────

/**
 * Bộ lọc danh sách nhóm. Phân trang **OFFSET** (cùng khuôn `024`/`028` của Nhóm B, không phải cursor
 * như feed): danh sách nhóm ngắn, ổn định, và FE cần nhảy trang.
 *
 * `membership='mine'` = chỉ nhóm actor là thành viên `active`. Mặc định `all` = nhóm `public` **∪**
 * nhóm actor là thành viên — **KHÔNG BAO GIỜ** gồm nhóm `private` actor không thuộc (G10).
 */
export const listFeedGroupsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
    membership: z.enum(["all", "mine"]).default("all"),
    q: z.string().trim().min(1).max(FEED_GROUP_NAME_MAX).optional(),
  })
  .strict();
export type ListFeedGroupsQueryDto = z.infer<typeof listFeedGroupsQuerySchema>;

/**
 * Một nhóm trong danh sách / chi tiết.
 *
 * `myRole`/`myStatus` là quan hệ của **chính actor** với nhóm (null = không có quan hệ) — FE cần nó
 * để chọn nút "Xin vào" vs "Đang chờ duyệt" vs "Rời nhóm" mà không phải gọi thêm route.
 */
export const feedGroupSchema = z.object({
  id: uuid(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: feedGroupVisibilitySchema,
  avatarUrl: z.string().nullable(),
  memberCount: z.number().int().min(0),
  myRole: feedGroupRoleSchema.nullable(),
  myStatus: feedGroupMemberStatusSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type FeedGroupDto = z.infer<typeof feedGroupSchema>;

export const feedGroupPageSchema = z.object({
  data: z.array(feedGroupSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
});
export type FeedGroupPageDto = z.infer<typeof feedGroupPageSchema>;

// ──────────────────── 031 · POST /social/groups · 033 · PATCH ────────────────────

/**
 * Body tạo nhóm — `.pick()` + `.strict()`: **KHÔNG** có `memberCount` (server đếm), **KHÔNG** có
 * `id`. Người tạo thành `owner`/`active` cùng tx ở service, không do body khai.
 */
export const createFeedGroupSchema = feedGroupCoreSchema
  .pick({ name: true, description: true, visibility: true, avatarFileId: true })
  .strict();
export type CreateFeedGroupDto = z.infer<typeof createFeedGroupSchema>;

/** Body sửa nhóm — mọi trường optional, nhưng body RỖNG bị từ chối (400) để PATCH không thành no-op câm. */
export const updateFeedGroupSchema = createFeedGroupSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "cần ít nhất một trường để cập nhật" });
export type UpdateFeedGroupDto = z.infer<typeof updateFeedGroupSchema>;

// ──────────────────────── 037 · GET …/members ────────────────────────

export const listFeedGroupMembersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).default(1),
    limit: z.coerce.number().int().min(1).max(FEED_ADMIN_PAGE_LIMIT_MAX).default(20),
    /** Lọc theo trạng thái — màn "duyệt yêu cầu" chỉ cần `pending`. */
    status: feedGroupMemberStatusSchema.optional(),
  })
  .strict();
export type ListFeedGroupMembersQueryDto = z.infer<typeof listFeedGroupMembersQuerySchema>;

/**
 * Một thành viên nhóm.
 *
 * 🔴 **NGOẠI LỆ CÓ CHỦ Ý của luật "DTO đọc KHÔNG chở `userId`"** (danh tính = `employeeId` + tên +
 * avatar). Lý do: `038`/`039` khoá theo `{user_id}` trong đường dẫn (API-19 §5.1 dòng 106-107), nên
 * FE **không thể** duyệt/đổi vai trò/mời ra nếu danh sách không trả `userId` — và người đọc được
 * danh sách này vốn đã là thành viên của chính nhóm đó (hoặc `manage:feed-group`).
 * ⇒ Điểm chiếu này PHẢI được đăng ký ở `identity-projection-verdicts.ts` (plan §8 bước 14).
 */
export const feedGroupMemberSchema = z.object({
  userId: uuid(),
  employeeId: uuid().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: feedGroupRoleSchema,
  status: feedGroupMemberStatusSchema,
  joinedAt: z.string().datetime({ offset: true }).nullable(),
});
export type FeedGroupMemberDto = z.infer<typeof feedGroupMemberSchema>;

export const feedGroupMemberPageSchema = z.object({
  data: z.array(feedGroupMemberSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
});
export type FeedGroupMemberPageDto = z.infer<typeof feedGroupMemberPageSchema>;

// ──────────────── 038 · PATCH …/members/{user_id} ────────────────

/**
 * Body `038` — **HAI DẠNG LOẠI TRỪ NHAU** (D12), union phân biệt chứ không phải một object có hai
 * trường optional: một object `{decision?, role?}` cho phép gửi CẢ HAI (duyệt và đổi vai trò cùng
 * lúc), và khi đó thứ tự áp dụng trở thành luật ngầm không ai viết ra.
 *
 *   • `{decision:'approve'|'reject'}` — cho hàng `pending`
 *   • `{role:'owner'|'admin'|'member'}` — cho hàng `active`
 *
 * `role:'owner'` HỢP LỆ: đó là đường CHUYỂN OWNER (D6). Nhưng chỉ `owner` hiện tại hoặc
 * `manage:feed-group` được dùng, và bất biến ≥1 owner `active` ép ở service **trong cùng tx, sau một
 * neo `FOR UPDATE`** (D6-ii). Dạng body không khớp trạng thái hàng ⇒ **409 ở service**, KHÔNG để
 * chạm `chk_feed_group_members_pending_role` rồi 500 (M-d).
 */
export const decideFeedGroupMemberSchema = z
  .union([
    z.object({ decision: z.enum(["approve", "reject"]) }).strict(),
    z.object({ role: feedGroupRoleSchema }).strict(),
  ])
  .describe("SOCIAL-API-038");
export type DecideFeedGroupMemberDto = z.infer<typeof decideFeedGroupMemberSchema>;
