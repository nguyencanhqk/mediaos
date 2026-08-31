import { isNotNull, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { employeeProfiles } from "./employees";
import { orgUnits } from "./org";
import { positions } from "./positions";
import { users } from "./users";

/**
 * RECRUIT (DB-14 §6 / SPEC-12) — 8 bảng module tuyển dụng, tạo mới từ số không ở migration 0559
 * (seed role/quyền/audit 0560 · NOTI 0561). Inference dưới đây PARITY với migration — Drizzle KHÔNG
 * mô tả RLS/grant/policy/composite FK; migration là chuẩn. KHÔNG db:generate (sẽ DROP cụm media/finance park).
 *
 * company_id NOT NULL (BẤT BIẾN #1): RLS ENABLE + FORCE + policy literal-GUC `tenant_isolation`
 *   (USING + WITH CHECK) cả 8 bảng. Mọi query qua withTenant(companyId, fn). MỌI FK chéo bảng nghiệp vụ
 *   là COMPOSITE `(company_id, col) → parent(company_id, id)` ở SQL (KI-046 — FK Postgres không áp RLS);
 *   `.references()` một cột dưới đây CHỈ để suy kiểu.
 *
 * BẤT BIẾN #2: `candidate_stage_events` là SỔ APPEND-ONLY tuyệt đối — app role SELECT/INSERT, KHÔNG
 *   UPDATE/DELETE. `interview_participants` chỉ SELECT/INSERT (cố định lúc xếp lịch — đổi người = huỷ lượt
 *   + tạo lượt mới). `interview_feedbacks`/`offers` UPDATE CẤP CỘT. Không bảng RECRUIT nào có DELETE cho
 *   app role (job_openings/candidates/candidate_notes soft-delete = UPDATE; interviews/offers terminal-status).
 *
 * BẤT BIẾN #3: email/phone ứng viên + salary offer là PII/nhạy cảm — MASK Ở SERVER (SPEC-12 §18);
 *   payload NOTI/audit không chứa các trường này.
 *
 * CHỐT CUỐI ở DB (FSM ép ở service — CHECK chỉ giữ tập giá trị):
 *   uq_candidates_company_employee (double-convert — REC-DEC-005, KHÔNG partial theo deleted_at) ·
 *   uq_offers_candidate_open (1 offer Draft/Sent mỗi ứng viên — RECRUIT-ERR-006) ·
 *   uq_interview_feedbacks (1 feedback/interviewer — RECRUIT-ERR-012) · uq_interview_participants.
 */

// ─── job_openings — vị trí tuyển dụng (mutable, soft-delete; FSM 4 trạng thái SPEC-01 §17.12) ───
/** Mirror `chk_job_openings_status`; nguồn DTO = packages/contracts recruit.ts. */
export type JobOpeningStatus = "Draft" | "Open" | "Paused" | "Closed";

export const jobOpenings = pgTable(
  "job_openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    // composite FK → org_units/positions (company_id, id) NO ACTION.
    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnits.id),
    positionId: uuid("position_id").references(() => positions.id),
    headcount: integer("headcount").notNull().default(1),
    // recruiter phụ trách — composite SET NULL (recruiter_user_id); đổi ⇒ NOTI-EVENT-016.
    recruiterUserId: uuid("recruiter_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 20 }).$type<JobOpeningStatus>().notNull().default("Draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    // v1 KHÔNG có endpoint xoá (DB-14 §6.2 ghi chú M9) — cột giữ theo chuẩn §16.2, mở đường PARK-RECRUIT-001.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check("chk_job_openings_status", sql`status IN ('Draft', 'Open', 'Paused', 'Closed')`),
    check("chk_job_openings_headcount", sql`headcount > 0`),
    // UNIQUE (company_id, id) — đích composite FK của candidates (constraint job_openings_company_id_id_uq ở SQL).
    index("idx_job_openings_company_status")
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
    index("idx_job_openings_company_org")
      .on(t.companyId, t.orgUnitId)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type JobOpening = typeof jobOpenings.$inferSelect;
export type NewJobOpening = typeof jobOpenings.$inferInsert;

// ─── candidates — ứng viên (mutable, soft-delete REC-DEC-007; PII mask ở server) ───────────────
/** Mirror `chk_candidates_stage` (SPEC-01 §17.11); FSM §13.1 ép ở service. */
export type CandidateStage = "New" | "Screening" | "Interview" | "Offer" | "Hired" | "Rejected";

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    jobOpeningId: uuid("job_opening_id")
      .notNull()
      .references(() => jobOpenings.id),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    // PII — mask ở server (SPEC-12 §18); KHÔNG unique (trùng = cảnh báo mềm §4.8).
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 30 }),
    source: varchar("source", { length: 120 }),
    note: text("note"),
    stage: varchar("stage", { length: 20 }).$type<CandidateStage>().notNull().default("New"),
    // link convert 1-1 — UNIQUE partial uq_candidates_company_employee (chốt cuối double-convert).
    employeeId: uuid("employee_id").references(() => employeeProfiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "chk_candidates_stage",
      sql`stage IN ('New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected')`,
    ),
    // CHỐT CUỐI REC-DEC-005: kể cả hồ sơ đã xoá mềm — CỐ Ý KHÔNG partial theo deleted_at.
    uniqueIndex("uq_candidates_company_employee")
      .on(t.companyId, t.employeeId)
      .where(sql`employee_id IS NOT NULL`),
    index("idx_candidates_company_stage_job")
      .on(t.companyId, t.stage, t.jobOpeningId)
      .where(sql`deleted_at IS NULL`),
    // Check-duplicate (RECRUIT-API-008): index đúng BIỂU THỨC service so sánh; KHÔNG partial deleted_at
    // (cảnh báo tính cả hồ sơ đã xoá mềm — DB-14 §6.2).
    // `isNotNull` thay vì sql`email IS NOT NULL`: cùng DDL, không nới vùng mù `rawSqlIdentity`
    // của identity-projection-ratchet (bộ đếm bắt MỌI template `sql` chứa chữ email).
    index("idx_candidates_company_email_expr")
      .on(t.companyId, sql`lower(${t.email})`)
      .where(isNotNull(t.email)),
    index("idx_candidates_company_phone_norm")
      .on(t.companyId, sql`regexp_replace(${t.phone}, '[^0-9+]', '', 'g')`)
      .where(sql`phone IS NOT NULL`),
  ],
);

