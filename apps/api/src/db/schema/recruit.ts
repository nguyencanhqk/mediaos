import { sql } from "drizzle-orm";
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
 * RECRUIT (DB-14 §6 / SPEC-12) — 8 bảng module tuyển dụng. DDL/RLS+FORCE/policy/grant/composite tenant FK/
 * partial-index ở migration 0559 (seed role/quyền/audit 0560 · NOTI 0561). Inference dưới đây PARITY với
 * migration (Drizzle KHÔNG mô tả RLS/grant/policy/composite FK — migration là chuẩn). KHÔNG db:generate.
 *
 * company_id NOT NULL (BẤT BIẾN #1): RLS ENABLE + FORCE + policy tenant_isolation literal-GUC. Mọi query qua
 *   withTenant(companyId, fn). MỌI FK chéo bảng nghiệp vụ là COMPOSITE `(company_id, col) → parent(company_id, id)`
 *   ở SQL (KI-046 — kiểm tra FK của Postgres không áp RLS); `.references()` một cột dưới đây CHỈ để suy kiểu.
 *
 * BẤT BIẾN #2:
 *   • `candidate_stage_events` — SỔ APPEND-ONLY TUYỆT ĐỐI: app role SELECT + INSERT, **0 UPDATE, 0 DELETE**.
 *   • `interview_participants` — CHỈ SELECT + INSERT (đổi người = huỷ lượt + tạo lượt mới, SPEC-12 §3.6).
 *   • `interview_feedbacks` / `offers` — SELECT + INSERT + UPDATE **CẤP CỘT** (allowlist DB-14 §6.7/§6.8).
 *   • 4 bảng mutable (`job_openings` · `candidates` · `candidate_notes` · `interviews`) — SELECT/INSERT/UPDATE.
 *   • **KHÔNG bảng RECRUIT nào có DELETE** cho app role; soft delete = UPDATE `deleted_at`.
 *
 * BẤT BIẾN #3: DB lưu `candidates.email`/`phone` và `offers.salary` THÔ — **masking là việc của SERVER**
 *   (SPEC-12 §18): PII che trừ khi caller giữ ('update','candidate'); `salary` chỉ trả cho ('manage','offer').
 *
 * ⚠️ BẢN ĐỒ TÊN DB-14 → QUAN HỆ THẬT: `employees` → `employee_profiles` (erd-current A2). Ứng viên là người
 *   NGOÀI hệ thống ⇒ `candidates` KHÔNG có FK sang `users`; danh tính nội bộ (recruiter/interviewer) FK chuẩn.
 */

/** Vị trí tuyển dụng — FSM 4 trạng thái ép ở service (SPEC-01 §17.12), DB chỉ CHECK tập giá trị. */
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
    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnits.id),
    positionId: uuid("position_id").references(() => positions.id),
    headcount: integer("headcount").notNull().default(1),
    // Đổi ⇒ NOTI-EVENT-016 RECRUIT_JOB_ASSIGNED (dedupeKey theo LẦN gán — SPEC-12 §17).
    recruiterUserId: uuid("recruiter_user_id").references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).notNull().default("Draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    // v1 CHƯA có endpoint xoá — cột giữ theo chuẩn §16.2 + PARK-RECRUIT-001 (DB-14 §6.2 ghi chú M9).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_job_openings_company_status")
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
    index("idx_job_openings_company_org")
      .on(t.companyId, t.orgUnitId)
      .where(sql`deleted_at IS NULL`),
    check("chk_job_openings_status", sql`status IN ('Draft', 'Open', 'Paused', 'Closed')`),
    check("chk_job_openings_headcount", sql`headcount > 0`),
  ],
);

/** Hồ sơ ứng viên — stage là CỘT, lịch sử là SỔ (`candidate_stage_events`), đồng bộ trong CÙNG transaction. */
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
    // PII — mask ở SERVER. CỐ Ý KHÔNG unique (DB-14 §4.8): trùng là CẢNH BÁO MỀM, không phải lỗi.
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 30 }),
    source: varchar("source", { length: 120 }),
    note: text("note"),
    // New/Screening/Interview/Offer/Hired/Rejected — `Hired` CHỈ đạt được qua convert (RECRUIT-ERR-014).
    stage: varchar("stage", { length: 20 }).notNull().default("New"),
    // Link convert 1-1; chốt cuối double-convert = uq_candidates_company_employee.
    employeeId: uuid("employee_id").references(() => employeeProfiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    // CỐ Ý KHÔNG partial theo deleted_at (REC-DEC-005): hồ sơ đã xoá mềm vẫn giữ chỗ link nhân viên.
    uniqueIndex("uq_candidates_company_employee")
      .on(t.companyId, t.employeeId)
      .where(sql`employee_id IS NOT NULL`),
    index("idx_candidates_company_stage_job")
      .on(t.companyId, t.stage, t.jobOpeningId)
      .where(sql`deleted_at IS NULL`),
    // Check-duplicate (RECRUIT-API-008) — index BIỂU THỨC, service PHẢI dùng CÙNG biểu thức từng ký tự.
    // KHÔNG partial theo deleted_at: cảnh báo trùng tính cả hồ sơ đã xoá mềm (DB-14 §6.2).
    index("idx_candidates_company_email_expr")
      .on(t.companyId, sql`lower(email)`)
      .where(sql`email IS NOT NULL`),
    index("idx_candidates_company_phone_norm")
      .on(t.companyId, sql`regexp_replace(phone, '[^0-9+]', '', 'g')`)
      .where(sql`phone IS NOT NULL`),
    check(
      "chk_candidates_stage",
      sql`stage IN ('New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected')`,
    ),
  ],
);

