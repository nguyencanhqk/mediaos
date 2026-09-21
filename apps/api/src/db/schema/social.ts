import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { employeeProfiles } from "./employees";
import { files } from "./files";
import { orgUnits } from "./org";
import { users } from "./users";

/**
 * SOCIAL Track A + Track B (DB-17 §6/§7 / SPEC-16) — 19 bảng bảng-tin nội bộ:
 *   • Track A (10 bảng, migration 0577) — bài/bình luận/thẻ/reaction/mention/lưu/xem/ack/báo cáo
 *     (seed 14 cặp quyền `feed-*` 0578 · UNION-ADD audit object_type 0579).
 *   • Track B (9 bảng, migration 0580) — nhóm/thành viên/bình chọn/lựa chọn/phiếu/sáng kiến/vinh
 *     danh/người nhận/catalog huy hiệu (NOTI-EVENT-028..036 ở 0581 · seed 5 huy hiệu 0582 ·
 *     UNION-ADD `feed_kudos_badge` 0583).
 * Inference dưới đây PARITY với migration — Drizzle KHÔNG mô tả RLS/grant/policy/composite FK;
 * migration là chuẩn. ⚠️ KHÔNG `db:generate` (sẽ DROP cụm media/finance đang park).
 *
 * company_id NOT NULL (BẤT BIẾN #1): RLS ENABLE + FORCE + policy literal-GUC `tenant_isolation`
 *   (USING + WITH CHECK) cả 19 bảng. Mọi query qua withTenant(companyId, fn). MỌI FK chéo bảng nghiệp
 *   vụ là COMPOSITE `(company_id, col) → parent(company_id, id)` ở SQL (KI-046 — FK Postgres không áp
 *   RLS); `.references()` một cột dưới đây CHỈ để suy kiểu TS.
 *
 * BẤT BIẾN #2: `feed_post_views` + `feed_post_acks` là SỔ APPEND-ONLY — app role SELECT/INSERT, KHÔNG
 *   UPDATE/DELETE (ack = vết không rút lại được). `feed_posts`/`feed_comments` soft-delete (`deleted_at`),
 *   KHÔNG DELETE. Bốn bảng tương tác cá nhân/gán-lại CÓ DELETE (`feed_reactions` · `feed_mentions` ·
 *   `feed_post_tags` · `feed_saved_posts`) — vì thế CẢ MƯỜI bảng nằm trong
 *   `RetentionService.PROTECTED_TABLES`: với bốn bảng có DELETE, tập đó là lớp phòng thủ DUY NHẤT
 *   (retention lọc theo `created_at`, KHÔNG theo `deleted_at` ⇒ sẽ xoá CỨNG hàng đang sống).
 *
 * BẤT BIẾN #3: SOCIAL không lưu secret nào. Ngày sinh KHÔNG lưu lại ở đây — đọc từ `employee_profiles`
 *   và cắt còn ngày+tháng ở DTO (SPEC-16 §3.5).
 *
 * HAI ĐIỂM CẦN BIẾT TRƯỚC KHI SỬA (plan S16-SOCIAL-DB-1 §0):
 *   • `feedPosts.groupId` ĐÃ có composite FK `feed_posts_group_fk` → `feed_groups (company_id, id)`
 *     NO ACTION (migration 0580 trả nợ §0.2 của DB-1) — KHÔNG còn là ngoại lệ.
 *   • `publishedAt`/`lastActivityAt` là 2 cột MỐC SẮP XẾP cho keyset của BE-1 — `lastActivityAt` bump
 *     CÙNG TX khi có bình luận/reaction mới, ⚠️ KHÔNG bump theo `feed_post_views` (bump là biến
 *     «Hoạt động mới» thành «vừa có người xem»).
 *
 * CHỐT CUỐI ở DB (FSM/quy tắc nghiệp vụ ép ở service — CHECK chỉ giữ tập giá trị):
 *   `feed_reactions_target_user_uq` (thích đôi) · `feed_mentions_uq` · PK tổ hợp của
 *   `feed_post_tags`/`feed_saved_posts`/`feed_post_views`/`feed_post_acks` (gán đôi · lưu đôi · xem
 *   đôi · ack đôi) · `feed_reports_open_uq` partial (1 báo cáo `open` mỗi đối tượng/người báo) ·
 *   `feed_poll_votes_single_uq` partial theo cột dẫn xuất `single_choice` (phiếu đôi ở poll
 *   một-lựa-chọn — D1 của plan DB-2) · PK tổ hợp của `feed_group_members`/`feed_poll_votes`/
 *   `feed_kudos_recipients` · 1-1 bài↔poll/idea/kudos (`feed_*_company_post_uq`).
 *   Bình luận MỘT CẤP ép ở SERVICE — CHECK cấp hàng không nhìn được hàng cha, trigger là bẫy đóng băng.
 *   FSM sáng kiến · khoá owner cuối nhóm · 2-10 lựa chọn · bất biến `multiple_choice`/`is_anonymous`
 *   sau khi tạo poll: TẤT CẢ ép ở SERVICE (S16-SOCIAL-BE-2) — CHECK cấp hàng không đếm/không nhớ được.
 */

