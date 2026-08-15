/**
 * S10-ATT-NOTIPROD-1 — Integration (Postgres THẬT, DB CÔ LẬP). Đóng RELEASE-02 §KI-021: 3 sự kiện
 * `ATT_MISSING_CHECKOUT` / `ATT_LATE_DETECTED` / `ATT_ABSENT_DETECTED` seed `isEnabled:true` nhưng KHÔNG
 * ai phát — chứng minh producer THẬT tồn tại, đi ĐÚNG đường `NotificationEngineService.intake()`, idempotent
 * theo kỳ, cô lập tenant, và deep-link/nội dung không câm.
 *
 * ALLOW TRƯỚC DENY (bài học deny-cases-vacuous-without-allow-case). Gate cứng `hasDb && LANE_DB`
 * (memory integration-test-lane-db-gate) — thiếu LANE_DB ⇒ SKIP (không đỏ-giả trên DB dev chung).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import { seedCompany, seedUser, type SeededTenant } from "../../test/helpers/seed";
import { addDaysToLocalDate, localDateOf } from "../common/tz.util";
import { AttendanceAlertNotiJobHandler } from "./attendance-alert-noti.job-handler";

const runDb = hasDb && Boolean(process.env.LANE_DB);

// Ca 7 ngày/tuần (workDays=[1..7]) — TRÁNH flaky theo thứ chạy CI thật (không phụ thuộc "hôm nay là thứ mấy").
const ALL_WEEK_DAYS = "[1,2,3,4,5,6,7]";
const VN_TZ = "Asia/Ho_Chi_Minh";

describe.skipIf(!runDb)(
  "S10-ATT-NOTIPROD-1 — AttendanceAlertNotiJobHandler (DB cô lập, producer thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let handler: AttendanceAlertNotiJobHandler;
    const companyIds: string[] = [];
    const today = localDateOf(new Date(), VN_TZ);
    const yesterday = addDaysToLocalDate(today, -1);
    const longAgo = addDaysToLocalDate(today, -30);

    async function seedDefaultShift(companyId: string): Promise<void> {
      await direct.query(
        `INSERT INTO shifts
         (company_id, shift_code, name, start_time, end_time, break_minutes, required_working_minutes,
          grace_late_minutes, grace_early_leave_minutes, cross_day, work_days, status, is_default)
       VALUES ($1, 'OFFICE_8H', 'Giờ hành chính', '08:00', '17:00', 60, 480, 5, 5, false, $2, 'Active', true)`,
        [companyId, ALL_WEEK_DAYS],
      );
    }

    async function seedActiveEmployee(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
        [companyId, userId],
      );
      return r.rows[0].id as string;
    }

    async function seedMissingCheckoutRecord(
      companyId: string,
      userId: string,
      workDate: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status, check_in_at)
       VALUES ($1, $2, $3, 'present', $3::date + time '08:05')
       RETURNING id`,
        [companyId, userId, workDate],
      );
      return r.rows[0].id as string;
    }

    async function seedLateRecord(
      companyId: string,
      userId: string,
      workDate: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, check_in_at, check_out_at, is_late, late_minutes)
       VALUES ($1, $2, $3, 'late', $3::date + time '08:30', $3::date + time '17:00', true, 25)
       RETURNING id`,
        [companyId, userId, workDate],
      );
      return r.rows[0].id as string;
    }

    /**
     * Test-only: xoá khoá throttle in-memory (chốt #16) của `companyId` để gọi `handler.run()` NHIỀU LẦN
     * LIÊN TIẾP trong CÙNG 1 test đo đúng idempotency Ở TẦNG DB (dedupe_key) — throttle chính nó đã được
     * chứng minh riêng ở attendance-alert-noti.job-handler.spec.ts (mock), KHÔNG lặp lại ở đây.
     */
    function bypassThrottle(companyId: string): void {
      (
        handler as unknown as { lastRunAtMsByCompany: Map<string, number> }
      ).lastRunAtMsByCompany.delete(companyId);
    }

    async function notificationsFor(companyId: string, eventCode: string) {
      const r = await direct.query(
        `SELECT id, event_code, target_url, body, dedupe_key, recipient_user_id, deleted_at
         FROM notifications WHERE company_id = $1 AND event_code = $2 ORDER BY created_at`,
        [companyId, eventCode],
      );
      return r.rows as Array<{
        id: string;
        event_code: string;
        target_url: string | null;
        body: string;
        dedupe_key: string | null;
        recipient_user_id: string;
        deleted_at: Date | null;
      }>;
    }

    beforeAll(async () => {
      if (!runDb) return;
      direct = directPool();
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      handler = app.get(AttendanceAlertNotiJobHandler);
    });

    afterAll(async () => {
      if (!runDb) return;
      for (const id of companyIds) {
        await direct.query("DELETE FROM companies WHERE id = $1", [id]).catch(() => undefined);
      }
      await direct.end();
      await app.close();
    });

    it("ALLOW: check-in không check-out của ngày ĐÃ ĐÓNG (hôm qua) ⇒ ATT_MISSING_CHECKOUT cho ĐÚNG nhân viên", async () => {
      const t = await seedCompany(direct, "att-noti-mco");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      await seedActiveEmployee(t.companyId, userId);
      await seedDefaultShift(t.companyId);
      const recordId = await seedMissingCheckoutRecord(t.companyId, userId, yesterday);

      const result = await handler.run({ companyId: t.companyId });
      expect(result.failed).toBe(0);

      const rows = await notificationsFor(t.companyId, "ATT_MISSING_CHECKOUT");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_user_id).toBe(userId);
      expect(rows[0].target_url).toBe("/attendance/today");
      expect(rows[0].body).not.toMatch(/\{[a-z_]+\}/);
      expect(rows[0].dedupe_key).toBe(`ATT_MISSING_CHECKOUT:${recordId}:${yesterday}`);

      // Idempotent theo KỲ: chạy lại NGAY ⇒ KHÔNG tạo thêm. (bypassThrottle: đo dedupe Ở TẦNG DB, KHÔNG
      // để throttle chốt #16 — đã test riêng ở job-handler.spec.ts — che mất lời gọi thật thứ 2.)
      bypassThrottle(t.companyId);
      await handler.run({ companyId: t.companyId });
      expect(await notificationsFor(t.companyId, "ATT_MISSING_CHECKOUT")).toHaveLength(1);

      // [CHỐT #7] chống hồi sinh: soft-delete rồi chạy lại ⇒ KHÔNG tạo lại.
      await direct.query("UPDATE notifications SET deleted_at = now() WHERE id = $1", [rows[0].id]);
      bypassThrottle(t.companyId);
      await handler.run({ companyId: t.companyId });
      const after = await notificationsFor(t.companyId, "ATT_MISSING_CHECKOUT");
      expect(after).toHaveLength(1);
      expect(after[0].deleted_at).not.toBeNull();
    });

    it("ALLOW: is_late=true của ngày ĐÃ ĐÓNG ⇒ ATT_LATE_DETECTED", async () => {
      const t = await seedCompany(direct, "att-noti-late");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      await seedActiveEmployee(t.companyId, userId);
      await seedDefaultShift(t.companyId);
      await seedLateRecord(t.companyId, userId, yesterday);

      await handler.run({ companyId: t.companyId });

      const rows = await notificationsFor(t.companyId, "ATT_LATE_DETECTED");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_user_id).toBe(userId);
      expect(rows[0].target_url).toBe("/attendance/today");
      expect(rows[0].body).not.toMatch(/\{[a-z_]+\}/);
    });

    it("[CHỐT #12] bản ghi late đã KHOÁ SỔ (locked_at) ⇒ 0 ATT_LATE_DETECTED", async () => {
      const t = await seedCompany(direct, "att-noti-locked");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      await seedActiveEmployee(t.companyId, userId);
      await seedDefaultShift(t.companyId);
      await direct.query(
        `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, check_in_at, check_out_at, is_late, late_minutes, locked_at)
       VALUES ($1, $2, $3, 'late', $3::date + time '08:30', $3::date + time '17:00', true, 25, now())`,
        [t.companyId, userId, yesterday],
      );

      await handler.run({ companyId: t.companyId });

      expect(await notificationsFor(t.companyId, "ATT_LATE_DETECTED")).toHaveLength(0);
    });

    it("ALLOW: nhân viên active có ca, không bản ghi cho ngày ĐÃ ĐÓNG ⇒ ATT_ABSENT_DETECTED", async () => {
      const t = await seedCompany(direct, "att-noti-absent");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      const employeeId = await seedActiveEmployee(t.companyId, userId);
      await seedDefaultShift(t.companyId);

      await handler.run({ companyId: t.companyId });

      const rows = await notificationsFor(t.companyId, "ATT_ABSENT_DETECTED");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_user_id).toBe(userId);
      expect(rows[0].dedupe_key).toBe(`ATT_ABSENT_DETECTED:${employeeId}:${yesterday}`);
    });

    it("[CHỐT #13] record ĐÃ soft-delete cho ngày đó vẫn tính 'ĐÃ CÓ DỮ LIỆU' ⇒ 0 ATT_ABSENT_DETECTED", async () => {
      const t = await seedCompany(direct, "att-noti-softdel");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      await seedActiveEmployee(t.companyId, userId);
      await seedDefaultShift(t.companyId);
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status, deleted_at)
       VALUES ($1, $2, $3, 'absent', now())`,
        [t.companyId, userId, yesterday],
      );

      await handler.run({ companyId: t.companyId });

      expect(await notificationsFor(t.companyId, "ATT_ABSENT_DETECTED")).toHaveLength(0);
    });

    it("DENY: leave_requests status='approved' CHỮ THƯỜNG phủ ngày ⇒ 0 ATT_ABSENT_DETECTED", async () => {
      const t = await seedCompany(direct, "att-noti-leave");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      await seedActiveEmployee(t.companyId, userId);
      await seedDefaultShift(t.companyId);
      const leaveType = await direct.query(
        `INSERT INTO leave_types (company_id, name, code) VALUES ($1, 'Nghỉ phép năm', 'ANNUAL') RETURNING id`,
        [t.companyId],
      );
      await direct.query(
        `INSERT INTO leave_requests (company_id, user_id, leave_type_id, start_date, end_date, total_days, status)
       VALUES ($1, $2, $3, $4, $4, 1, 'approved')`,
        [t.companyId, userId, leaveType.rows[0].id, yesterday],
      );

      await handler.run({ companyId: t.companyId });

      expect(await notificationsFor(t.companyId, "ATT_ABSENT_DETECTED")).toHaveLength(0);
    });

    it("DENY: ngày lễ (public_holidays GLOBAL, company_id NULL) ⇒ 0 ATT_ABSENT_DETECTED cho CẢ CÔNG TY", async () => {
      const t = await seedCompany(direct, "att-noti-holiday");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      await seedActiveEmployee(t.companyId, userId);
      await seedDefaultShift(t.companyId);
      // company_id=NULL (GLOBAL) — bảng KHÔNG cascade-delete theo company (chốt #20), PHẢI tự dọn ở CUỐI
      // test (finally) để KHÔNG rò sang test khác trong CÙNG file chạy trên CÙNG DB (mọi test đều dùng
      // chung mốc `yesterday`).
      const holiday = await direct.query(
        `INSERT INTO public_holidays (company_id, holiday_code, name, holiday_date, status, affects_attendance)
       VALUES (NULL, $1, 'Ngày lễ test', $2, 'Active', true) RETURNING id`,
        [`HOL-${randomUUID().slice(0, 8)}`, yesterday],
      );
      try {
        await handler.run({ companyId: t.companyId });

        expect(await notificationsFor(t.companyId, "ATT_ABSENT_DETECTED")).toHaveLength(0);
      } finally {
        await direct.query("DELETE FROM public_holidays WHERE id = $1", [holiday.rows[0].id]);
      }
    });

    it("Bán kính có trần: vắng mặt 30 ngày trước KHÔNG được quét (KHÔNG backfill) — 0 notification cho ngày đó", async () => {
      const t = await seedCompany(direct, "att-noti-radius");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      await seedActiveEmployee(t.companyId, userId);
      await seedDefaultShift(t.companyId);
      // Chặn nhánh absent-hôm-qua (không phải mục tiêu ca này) bằng 1 record present cho `yesterday`.
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status, check_in_at, check_out_at)
       VALUES ($1, $2, $3, 'present', $3::date + time '08:00', $3::date + time '17:00')`,
        [t.companyId, userId, yesterday],
      );
      // Record missing-checkout 30 ngày trước — NGOÀI cửa sổ quét (chốt #25).
      await seedMissingCheckoutRecord(t.companyId, userId, longAgo);

      await handler.run({ companyId: t.companyId });

      expect(await notificationsFor(t.companyId, "ATT_MISSING_CHECKOUT")).toHaveLength(0);
      expect(await notificationsFor(t.companyId, "ATT_ABSENT_DETECTED")).toHaveLength(0);
    });

    it("Cô lập tenant: company A có ứng viên vắng mặt, company B KHÔNG nhận gì khi chạy job cho A", async () => {
      const a = await seedCompany(direct, "att-noti-tenant-a");
      const b = await seedCompany(direct, "att-noti-tenant-b");
      companyIds.push(a.companyId, b.companyId);
      const userA = await seedUser(direct, a.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      const userB = await seedUser(direct, b.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      await seedActiveEmployee(a.companyId, userA);
      await seedActiveEmployee(b.companyId, userB);
      await seedDefaultShift(a.companyId);
      await seedDefaultShift(b.companyId);

      await handler.run({ companyId: a.companyId });

      expect(await notificationsFor(a.companyId, "ATT_ABSENT_DETECTED")).toHaveLength(1);
      expect(await notificationsFor(b.companyId, "ATT_ABSENT_DETECTED")).toHaveLength(0);
    });
  },
);