/**
 * SỔ chuyển stage — APPEND-ONLY TUYỆT ĐỐI (bất biến #2). Mỗi move = UPDATE `candidates.stage` + INSERT hàng
 * này trong CÙNG transaction; KHÔNG trigger đồng bộ (trigger đóng băng là bẫy `frozen-table-triggers-break-db-init`).
 * `acted_by` FK users **NO ACTION** — SET NULL sẽ ghi đè cột không có grant UPDATE (DB-14 §4.2).
 */
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
    fromStage: varchar("from_stage", { length: 20 }).notNull(),
    toStage: varchar("to_stage", { length: 20 }).notNull(),
    // 'convert' LUÔN là Offer → Hired.
    action: varchar("action", { length: 10 }).notNull(),
    // BẮT BUỘC (SPEC-12 §13.1) — timeline không lý do là timeline nói dối.
    reason: text("reason").notNull(),
    actedBy: uuid("acted_by").references(() => users.id),
    actedAt: timestamp("acted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_cse_company_candidate_time").on(t.companyId, t.candidateId, t.actedAt.desc()),
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
  ],
);

/** Ghi chú nội bộ — sửa/xoá mềm "của mình" ép ở service (so `created_by`). CÓ đường ghi `deleted_at` thật. */
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
      .on(t.companyId, t.candidateId, t.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
  ],
);

/** Lượt phỏng vấn — FSM 3 trạng thái (SPEC-01 §17.13). KHÔNG soft-delete: huỷ = trạng thái `Cancelled`. */
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
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // text/link tự do (REC-DEC-006) — phòng họp thật là việc của ROOM, KHÔNG FK sang meeting_rooms.
    location: varchar("location", { length: 500 }),
    note: text("note"),
    status: varchar("status", { length: 20 }).notNull().default("Scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_interviews_company_candidate").on(t.companyId, t.candidateId, t.startsAt.desc()),
    index("idx_interviews_company_start").on(t.companyId, t.startsAt),
    check("chk_interviews_status", sql`status IN ('Scheduled', 'Completed', 'Cancelled')`),
    // service kiểm TRƯỚC và trả RECRUIT-ERR-013 (422); CHECK là chốt cuối.
    check("chk_interviews_range", sql`ends_at > starts_at`),
    check("chk_interviews_round", sql`round > 0`),
  ],
);

/**
 * Interviewer của lượt — CHỈ INSERT. Đây là CHÂN của own-scope `('view','interview')@Own`: ép bằng **EXISTS**
 * (KHÔNG JOIN — một lượt nhiều interviewer ⇒ JOIN nhân bản hàng, hỏng pagination).
 */
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

/** Đánh giá per-interviewer. Chốt cuối RECRUIT-ERR-012 = unique (company, lượt, interviewer). */
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
    // own-scope: service so employee của caller (RECRUIT-ERR-011 khi thấy lượt mà không tham gia).
    interviewerEmployeeId: uuid("interviewer_employee_id")
      .notNull()
      .references(() => employeeProfiles.id),
    rating: smallint("rating").notNull(),
    comment: text("comment"),
    recommendation: varchar("recommendation", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_interview_feedbacks").on(t.companyId, t.interviewId, t.interviewerEmployeeId),
    check("chk_feedback_rating", sql`rating BETWEEN 1 AND 5`),
    check("chk_feedback_reco", sql`recommendation IN ('Hire', 'No Hire', 'Consider')`),
  ],
);

/**
 * Offer — FSM 5 trạng thái (SPEC-01 §17.14). `salary` lưu THÔ, che ở service theo ('manage','offer').
 * ⚠️ `chk_offers_responded_pair` buộc "đổi sang terminal" là **MỘT** câu UPDATE (status + responded_at cùng lúc).
 */
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
    startDate: date("start_date").notNull(),
    salary: numeric("salary", { precision: 18, scale: 2 }).notNull(),
    note: text("note"),
    status: varchar("status", { length: 20 }).notNull().default("Draft"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    // Chốt cuối RECRUIT-ERR-006: một ứng viên MỘT offer đang sống (race 2 POST ⇒ 23505 → 409, không 500).
    uniqueIndex("uq_offers_candidate_open")
      .on(t.companyId, t.candidateId)
      .where(sql`status IN ('Draft', 'Sent')`),
    index("idx_offers_company_candidate_time").on(t.companyId, t.candidateId, t.createdAt.desc()),
    check(
      "chk_offers_status",
      sql`status IN ('Draft', 'Sent', 'Accepted', 'Declined', 'Withdrawn')`,
    ),
    check("chk_offers_salary", sql`salary >= 0`),
    check(
      "chk_offers_responded_pair",
      sql`(status IN ('Draft', 'Sent') AND responded_at IS NULL)
          OR (status IN ('Accepted', 'Declined', 'Withdrawn') AND responded_at IS NOT NULL)`,
    ),
  ],
);