// S16-SOCIAL-DB-1 (mig 0577): `tsvector` không có sẵn trong drizzle-orm/pg-core (khuôn communication.ts:154).
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/** Mirror `chk_feed_posts_type`; nguồn DTO = packages/contracts social.ts (`feedPostTypeSchema`). */
export type FeedPostType = "share" | "news" | "idea" | "poll" | "kudos";
/** Mirror `chk_feed_posts_audience`. */
export type FeedAudience = "company" | "group" | "org_unit";
/** Mirror `chk_feed_posts_status` (SPEC-01 §17.18). */
export type FeedPostStatus = "published" | "hidden" | "deleted";
/** Mirror `chk_feed_reactions_target` — DÙNG CHUNG cho reactions/mentions/reports. */
export type FeedTargetType = "post" | "comment";
/** Mirror `chk_feed_reports_reason`. */
export type FeedReportReason = "spam" | "harassment" | "inappropriate" | "misinformation" | "other";
/** Mirror `chk_feed_reports_status`. */
export type FeedReportStatus = "open" | "resolved" | "dismissed";

// ─── feed_posts — bài đăng (mutable, soft-delete; DB-17 §6.1) ──────────────────────────────────
export const feedPosts = pgTable(
  "feed_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // Cột NOT NULL ⇒ composite FK NO ACTION (SET NULL sẽ nổ lúc teardown — DB-17 §4.2b).
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    authorEmployeeId: uuid("author_employee_id").references(() => employeeProfiles.id),
    type: varchar("type", { length: 16 }).$type<FeedPostType>().notNull(),
    audience: varchar("audience", { length: 16 })
      .$type<FeedAudience>()
      .notNull()
      .default("company"),
    /** Composite FK `feed_posts_group_fk` → feed_groups (company_id, id) NO ACTION (mig 0580). */
    groupId: uuid("group_id").references(() => feedGroups.id),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id),
    /** Nullable: bài `poll`/`kudos` mang nội dung ở bảng con Track B (CHECK `_body_required`). */
    body: text("body"),
    status: varchar("status", { length: 16 })
      .$type<FeedPostStatus>()
      .notNull()
      .default("published"),
    pinned: boolean("pinned").notNull().default(false),
    commentsLocked: boolean("comments_locked").notNull().default(false),
    requiresAck: boolean("requires_ack").notNull().default(false),
    /** Bộ đếm denormalized — cập nhật CÙNG TX với hàng nguồn, KHÔNG trigger (DB-17 §4.7). */
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    /** §0.5 — set 1 lần lúc tạo, KHÔNG đổi khi sửa bài. Keyset «Mới đăng» = (published_at, id). */
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    /** §0.5 — bump CÙNG TX khi có bình luận/reaction mới. ⚠️ KHÔNG bump theo feed_post_views. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    /** GENERATED ALWAYS — DB tự tính. Thiếu khai generated ⇒ INSERT đỏ "cannot insert into generated
     *  column". Dùng 'simple' + public.f_unaccent (IMMUTABLE, 0538) — phương án A của DB-17 §6.1b. */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', public.f_unaccent(coalesce(body, '')))`,
    ),
  },
  (t) => [
    check("chk_feed_posts_type", sql`type IN ('share', 'news', 'idea', 'poll', 'kudos')`),
    check("chk_feed_posts_audience", sql`audience IN ('company', 'group', 'org_unit')`),
    check("chk_feed_posts_status", sql`status IN ('published', 'hidden', 'deleted')`),
    // CHECK CẶP dạng KÉO THEO (KHÔNG vế "IS NULL OR" rỗng — vế rỗng đúng vĩnh viễn, chặn được 0 thứ).
    check("chk_feed_posts_audience_group", sql`audience <> 'group' OR group_id IS NOT NULL`),
    check("chk_feed_posts_audience_org", sql`audience <> 'org_unit' OR org_unit_id IS NOT NULL`),
    check(
      "chk_feed_posts_audience_company",
      sql`audience <> 'company' OR (group_id IS NULL AND org_unit_id IS NULL)`,
    ),
    check("chk_feed_posts_audience_group_excl", sql`audience <> 'group' OR org_unit_id IS NULL`),
    check("chk_feed_posts_audience_org_excl", sql`audience <> 'org_unit' OR group_id IS NULL`),
    check("chk_feed_posts_pinned_news", sql`pinned = false OR type = 'news'`),
    check("chk_feed_posts_ack_news", sql`requires_ack = false OR type = 'news'`),
    check(
      "chk_feed_posts_body_required",
      sql`type IN ('poll', 'kudos') OR (body IS NOT NULL AND length(btrim(body)) > 0)`,
    ),
    check("chk_feed_posts_body_len", sql`length(body) <= 20000`),
    check("chk_feed_posts_counts", sql`like_count >= 0 AND comment_count >= 0 AND view_count >= 0`),
    // UNIQUE (company_id, id) — đích composite FK của comments/tags/views/acks/saved/reports (ở SQL).
    unique("feed_posts_company_id_id_uq").on(t.companyId, t.id),
    index("idx_feed_posts_company_created")
      .on(t.companyId, sql`${t.createdAt} DESC`)
      .where(sql`deleted_at IS NULL AND status = 'published'`),
    index("idx_feed_posts_company_group")
      .on(t.companyId, t.groupId, sql`${t.createdAt} DESC`)
      .where(sql`deleted_at IS NULL AND group_id IS NOT NULL`),
    index("idx_feed_posts_company_org")
      .on(t.companyId, t.orgUnitId, sql`${t.createdAt} DESC`)
      .where(sql`deleted_at IS NULL AND org_unit_id IS NOT NULL`),
    index("idx_feed_posts_company_type")
      .on(t.companyId, t.type, sql`${t.createdAt} DESC`)
      .where(sql`deleted_at IS NULL`),
    index("idx_feed_posts_company_pinned")
      .on(t.companyId, sql`${t.createdAt} DESC`)
      .where(sql`deleted_at IS NULL AND pinned = true`),
    index("idx_feed_posts_company_author")
      .on(t.companyId, t.authorUserId, sql`${t.createdAt} DESC`)
      .where(sql`deleted_at IS NULL`),
    // §0.5 — hai index keyset của BE-1.
    index("idx_feed_posts_company_activity")
      .on(t.companyId, sql`${t.lastActivityAt} DESC`, t.id)
      .where(sql`deleted_at IS NULL AND status = 'published'`),
    index("idx_feed_posts_company_published")
      .on(t.companyId, sql`${t.publishedAt} DESC`, t.id)
      .where(sql`deleted_at IS NULL AND status = 'published'`),
    index("idx_feed_posts_search").using("gin", t.searchVector),
  ],
);