export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;

// ─── candidate_stage_events — SỔ lịch sử stage APPEND-ONLY (bất biến #2) ───────────────────────
/** Mirror `chk_cse_action` — hàng convert là `Offer → Hired` duy nhất. */
export type CandidateStageAction = "move" | "convert";

export const candidateStageEvents = pgTable(
  "candidate_stage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    fromStage: varchar("from_stage", { length: 20 }).$type<CandidateStage>().notNull(),
    toStage: varchar("to_stage", { length: 20 }).$type<CandidateStage>().notNull(),
    action: varchar("action", { length: 10 }).$type<CandidateStageAction>().notNull(),
    // bắt buộc (SPEC-12 §13.1) — kanban luôn mở hộp lý do.
    reason: text("reason").notNull(),
    // FK users NO ACTION (bảng chỉ-INSERT — SET NULL của RI action sẽ ghi đè cột không có grant UPDATE).
    actedBy: uuid("acted_by").references(() => users.id),
    actedAt: timestamp("acted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "chk_cse_from",
      sql`from_stage IN ('New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected')`,
    ),
    check(
      "chk_cse_to",
      sql`to_stage IN ('New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected')`,
    ),
    check("chk_cse_moved", sql`from_stage <> to_stage`),
    check("chk_cse_action", sql`action IN ('move', 'convert')`),
    index("idx_cse_company_candidate_time").on(t.companyId, t.candidateId, sql`${t.actedAt} DESC`),
  ],
);

export type CandidateStageEvent = typeof candidateStageEvents.$inferSelect;
export type NewCandidateStageEvent = typeof candidateStageEvents.$inferInsert;

// ─── candidate_notes — ghi chú nội bộ (soft-delete; sửa/xoá CỦA MÌNH — service so created_by) ──
export const candidateNotes = pgTable(
  "candidate_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_candidate_notes_company_candidate")
      .on(t.companyId, t.candidateId, sql`${t.createdAt} DESC`)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type CandidateNote = typeof candidateNotes.$inferSelect;
export type NewCandidateNote = typeof candidateNotes.$inferInsert;

