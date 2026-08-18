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
import { seedCompany, seedUser } from "../../test/helpers/seed";
import { addDaysToLocalDate, localDateOf, weekdayOfLocalDate } from "../common/tz.util";
import { AttendanceAlertNotiJobHandler } from "./attendance-alert-noti.job-handler";
import { ATT_ALERT_DETECT_JOB_CODE } from "./attendance-alert-noti.logic";
import { SYSTEM_JOB_HANDLER } from "../scheduler/job-handler";
import { WorkerSchedulerService } from "../scheduler/worker-scheduler.service";

const runDb = hasDb && Boolean(process.env.LANE_DB);

const VN_TZ = "Asia/Ho_Chi_Minh";

/** Ngày local (VN) đọc MỘT LẦN — nguồn duy nhất cho cả `work_days` của ca seed lẫn mốc `today` bên dưới. */
const TODAY_LOCAL = localDateOf(new Date(), VN_TZ);

/** Ca 7 ngày/tuần — chỉ dùng cho ca CỐ Ý đo nhánh hôm-nay ("[cửa sổ quét]"), xem docblock ngay dưới. */
const ALL_WEEK_DAYS = "[1,2,3,4,5,6,7]";

/**
 * work_days của ca seed mặc định = mọi thứ trong tuần **TRỪ thứ của HÔM NAY** (vẫn không phụ thuộc
 * "hôm nay là thứ mấy" — đó là lý do bản đầu dùng [1..7]).
 *
 * VÌ SAO PHẢI TRỪ (flake theo GIỜ, đã làm CI ĐỎ THẬT 18/08/2026 — run 32125821794, 8 ca):
 * cửa sổ quét vắng mặt là `[today-1, today]` (`ATT_ALERT_LOOKBACK_DAYS = 1`, chốt #25 phủ ca đêm), và
 * NGÀY HÔM NAY trở thành "đã đóng" ngay khi `now >= 17:00` giờ VN = **10:00 UTC** — tức mọi lần chạy CI
 * buổi chiều/tối VN. Ca 7 ngày/tuần ⇒ hôm nay cũng là ngày làm ⇒ mỗi công ty nhận THÊM 1
 * `ATT_ABSENT_DETECTED` cho hôm nay, phá mọi assert đếm theo "chỉ hôm qua" (1→2, 0→1, 1→3).
 * Chạy trước 17:00 VN thì xanh, sau thì đỏ — xanh-giả đúng nửa ngày, KHÔNG phải lỗi sản phẩm.
 *
 * Bỏ thứ-của-hôm-nay ⇒ nhánh hôm-nay bị `isShiftWorkingDay` cắt SỚM, độc lập đồng hồ; `yesterday` là
 * thứ KHÁC (hai ngày liên tiếp không bao giờ cùng thứ) nên mọi ca cũ giữ nguyên ý nghĩa.
 * Nhánh hôm-nay KHÔNG bị bỏ quên: ca "[cửa sổ quét]" bên dưới đo nó bằng ca đóng lúc `00:00`
 * (đã đóng ở MỌI thời điểm trong ngày ⇒ deterministic, không lặp lại chính cái bẫy này).
 */
const WORK_DAYS_EXCEPT_TODAY = JSON.stringify(
  [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== weekdayOfLocalDate(TODAY_LOCAL)),
);