export type FeedPost = typeof feedPosts.$inferSelect;
export type NewFeedPost = typeof feedPosts.$inferInsert;

// ─── feed_comments — bình luận 1 cấp (mutable, soft-delete; DB-17 §6.2) ────────────────────────
export const feedComments = pgTable(
  "feed_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => feedPosts.id),
    /** ⚠️ MỘT CẤP ép ở SERVICE: kiểm `parent.parent_comment_id IS NULL` cùng tx ⇒ SOCIAL-ERR-005. */
    parentCommentId: uuid("parent_comment_id"),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    authorEmployeeId: uuid("author_employee_id").references(() => employeeProfiles.id),
    body: text("body").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check("chk_feed_comments_body_len", sql`length(body) <= 5000`),
    check("chk_feed_comments_like_count", sql`like_count >= 0`),
    unique("feed_comments_company_id_id_uq").on(t.companyId, t.id),
    index("idx_feed_comments_company_post")
      .on(t.companyId, t.postId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
    index("idx_feed_comments_company_parent")
      .on(t.companyId, t.parentCommentId)
      .where(sql`deleted_at IS NULL AND parent_comment_id IS NOT NULL`),
  ],
);

export type FeedComment = typeof feedComments.$inferSelect;
export type NewFeedComment = typeof feedComments.$inferInsert;

// ─── feed_tags — từ điển hashtag (KHÔNG xoá; DB-17 §6.5) ───────────────────────────────────────
export const feedTags = pgTable(
  "feed_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Đã chuẩn hoá ở service: lowercase, bỏ `#`. */
    tag: varchar("tag", { length: 64 }).notNull(),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("chk_feed_tags_usage", sql`usage_count >= 0`),
    unique("feed_tags_company_tag_uq").on(t.companyId, t.tag),
    unique("feed_tags_company_id_id_uq").on(t.companyId, t.id),
    index("idx_feed_tags_company_usage").on(t.companyId, sql`${t.usageCount} DESC`),
  ],
);