// ─── interviews — lượt phỏng vấn (FSM 3 trạng thái §17.13; KHÔNG soft delete — huỷ = Cancelled) ─
/** Mirror `chk_interviews_status`. */
export type InterviewStatus = "Scheduled" | "Completed" | "Cancelled";

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    round: integer("round").notNull().default(1),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    // CHECK chk_interviews_range (> starts_at); service kiểm trước — RECRUIT-ERR-013.
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // text/link tự do (REC-DEC-006).
    location: varchar("location", { length: 500 }),
    note: text("note"),
    status: varchar("status", { length: 20 })
      .$type<InterviewStatus>()
      .notNull()
      .default("Scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check("chk_interviews_status", sql`status IN ('Scheduled', 'Completed', 'Cancelled')`),
    check("chk_interviews_range", sql`ends_at > starts_at`),
    check("chk_interviews_round", sql`round > 0`),
    // UNIQUE (company_id, id) — đích composite FK của participants/feedbacks (interviews_company_id_id_uq ở SQL).
    index("idx_interviews_company_candidate").on(
      t.companyId,
      t.candidateId,
      sql`${t.startsAt} DESC`,
    ),
    index("idx_interviews_company_start").on(t.companyId, t.startsAt),
  ],
);

export type Interview = typeof interviews.$inferSelect;
export type NewInterview = typeof interviews.$inferInsert;

// ─── interview_participants — SỔ interviewer, CHỈ INSERT (đổi người = huỷ lượt + tạo mới §3.6) ──
export const interviewParticipants = pgTable(
  "interview_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id),
    // chân own-scope (EXISTS participant theo employee của caller) + NOTI-EVENT-017.
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_interview_participants").on(t.companyId, t.interviewId, t.employeeId),
    index("idx_interview_participants_employee").on(t.companyId, t.employeeId),
  ],
);

export type InterviewParticipant = typeof interviewParticipants.$inferSelect;
export type NewInterviewParticipant = typeof interviewParticipants.$inferInsert;

// ─── interview_feedbacks — đánh giá per-interviewer (UPDATE cấp cột; own-scope ở service) ──────
/** Mirror `chk_feedback_reco`. */
export type InterviewRecommendation = "Hire" | "No Hire" | "Consider";

export const interviewFeedbacks = pgTable(
  "interview_feedbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id),
    // own-scope: service so employee của caller (RECRUIT-ERR-011).
    interviewerEmployeeId: uuid("interviewer_employee_id")
      .notNull()
      .references(() => employeeProfiles.id),
    rating: smallint("rating").notNull(),
    comment: text("comment"),
    recommendation: varchar("recommendation", { length: 20 })
      .$type<InterviewRecommendation>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("chk_feedback_rating", sql`rating BETWEEN 1 AND 5`),
    check("chk_feedback_reco", sql`recommendation IN ('Hire', 'No Hire', 'Consider')`),
    // CHỐT CUỐI RECRUIT-ERR-012: mỗi interviewer một feedback/lượt.
    uniqueIndex("uq_interview_feedbacks").on(t.companyId, t.interviewId, t.interviewerEmployeeId),
  ],
);

export type InterviewFeedback = typeof interviewFeedbacks.$inferSelect;
export type NewInterviewFeedback = typeof interviewFeedbacks.$inferInsert;

// ─── offers — offer (FSM 5 trạng thái §17.14; UPDATE cấp cột; salary mask theo ('manage','offer')) ─
/** Mirror `chk_offers_status`. */
export type OfferStatus = "Draft" | "Sent" | "Accepted" | "Declined" | "Withdrawn";

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    title: varchar("title", { length: 255 }),
    // map sang ngày vào làm khi convert (SPEC-12 §13.5).
    startDate: date("start_date").notNull(),
    // NHẠY CẢM — chỉ trả cho ('manage','offer') (SPEC-12 §18); vắng khoá với người khác.
    salary: numeric("salary", { precision: 18, scale: 2 }).notNull(),
    note: text("note"),
    status: varchar("status", { length: 20 }).$type<OfferStatus>().notNull().default("Draft"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "chk_offers_status",
      sql`status IN ('Draft', 'Sent', 'Accepted', 'Declined', 'Withdrawn')`,
    ),
    check("chk_offers_salary", sql`salary >= 0`),
    // Terminal ⇒ responded_at NOT NULL; Draft/Sent ⇒ NULL — "vào terminal" là MỘT câu UPDATE đủ 2 cột.
    check(
      "chk_offers_responded_pair",
      sql`(status IN ('Draft', 'Sent') AND responded_at IS NULL) OR (status IN ('Accepted', 'Declined', 'Withdrawn') AND responded_at IS NOT NULL)`,
    ),
    // CHỐT CUỐI RECRUIT-ERR-006: một ứng viên một offer đang sống.
    uniqueIndex("uq_offers_candidate_open")
      .on(t.companyId, t.candidateId)
      .where(sql`status IN ('Draft', 'Sent')`),
    index("idx_offers_company_candidate_time").on(
      t.companyId,
      t.candidateId,
      sql`${t.createdAt} DESC`,
    ),
  ],
);

export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
