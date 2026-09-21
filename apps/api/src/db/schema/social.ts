import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
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
import { orgUnits } from "./org";
import { users } from "./users";

/**
 * SOCIAL Track A (DB-17 §6 / SPEC-16) — 10 bảng bảng-tin nội bộ, tạo mới từ số không ở migration 0577
 * (seed 14 cặp quyền `feed-*` 0578 · UNION-ADD audit object_type 0579). Inference dưới đây PARITY với
 * migration — Drizzle KHÔNG mô tả RLS/grant/policy/composite FK; migration là chuẩn.
 * ⚠️ KHÔNG `db:generate` (sẽ DROP cụm media/finance đang park).
 *
 * company_id NOT NULL (BẤT BIẾN #1): RLS ENABLE + FORCE + policy literal-GUC `tenant_isolation`
 *   (USING + WITH CHECK) cả 10 bảng. Mọi query qua withTenant(companyId, fn). MỌI FK chéo bảng nghiệp
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
 *   • `feedPosts.groupId` CHƯA có FK — `feed_groups` thuộc Track B (S16-SOCIAL-DB-2). DB-2 phải thêm
 *     `feed_posts_group_fk` composite; cổng nằm ở `s16-social-db1-invariants.int-spec.ts` (§7.5).
 *   • `publishedAt`/`lastActivityAt` là 2 cột MỐC SẮP XẾP cho keyset của BE-1 — `lastActivityAt` bump
 *     CÙNG TX khi có bình luận/reaction mới, ⚠️ KHÔNG bump theo `feed_post_views` (bump là biến
 *     «Hoạt động mới» thành «vừa có người xem»).
 *
 * CHỐT CUỐI ở DB (FSM/quy tắc nghiệp vụ ép ở service — CHECK chỉ giữ tập giá trị):
 *   `feed_reactions_target_user_uq` (thích đôi) · `feed_mentions_uq` · PK tổ hợp của
 *   `feed_post_tags`/`feed_saved_posts`/`feed_post_views`/`feed_post_acks` (gán đôi · lưu đôi · xem
 *   đôi · ack đôi) · `feed_reports_open_uq` partial (1 báo cáo `open` mỗi đối tượng/người báo).
 *   Bình luận MỘT CẤP ép ở SERVICE — CHECK cấp hàng không nhìn được hàng cha, trigger là bẫy đóng băng.
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
    /** ⚠️ CHƯA có FK — `feed_groups` là Track B (S16-SOCIAL-DB-2 phải thêm `feed_posts_group_fk`). */
    groupId: uuid("group_id"),
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