export type FeedTag = typeof feedTags.$inferSelect;
export type NewFeedTag = typeof feedTags.$inferInsert;

// ─── feed_post_tags — nối bài↔thẻ, PK TỔ HỢP (không cột id; DB-17 §6.6) ────────────────────────
export const feedPostTags = pgTable(
  "feed_post_tags",
  {
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => feedPosts.id),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => feedTags.id),
  },
  (t) => [
    primaryKey({ name: "feed_post_tags_pk", columns: [t.companyId, t.postId, t.tagId] }),
    index("idx_feed_post_tags_company_tag").on(t.companyId, t.tagId),
  ],
);

export type FeedPostTag = typeof feedPostTags.$inferSelect;
export type NewFeedPostTag = typeof feedPostTags.$inferInsert;

// ─── feed_reactions — thích ĐA HÌNH post|comment (DB-17 §6.3) ──────────────────────────────────
export const feedReactions = pgTable(
  "feed_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 16 }).$type<FeedTargetType>().notNull(),
    /** ⚠️ KHÔNG FK: đích đa hình (feed_posts | feed_comments) — Postgres không có FK đa hình.
     *  Toàn vẹn ép ở service + dọn theo trong cùng tx khi xoá mềm bài/bình luận (DB-17 R1). */
    targetId: uuid("target_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** ⚠️ CỐ Ý KHÔNG CÓ CHECK ở DB — nguồn sự thật là hằng `CHAT_REACTION_EMOJIS` dùng chung với CHAT
     *  (communication.ts). Sao vào CHECK = đẻ nguồn sự thật thứ hai. Lưới nằm ở Zod/service
     *  ⇒ SOCIAL-ERR-006. Đây là NGOẠI LỆ DUY NHẤT của luật mirror CHECK↔Zod (DB-17 §6.3/§8). */
    emoji: varchar("emoji", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("chk_feed_reactions_target", sql`target_type IN ('post', 'comment')`),
    unique("feed_reactions_target_user_uq").on(t.companyId, t.targetType, t.targetId, t.userId),
    index("idx_feed_reactions_company_target").on(t.companyId, t.targetType, t.targetId),
  ],
);

export type FeedReaction = typeof feedReactions.$inferSelect;
export type NewFeedReaction = typeof feedReactions.$inferInsert;

// ─── feed_mentions — bảng THẬT (không lặp nợ task_comment_mentions; DB-17 §6.4) ────────────────
export const feedMentions = pgTable(
  "feed_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 16 }).$type<FeedTargetType>().notNull(),
    /** Đa hình như feed_reactions — KHÔNG FK. */
    targetId: uuid("target_id").notNull(),
    // Bảng chỉ-INSERT/DELETE ⇒ CẢ HAI cột dùng NO ACTION ở SQL (DB-17 §4.2b nhóm 3).
    mentionedUserId: uuid("mentioned_user_id")
      .notNull()
      .references(() => users.id),
    mentionedEmployeeId: uuid("mentioned_employee_id").references(() => employeeProfiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("chk_feed_mentions_target", sql`target_type IN ('post', 'comment')`),
    unique("feed_mentions_uq").on(t.companyId, t.targetType, t.targetId, t.mentionedUserId),
    index("idx_feed_mentions_company_user").on(
      t.companyId,
      t.mentionedUserId,
      sql`${t.createdAt} DESC`,
    ),
  ],
);

export type FeedMention = typeof feedMentions.$inferSelect;
export type NewFeedMention = typeof feedMentions.$inferInsert;

// ─── feed_saved_posts — "đã lưu" cá nhân, PK TỔ HỢP (DB-17 §6.7) ───────────────────────────────
export const feedSavedPosts = pgTable(
  "feed_saved_posts",
  {
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    postId: uuid("post_id")
      .notNull()
      .references(() => feedPosts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "feed_saved_posts_pk", columns: [t.companyId, t.userId, t.postId] }),
    index("idx_feed_saved_posts_company_user").on(t.companyId, t.userId, sql`${t.createdAt} DESC`),
  ],
);

export type FeedSavedPost = typeof feedSavedPosts.$inferSelect;
export type NewFeedSavedPost = typeof feedSavedPosts.$inferInsert;

// ─── feed_post_views — SỔ lượt xem APPEND-ONLY, PK TỔ HỢP (DB-17 §6.8) ─────────────────────────
/**
 * ⚠️ App role CHỈ có SELECT + INSERT. Ghi bằng `ON CONFLICT DO NOTHING` ⇒ reload KHÔNG tăng
 * `feed_posts.view_count`. KHÔNG bump `feed_posts.last_activity_at` từ đây (plan §0.5).
 */