describe.skipIf(!runDb)(
  "S10-ATT-NOTIPROD-1 — AttendanceAlertNotiJobHandler (DB cô lập, producer thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let handler: AttendanceAlertNotiJobHandler;
    const companyIds: string[] = [];
    const today = TODAY_LOCAL;
    const yesterday = addDaysToLocalDate(today, -1);
    const longAgo = addDaysToLocalDate(today, -30);

    async function seedDefaultShift(companyId: string): Promise<void> {
      await direct.query(
        `INSERT INTO shifts
         (company_id, shift_code, name, start_time, end_time, break_minutes, required_working_minutes,
          grace_late_minutes, grace_early_leave_minutes, cross_day, work_days, status, is_default)
       VALUES ($1, 'OFFICE_8H', 'Giờ hành chính', '08:00', '17:00', 60, 480, 5, 5, false, $2, 'Active', true)`,
        [companyId, WORK_DAYS_EXCEPT_TODAY],
      );
    }

    /**
     * [CHỐT #6] `opts.startDate`/`opts.endDate` THUẦN ADDITIVE (mặc định NULL) — 8 ca cũ gọi hàm này
     * KHÔNG truyền tham số thứ 3 nên hành vi giữ nguyên. Dùng để dựng ca "cửa sổ hợp đồng" trên nhánh absent.
     */
    async function seedActiveEmployee(
      companyId: string,
      userId: string,
      opts?: { startDate?: string; endDate?: string },
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status, start_date, end_date)
       VALUES ($1, $2, 'active', $3, $4) RETURNING id`,
        [companyId, userId, opts?.startDate ?? null, opts?.endDate ?? null],
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

    /**
     * [CHỐT #12 — 3 ca còn thiếu] Mỗi ca clone ĐÚNG khuôn ca 'locked_at' ở trên, chỉ LẬT MỘT trường trên
     * bản ghi late hợp lệ (vẫn có check_in_at + check_out_at + is_late=true + late_minutes=25 ⇒ KHÔNG rơi
     * nhầm sang nhánh missing-checkout). Mỗi ca seed THÊM 1 ĐỐI CHỨNG (late record BÌNH THƯỜNG, không bị
     * lật cờ) trong CÙNG company/CÙNG lượt handler.run() — chống deny-xanh-rỗng (bài học
     * deny-cases-vacuous-without-allow-case): nếu handler ngừng chạy hoàn toàn thì đối chứng CŨNG 0 dòng,
     * test sẽ ĐỎ chứ không xanh giả.
     */
    it("[CHỐT #12] is_adjusted=true trên bản ghi late hợp lệ ⇒ 0 ATT_LATE_DETECTED cho người đó, ĐỐI CHỨNG vẫn nhận", async () => {
      const t = await seedCompany(direct, "att-noti-isadj");
      companyIds.push(t.companyId);
      const deniedUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      const controlUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      await seedActiveEmployee(t.companyId, deniedUserId);
      await seedActiveEmployee(t.companyId, controlUserId);
      await seedDefaultShift(t.companyId);
      await direct.query(
        `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, check_in_at, check_out_at, is_late, late_minutes, is_adjusted)
       VALUES ($1, $2, $3, 'late', $3::date + time '08:30', $3::date + time '17:00', true, 25, true)`,
        [t.companyId, deniedUserId, yesterday],
      );
      await seedLateRecord(t.companyId, controlUserId, yesterday);

      await handler.run({ companyId: t.companyId });

      const rows = await notificationsFor(t.companyId, "ATT_LATE_DETECTED");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_user_id).toBe(controlUserId);
    });

    it("[CHỐT #12] status='approved_adjustment' trên bản ghi late hợp lệ ⇒ 0 ATT_LATE_DETECTED cho người đó, ĐỐI CHỨNG vẫn nhận", async () => {
      const t = await seedCompany(direct, "att-noti-stadj");
      companyIds.push(t.companyId);
      const deniedUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      const controlUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      await seedActiveEmployee(t.companyId, deniedUserId);
      await seedActiveEmployee(t.companyId, controlUserId);
      await seedDefaultShift(t.companyId);
      await direct.query(
        `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, check_in_at, check_out_at, is_late, late_minutes)
       VALUES ($1, $2, $3, 'approved_adjustment', $3::date + time '08:30', $3::date + time '17:00', true, 25)`,
        [t.companyId, deniedUserId, yesterday],
      );
      await seedLateRecord(t.companyId, controlUserId, yesterday);

      await handler.run({ companyId: t.companyId });

      const rows = await notificationsFor(t.companyId, "ATT_LATE_DETECTED");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_user_id).toBe(controlUserId);
    });

    it("[CHỐT #12] attendance_status='Adjusted' trên bản ghi late hợp lệ ⇒ 0 ATT_LATE_DETECTED cho người đó, ĐỐI CHỨNG vẫn nhận", async () => {
      const t = await seedCompany(direct, "att-noti-stsadj");
      companyIds.push(t.companyId);
      const deniedUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      const controlUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      await seedActiveEmployee(t.companyId, deniedUserId);
      await seedActiveEmployee(t.companyId, controlUserId);
      await seedDefaultShift(t.companyId);
      await direct.query(
        `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, check_in_at, check_out_at, is_late, late_minutes, attendance_status)
       VALUES ($1, $2, $3, 'late', $3::date + time '08:30', $3::date + time '17:00', true, 25, 'Adjusted')`,
        [t.companyId, deniedUserId, yesterday],
      );
      await seedLateRecord(t.companyId, controlUserId, yesterday);

      await handler.run({ companyId: t.companyId });

      const rows = await notificationsFor(t.companyId, "ATT_LATE_DETECTED");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_user_id).toBe(controlUserId);
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

    /**
     * [cửa sổ quét] Neo nhánh mà `WORK_DAYS_EXCEPT_TODAY` cố ý cắt khỏi các ca khác: cửa sổ là
     * `[today-1, today]`, nên HÔM NAY cũng ra thông báo NGAY KHI ca của hôm nay đã đóng — đây là hành vi
     * CÓ CHỦ ĐÍCH (chốt #25 phủ ca đêm), không phải lỗi. Ca seed ở đây kết thúc `00:00` (cross_day=false)
     * ⇒ `isWorkDateClosed` đúng với MỌI thời điểm trong ngày ⇒ ca này KHÔNG phụ thuộc giờ chạy.
     * Xoá ca này = mất bằng chứng duy nhất cho nhánh hôm-nay.
     */
    it("[cửa sổ quét] ca đã đóng cho cả hôm nay ⇒ ATT_ABSENT_DETECTED cho HAI ngày [today-1, today]", async () => {
      const t = await seedCompany(direct, "att-noti-window");
      companyIds.push(t.companyId);
      const userId = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@t.local`);
      const employeeId = await seedActiveEmployee(t.companyId, userId);
      await direct.query(
        `INSERT INTO shifts
         (company_id, shift_code, name, start_time, end_time, break_minutes, required_working_minutes,
          grace_late_minutes, grace_early_leave_minutes, cross_day, work_days, status, is_default)
       VALUES ($1, 'ALWAYS_CLOSED', 'Ca đóng sổ lúc 00:00', '08:00', '00:00', 60, 480, 5, 5, false, $2, 'Active', true)`,
        [t.companyId, ALL_WEEK_DAYS],
      );

      await handler.run({ companyId: t.companyId });

      const rows = await notificationsFor(t.companyId, "ATT_ABSENT_DETECTED");
      expect([...rows.map((r) => r.dedupe_key)].sort()).toEqual(
        [
          `ATT_ABSENT_DETECTED:${employeeId}:${yesterday}`,
          `ATT_ABSENT_DETECTED:${employeeId}:${today}`,
        ].sort(),
      );
      expect(rows.every((r) => r.recipient_user_id === userId)).toBe(true);
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

    /**
     * [CHỐT #6 — 2 ca cửa sổ hợp đồng] `employee_profiles.start_date/end_date` so sánh CHUỖI với
     * `yesterday` (repository.ts:307-308). Mỗi ca seed THÊM 1 ĐỐI CHỨNG (employee active KHÔNG bị giới
     * hạn hợp đồng) trong CÙNG company/CÙNG lượt handler.run() — chống deny-xanh-rỗng: nếu handler ngừng
     * quét hoàn toàn thì đối chứng CŨNG 0 dòng, test ĐỎ chứ không xanh giả.
     */
    it("[CHỐT #6] employee start_date > ngày quét ⇒ 0 ATT_ABSENT_DETECTED cho người đó, ĐỐI CHỨNG vẫn nhận", async () => {
      const t = await seedCompany(direct, "att-noti-startdate");
      companyIds.push(t.companyId);
      const deniedUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      const controlUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      // start_date = hôm nay (> yesterday, ngày quét) ⇒ chưa vào làm khi ngày quét đóng sổ.
      await seedActiveEmployee(t.companyId, deniedUserId, { startDate: today });
      const controlEmployeeId = await seedActiveEmployee(t.companyId, controlUserId);
      await seedDefaultShift(t.companyId);

      await handler.run({ companyId: t.companyId });

      const rows = await notificationsFor(t.companyId, "ATT_ABSENT_DETECTED");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_user_id).toBe(controlUserId);
      expect(rows[0].dedupe_key).toBe(`ATT_ABSENT_DETECTED:${controlEmployeeId}:${yesterday}`);
    });

    it("[CHỐT #6] employee end_date < ngày quét ⇒ 0 ATT_ABSENT_DETECTED cho người đó, ĐỐI CHỨNG vẫn nhận", async () => {
      const t = await seedCompany(direct, "att-noti-enddate");
      companyIds.push(t.companyId);
      const deniedUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      const controlUserId = await seedUser(
        direct,
        t.companyId,
        `emp-${randomUUID().slice(0, 8)}@t.local`,
      );
      // end_date = hôm-kia (< yesterday, ngày quét) ⇒ đã nghỉ việc trước khi ngày quét đóng sổ.
      const dayBeforeYesterday = addDaysToLocalDate(yesterday, -1);
      await seedActiveEmployee(t.companyId, deniedUserId, { endDate: dayBeforeYesterday });
      const controlEmployeeId = await seedActiveEmployee(t.companyId, controlUserId);
      await seedDefaultShift(t.companyId);

      await handler.run({ companyId: t.companyId });

      const rows = await notificationsFor(t.companyId, "ATT_ABSENT_DETECTED");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipient_user_id).toBe(controlUserId);
      expect(rows[0].dedupe_key).toBe(`ATT_ABSENT_DETECTED:${controlEmployeeId}:${yesterday}`);
    });

    /**
     * [CHỐT #9 — nửa-container] Chứng minh handler THỰC SỰ được `WorkerSchedulerService` nhìn thấy, KHÔNG
     * chỉ tồn tại như 1 provider mồ côi (2 nửa hợp đồng đăng ký — thiếu nửa đầu ⇒ DiscoveryService không
     * gom ⇒ job KHÔNG BAO GIỜ chạy mà cũng không lỗi nào, giống hệt bài học ở leave-accrual.int.spec.ts:560).
     * `discoverJobHandlers()` là `private` (TS-only) NHƯNG thuần gom provider qua `DiscoveryService.getProviders()`
     * — KHÔNG đăng ký `setInterval`/side-effect nào (đối chiếu worker-scheduler.service.ts:100-115) — an toàn
     * gọi trực tiếp qua ép kiểu trong test, KHÔNG hạ xuống khuôn mock-only.
     */
    it("[CHỐT #9] handler ĐƯỢC scheduler nhìn thấy: metadata SYSTEM_JOB_HANDLER + discoverJobHandlers() chứa ATT_ALERT_DETECT", () => {
      expect(Reflect.getMetadata(SYSTEM_JOB_HANDLER, AttendanceAlertNotiJobHandler)).toBe(true);
      expect(typeof handler.run).toBe("function");

      const scheduler = app.get(WorkerSchedulerService);
      const handlers = (
        scheduler as unknown as { discoverJobHandlers(): Array<{ jobCode: string }> }
      ).discoverJobHandlers();
      const codes = handlers.map((h) => h.jobCode);

      expect(codes).toContain(ATT_ALERT_DETECT_JOB_CODE);
      expect(new Set(codes).size).toBe(codes.length);
    });
  },
);