export const feedPostViews = pgTable(
  "feed_post_views",
  {
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => feedPosts.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "feed_post_views_pk", columns: [t.companyId, t.postId, t.userId] }),
    index("idx_feed_post_views_company_post").on(t.companyId, t.postId),
  ],
);

export type FeedPostView = typeof feedPostViews.$inferSelect;
export type NewFeedPostView = typeof feedPostViews.$inferInsert;

// ─── feed_post_acks — SỔ xác nhận đã đọc tin APPEND-ONLY, PK TỔ HỢP (DB-17 §6.9) ───────────────
/** ⚠️ App role CHỈ có SELECT + INSERT — xác nhận đã đọc là vết KHÔNG rút lại được. */
export const feedPostAcks = pgTable(
  "feed_post_acks",
  {
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => feedPosts.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    ackedAt: timestamp("acked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "feed_post_acks_pk", columns: [t.companyId, t.postId, t.userId] }),
    index("idx_feed_post_acks_company_post").on(t.companyId, t.postId),
  ],
);

export type FeedPostAck = typeof feedPostAcks.$inferSelect;
export type NewFeedPostAck = typeof feedPostAcks.$inferInsert;

// ─── feed_reports — báo cáo vi phạm (mutable, KHÔNG soft-delete; DB-17 §6.10) ──────────────────
export const feedReports = pgTable(
  "feed_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 16 }).$type<FeedTargetType>().notNull(),
    /** Đa hình như feed_reactions — KHÔNG FK. */
    targetId: uuid("target_id").notNull(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => users.id),
    reason: varchar("reason", { length: 32 }).$type<FeedReportReason>().notNull(),
    note: text("note"),
    status: varchar("status", { length: 16 }).$type<FeedReportStatus>().notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("chk_feed_reports_target", sql`target_type IN ('post', 'comment')`),
    check(
      "chk_feed_reports_reason",
      sql`reason IN ('spam', 'harassment', 'inappropriate', 'misinformation', 'other')`,
    ),
    check("chk_feed_reports_status", sql`status IN ('open', 'resolved', 'dismissed')`),
    // "Đã xử lý" thì phải có người xử lý VÀ mốc thời gian — CHECK cặp dạng kéo theo.
    check(
      "chk_feed_reports_resolved_pair",
      sql`status = 'open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)`,
    ),
    unique("feed_reports_company_id_id_uq").on(t.companyId, t.id),
    // CHỐT CUỐI: 1 người báo cáo 1 đối tượng 1 lần khi còn 'open' (partial UNIQUE INDEX).
    uniqueIndex("feed_reports_open_uq")
      .on(t.companyId, t.targetType, t.targetId, t.reporterUserId)
      .where(sql`status = 'open'`),
    index("idx_feed_reports_company_status").on(t.companyId, t.status, sql`${t.createdAt} DESC`),
  ],
);

export type FeedReport = typeof feedReports.$inferSelect;
export type NewFeedReport = typeof feedReports.$inferInsert;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SOCIAL Track B (DB-17 §7 · migration 0580) — 9 bảng. PARITY-only như Track A.
// Thứ tự KHAI BÁO theo chiều FK (nhóm → thành viên → bình chọn → sáng kiến → catalog huy hiệu →
// vinh danh → người nhận) để `.references()` không phải trỏ ngược; `feedPosts.groupId` là forward-ref
// DUY NHẤT (hợp lệ: drizzle giải callback `() => …` LƯỜI, đúng cách khai FK vòng của thư viện).
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Mirror `chk_feed_groups_visibility`. */
export type FeedGroupVisibility = "public" | "private";
/** Mirror `chk_feed_group_members_role`. */
export type FeedGroupRole = "owner" | "admin" | "member";
/** Mirror `chk_feed_group_members_status`. */
export type FeedGroupMemberStatus = "active" | "pending";
/** Mirror `chk_feed_polls_status`. */
export type FeedPollStatus = "open" | "closed";
/** Mirror `chk_feed_ideas_status` — FSM ép ở SERVICE (assertIdeaTransition), CHECK chỉ giữ tập. */
export type FeedIdeaStatus = "submitted" | "under_review" | "accepted" | "rejected";

// ─── feed_groups — nhóm nội bộ (mutable, soft-delete; DB-17 §7.1) ──────────────────────────────
export const feedGroups = pgTable(
  "feed_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    visibility: varchar("visibility", { length: 16 }).$type<FeedGroupVisibility>().notNull(),
    /** Business FK nullable ⇒ composite FK NO ACTION (KHÔNG SET NULL — DB-17 §4.2b). */
    avatarFileId: uuid("avatar_file_id").references(() => files.id),
    /** Denormalized — bump CÙNG TX ở service, KHÔNG trigger (DB-17 §4.7). */
    memberCount: integer("member_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check("chk_feed_groups_visibility", sql`visibility IN ('public', 'private')`),
    check("chk_feed_groups_member_count", sql`member_count >= 0`),
    unique("feed_groups_company_id_id_uq").on(t.companyId, t.id),
    // Tên nhóm duy nhất trong công ty, không phân biệt hoa/thường, chỉ tính nhóm còn sống.
    uniqueIndex("feed_groups_company_name_uq")
      .on(t.companyId, sql`lower(${t.name})`)
      .where(sql`deleted_at IS NULL`),
    index("idx_feed_groups_company_visibility")
      .on(t.companyId, t.visibility)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type FeedGroup = typeof feedGroups.$inferSelect;
export type NewFeedGroup = typeof feedGroups.$inferInsert;

// ─── feed_group_members — thành viên nhóm, PK TỔ HỢP (DB-17 §7.2) ──────────────────────────────
/** ⚠️ Rời nhóm / mời-ra-nhóm = DELETE CỨNG có chủ ý (DB-17 §4.9) — vết nằm ở `audit_logs`
 *  (object_type='feed_group'), KHÔNG có cột `status='removed'`. Khoá owner CUỐI CÙNG của nhóm
 *  (SOCIAL-ERR-015) ép ở SERVICE — CHECK cấp hàng không đếm được hàng anh em. */
export const feedGroupMembers = pgTable(
  "feed_group_members",
  {
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => feedGroups.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    employeeId: uuid("employee_id").references(() => employeeProfiles.id),
    role: varchar("role", { length: 16 }).$type<FeedGroupRole>().notNull(),
    status: varchar("status", { length: 16 })
      .$type<FeedGroupMemberStatus>()
      .notNull()
      .default("pending"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("chk_feed_group_members_role", sql`role IN ('owner', 'admin', 'member')`),
    check("chk_feed_group_members_status", sql`status IN ('active', 'pending')`),
    // Yêu cầu chờ duyệt KHÔNG được mang vai trò quản trị (CHECK cặp dạng kéo theo).
    check("chk_feed_group_members_pending_role", sql`status = 'active' OR role = 'member'`),
    primaryKey({ name: "feed_group_members_pk", columns: [t.companyId, t.groupId, t.userId] }),
    // INDEX NÓNG NHẤT MODULE (SOC-DEC-006) — mọi truy vấn bài nhóm riêng tư lọc membership qua đây.
    index("idx_feed_group_members_company_group_role")
      .on(t.companyId, t.groupId, t.role)
      .where(sql`status = 'active'`),
    index("idx_feed_group_members_company_user").on(t.companyId, t.userId, t.status),
  ],
);

export type FeedGroupMember = typeof feedGroupMembers.$inferSelect;
export type NewFeedGroupMember = typeof feedGroupMembers.$inferInsert;

// ─── feed_polls — bình chọn 1-1 với bài type='poll' (DB-17 §7.3) ───────────────────────────────
export const feedPolls = pgTable(
  "feed_polls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => feedPosts.id),
    question: varchar("question", { length: 500 }).notNull(),
    /** ⚠️ BẤT BIẾN sau khi tạo — service PHẢI chặn UPDATE (D1): đổi giữa chừng làm chốt
     *  `feed_poll_votes_single_uq` sai lệch IM LẶNG (partial index không đọc được bảng khác). */
    multipleChoice: boolean("multiple_choice").notNull().default(false),
    /** ⚠️ BẤT BIẾN sau khi tạo — như trên (SPEC-16 §13.4). */
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    status: varchar("status", { length: 16 }).$type<FeedPollStatus>().notNull().default("open"),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("chk_feed_polls_status", sql`status IN ('open', 'closed')`),
    check("chk_feed_polls_closed_pair", sql`status = 'open' OR closed_at IS NOT NULL`),
    /** Hạn đóng phải ở TƯƠNG LAI so với lúc tạo; NULL = poll không hạn (giá trị HỢP LỆ, nên vế
     *  `IS NULL OR` ở đây KHÔNG phải mệnh đề thoát rỗng). Zod chỉ xấp xỉ được bằng
     *  `closesAt > now()` lúc validate — `created_at` chưa tồn tại khi đó. */
    check("chk_feed_polls_closes_future", sql`closes_at IS NULL OR closes_at > created_at`),
    unique("feed_polls_company_post_uq").on(t.companyId, t.postId),
    unique("feed_polls_company_id_id_uq").on(t.companyId, t.id),
    // Job đóng bình chọn theo hạn quét qua index này.
    index("idx_feed_polls_open_deadline")
      .on(t.companyId, t.closesAt)
      .where(sql`status = 'open' AND closes_at IS NOT NULL`),
  ],
);

export type FeedPoll = typeof feedPolls.$inferSelect;
export type NewFeedPoll = typeof feedPolls.$inferInsert;

// ─── feed_poll_options — lựa chọn, BẤT BIẾN sau khi tạo poll (DB-17 §7.4) ──────────────────────
/** Giới hạn 2-10 lựa chọn (SOCIAL-ERR-018) và "không sửa/thêm/xoá sau khi poll tồn tại" ép ở
 *  SERVICE — CHECK cấp hàng không đếm được hàng anh em, UNIQUE chỉ chặn trùng vị trí. */
export const feedPollOptions = pgTable(
  "feed_poll_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => feedPolls.id),
    label: varchar("label", { length: 255 }).notNull(),
    position: smallint("position").notNull(),
    /** Denormalized — bump CÙNG TX ở service, KHÔNG trigger. */
    voteCount: integer("vote_count").notNull().default(0),
  },
  (t) => [
    check("chk_feed_poll_options_vote_count", sql`vote_count >= 0`),
    unique("feed_poll_options_company_id_id_uq").on(t.companyId, t.id),
    // KHÔNG có index (companyId, pollId, position) rời: `feed_poll_options_position_uq` ngay trên
    // đã sinh index ngầm TRÙNG 100% (cùng cột, cùng thứ tự) — FULL gate DB-2 (M-1).
    unique("feed_poll_options_position_uq").on(t.companyId, t.pollId, t.position),
  ],
);

export type FeedPollOption = typeof feedPollOptions.$inferSelect;
export type NewFeedPollOption = typeof feedPollOptions.$inferInsert;

// ─── feed_poll_votes — phiếu, PK TỔ HỢP (DB-17 §7.5 · PHƯƠNG ÁN A) ─────────────────────────────
/** ⚠️ `userId` lưu KỂ CẢ poll ẩn danh nhưng KHÔNG BAO GIỜ ra DTO khi `isAnonymous` (SOC-DEC-009) —
 *  lưới ở tầng repository (tập cột tường minh). Đổi/rút phiếu = DELETE + INSERT cùng tx (không UPDATE). */
export const feedPollVotes = pgTable(
  "feed_poll_votes",
  {
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => feedPolls.id),
    optionId: uuid("option_id")
      .notNull()
      .references(() => feedPollOptions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** D1 — cột dẫn xuất = `NOT feedPolls.multipleChoice`, service ghi TƯỜNG MINH cùng câu INSERT.
     *  ⚠️ CỐ Ý KHÔNG DEFAULT: `default(false)` biến một lần quên ghi thành vô hiệu hoá chốt
     *  chống-phiếu-đôi IM LẶNG (fail-open). Không default ⇒ hỏng thì ăn 23502 (fail-closed). */
    singleChoice: boolean("single_choice").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "feed_poll_votes_pk",
      columns: [t.companyId, t.pollId, t.optionId, t.userId],
    }),
    // CHỐT CUỐI chống phiếu đôi ở poll một-lựa-chọn (partial UNIQUE INDEX theo cột dẫn xuất).
    uniqueIndex("feed_poll_votes_single_uq")
      .on(t.companyId, t.pollId, t.userId)
      .where(sql`single_choice`),
    // KHÔNG dùng (companyId, pollId): prefix chặt của PK ⇒ index PK đã phục vụ. Cột thứ ba làm nó
    // trả lời được "tôi đã bỏ phiếu gì trong poll này" cho poll ĐA-lựa-chọn (single_uq là partial).
    index("idx_feed_poll_votes_company_poll_user").on(t.companyId, t.pollId, t.userId),
  ],
);

export type FeedPollVote = typeof feedPollVotes.$inferSelect;
export type NewFeedPollVote = typeof feedPollVotes.$inferInsert;

// ─── feed_ideas — sáng kiến 1-1 với bài type='idea' (DB-17 §7.6) ───────────────────────────────
/** FSM `submitted → under_review → accepted|rejected` (2 trạng thái cuối TERMINAL) ép ở SERVICE
 *  bằng `assertIdeaTransition` ⇒ SOCIAL-ERR-019. CHECK chỉ giữ TẬP GIÁ TRỊ + tính đầy đủ của vết. */
export const feedIdeas = pgTable(
  "feed_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => feedPosts.id),
    status: varchar("status", { length: 16 }).$type<FeedIdeaStatus>().notNull(),
    /** Vết kiểm toán nullable ⇒ composite FK SET NULL (reviewed_by) — DB-17 §4.2b. */
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "chk_feed_ideas_status",
      sql`status IN ('submitted', 'under_review', 'accepted', 'rejected')`,
    ),
    check(
      "chk_feed_ideas_reviewed_pair",
      sql`status IN ('submitted', 'under_review') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)`,
    ),
    check(
      "chk_feed_ideas_reject_note",
      sql`status <> 'rejected' OR (review_note IS NOT NULL AND length(btrim(review_note)) > 0)`,
    ),
    unique("feed_ideas_company_post_uq").on(t.companyId, t.postId),
    unique("feed_ideas_company_id_id_uq").on(t.companyId, t.id),
    index("idx_feed_ideas_company_status").on(t.companyId, t.status, sql`${t.createdAt} DESC`),
  ],
);

export type FeedIdea = typeof feedIdeas.$inferSelect;
export type NewFeedIdea = typeof feedIdeas.$inferInsert;

// ─── feed_kudos_badges — CATALOG huy hiệu per-company (DB-17 §7.9; seed 5 mã ở mig 0582) ───────
/** ⚠️ "Xoá" = `UPDATE is_active = false` (BẤT BIẾN #2) — app role KHÔNG có DELETE, bảng KHÔNG có
 *  `deleted_at` (catalog). Công ty tạo SAU 0582 được seeder runtime `social.master-data` lo (nợ BE-2). */
export const feedKudosBadges = pgTable(
  "feed_kudos_badges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    /** Tên icon lucide (khớp packages/ui) — mỹ quan thuần tuý, FE đổi bằng UPDATE. */
    icon: varchar("icon", { length: 64 }),
    isActive: boolean("is_active").notNull().default(true),
    position: smallint("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("feed_kudos_badges_company_code_uq").on(t.companyId, t.code),
    unique("feed_kudos_badges_company_id_id_uq").on(t.companyId, t.id),
    index("idx_feed_kudos_badges_company_active").on(t.companyId, t.isActive, t.position),
  ],
);

export type FeedKudosBadge = typeof feedKudosBadges.$inferSelect;
export type NewFeedKudosBadge = typeof feedKudosBadges.$inferInsert;

// ─── feed_kudos — vinh danh 1-1 với bài type='kudos' (DB-17 §7.7) ──────────────────────────────
export const feedKudos = pgTable(
  "feed_kudos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => feedPosts.id),
    /** Business FK nullable ⇒ composite FK NO ACTION (huy hiệu ngừng dùng = is_active=false). */
    badgeId: uuid("badge_id").references(() => feedKudosBadges.id),
    message: text("message"),
    isOfficial: boolean("is_official").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("feed_kudos_company_post_uq").on(t.companyId, t.postId),
    unique("feed_kudos_company_id_id_uq").on(t.companyId, t.id),
    index("idx_feed_kudos_company_created").on(t.companyId, sql`${t.createdAt} DESC`),
  ],
);

export type FeedKudos = typeof feedKudos.$inferSelect;
export type NewFeedKudos = typeof feedKudos.$inferInsert;

// ─── feed_kudos_recipients — người được vinh danh, PK TỔ HỢP (DB-17 §7.8) ──────────────────────
/** ⚠️ Sửa bài kudos ⇒ GÁN LẠI người nhận: app role có DELETE + INSERT, KHÔNG UPDATE.
 *  Bảng KHÔNG có `created_at` — `RetentionService._deleteEligible` lọc theo `created_at` sẽ ăn 42703
 *  TRƯỚC khi tới guard, nên bảng vẫn PHẢI nằm trong `PROTECTED_TABLES` (chống-mất-dữ-liệu), nhưng
 *  KHÔNG được đọc thành "đã chặn 42xxx uncaught" (khuôn đính chính của feed_post_tags ở DB-1). */
export const feedKudosRecipients = pgTable(
  "feed_kudos_recipients",
  {
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    kudosId: uuid("kudos_id")
      .notNull()
      .references(() => feedKudos.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id),
  },
  (t) => [
    primaryKey({
      name: "feed_kudos_recipients_pk",
      columns: [t.companyId, t.kudosId, t.employeeId],
    }),
    index("idx_feed_kudos_recipients_company_emp").on(t.companyId, t.employeeId),
  ],
);

export type FeedKudosRecipient = typeof feedKudosRecipients.$inferSelect;
export type NewFeedKudosRecipient = typeof feedKudosRecipients.$inferInsert;
