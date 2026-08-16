/**
 * S10-ATT-NOTIPROD-1 — unit (mocked deps, KHÔNG DB thật) cho AttendanceAlertNotiJobHandler.
 *
 * ALLOW trước DENY: test 1 dựng đường THÀNH CÔNG (phát đúng DTO cho ứng viên hợp lệ) trước khi kiểm các
 * nhánh chặn (chốt #2 tx lồng, chốt #16 throttle theo company, actor-exclusion, lỗi không nuốt câm).
 */

import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalEventIntakeDto } from "@mediaos/contracts";
import { SYSTEM_JOB_HANDLER } from "../scheduler/job-handler";
import { AttendanceAlertNotiJobHandler } from "./attendance-alert-noti.job-handler";
import type {
  AttAlertCandidateBundle,
  AttendanceAlertNotiRepository,
} from "./attendance-alert-noti.repository";
import type { DatabaseService, TenantTx } from "../db/db.service";
import type { NotificationEngineService } from "../notifications/notification-engine.service";
import {
  ATT_ALERT_DETECT_JOB_CODE,
  ATT_MISSING_CHECKOUT_EVENT,
} from "./attendance-alert-noti.logic";

const FAKE_TX = {} as TenantTx;
const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";
const EMPLOYEE_USER_ID = "33333333-3333-3333-3333-333333333333";

const EMPTY_BUNDLE: AttAlertCandidateBundle = {
  missingCheckout: [],
  late: [],
  absent: [],
  skippedNoEmployeeMapping: 0,
  skippedNoShift: 0,
  skippedNoWorkDays: 0,
};

function makeOneMissingCheckoutBundle(): AttAlertCandidateBundle {
  return {
    ...EMPTY_BUNDLE,
    missingCheckout: [
      { id: "rec-1", userId: EMPLOYEE_USER_ID, workDate: "2026-08-10", fullName: "Nguyễn Văn A" },
    ],
  };
}

interface Harness {
  handler: AttendanceAlertNotiJobHandler;
  db: { withTenant: ReturnType<typeof vi.fn> };
  repo: {
    materializeCandidatesTx: ReturnType<typeof vi.fn>;
    findExistingDedupeKeysTx: ReturnType<typeof vi.fn>;
  };
  engine: { intake: ReturnType<typeof vi.fn> };
  callOrder: string[];
}

function buildHarness(bundle: AttAlertCandidateBundle = EMPTY_BUNDLE): Harness {
  const callOrder: string[] = [];

  const repo = {
    materializeCandidatesTx: vi.fn(async () => {
      callOrder.push("materializeCandidatesTx");
      return bundle;
    }),
    findExistingDedupeKeysTx: vi.fn(async () => {
      callOrder.push("findExistingDedupeKeysTx");
      return new Set<string>();
    }),
  };

  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: TenantTx) => Promise<unknown>) => {
      callOrder.push("withTenant:open");
      const result = await fn(FAKE_TX);
      callOrder.push("withTenant:close");
      return result;
    }),
  };

  const engine = {
    intake: vi.fn(async (_companyId: string, _dto: InternalEventIntakeDto) => {
      callOrder.push("intake");
      return { createdCount: 1, skippedCount: 0, dedupedCount: 0 };
    }),
  };

  const handler = new AttendanceAlertNotiJobHandler(
    db as unknown as DatabaseService,
    engine as unknown as NotificationEngineService,
    repo as unknown as AttendanceAlertNotiRepository,
  );

  return { handler, db, repo, engine, callOrder };
}

describe("AttendanceAlertNotiJobHandler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * [CHỐT #9 — nửa unit, KHÔNG cần DB] Mirror `dashboard-mv-refresh.job-handler.spec.ts:27-37` + đóng
   * gói vá cho `attendance-alert-noti-producer.int.spec.ts:495` (đúng ca nhưng DB-gated, `skipIf(!hasDb)`
   * ⇒ CI thiếu `LANE_DB` là suite này không chạy — bài học "XANH KHÔNG ĐỦ BẰNG CHỨNG", CLAUDE.md §9).
   * Ghim GIÁ TRỊ chuỗi job code, KHÔNG chỉ ghim TÊN hằng (bài học index-ratchet-must-pin-definition-not-name):
   * `@SystemJobHandler()` gắn metadata `SYSTEM_JOB_HANDLER=true` lên class — `WorkerSchedulerService`
   * (`discoverJobHandlers()`, worker-scheduler.service.ts:107) CHỈ gom provider có đúng metadata này. Rớt
   * decorator (vô tình xoá `@SystemJobHandler()` khi refactor) ⇒ producer NGỪNG CHẠY VĨNH VIỄN, KHÔNG lỗi
   * nào nổi lên, và 0 test khác trong file này bắt được (chúng `new` thẳng handler, bỏ qua discovery).
   */
  it("[CHỐT #9] jobCode + @SystemJobHandler() metadata đăng ký đúng khuôn (DiscoveryService gom qua metadata)", () => {
    expect(ATT_ALERT_DETECT_JOB_CODE).toBe("ATT_ALERT_DETECT");
    const { handler } = buildHarness(EMPTY_BUNDLE);
    expect(handler.jobCode).toBe(ATT_ALERT_DETECT_JOB_CODE);
    expect(Reflect.getMetadata(SYSTEM_JOB_HANDLER, AttendanceAlertNotiJobHandler)).toBe(true);
  });

  it("ALLOW: ứng viên hợp lệ ⇒ intake() ĐÚNG 1 lần, KHÔNG actorUserId, recipient = chính nhân viên", async () => {
    const { handler, engine } = buildHarness(makeOneMissingCheckoutBundle());

    const result = await handler.run({ companyId: COMPANY_A });

    expect(result.success).toBe(1);
    expect(result.failed).toBe(0);
    expect(engine.intake).toHaveBeenCalledTimes(1);
    const [companyIdArg, dto] = engine.intake.mock.calls[0] as [string, InternalEventIntakeDto];
    expect(companyIdArg).toBe(COMPANY_A);
    expect(dto.eventCode).toBe(ATT_MISSING_CHECKOUT_EVENT);
    expect(dto.recipient).toEqual({
      mode: "UserIds",
      userIds: [EMPLOYEE_USER_ID],
      employeeIds: [],
    });
    // Chống bẫy notification-recipient-resolver.service.ts:49-51 (actor-exclusion, isSystemEvent=false).
    expect(dto.actorUserId).toBeUndefined();
    expect("actorUserId" in dto).toBe(false);
    expect(dto.payload).toEqual({ work_date: "2026-08-10", employee_name: "Nguyễn Văn A" });
  });

  it("[CHỐT #2] 0 lời gọi intake() nằm TRONG callback withTenant — materialize ĐÓNG tx trước, intake chạy SAU", async () => {
    const { handler, callOrder } = buildHarness(makeOneMissingCheckoutBundle());

    await handler.run({ companyId: COMPANY_A });

    const closeIdx = callOrder.indexOf("withTenant:close");
    const intakeIdx = callOrder.indexOf("intake");
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(intakeIdx).toBeGreaterThan(closeIdx);
  });

  it("[CHỐT #16] throttle khoá THEO companyId — tick 2 CÙNG company trong cửa sổ ⇒ 0 truy vấn/0 intake, company KHÁC trong CÙNG tick vẫn được quét", async () => {
    const { handler, repo, engine } = buildHarness(EMPTY_BUNDLE);

    const first = await handler.run({ companyId: COMPANY_A });
    expect(first.metadata?.["skipped"]).toBeUndefined();
    expect(repo.materializeCandidatesTx).toHaveBeenCalledTimes(1);

    const second = await handler.run({ companyId: COMPANY_A });
    expect(second.metadata).toMatchObject({ skipped: true, reason: "not-due" });
    expect(repo.materializeCandidatesTx).toHaveBeenCalledTimes(1); // KHÔNG gọi thêm
    expect(engine.intake).not.toHaveBeenCalled();

    // Company KHÁC trong CÙNG tick — PHẢI được quét (per-company Map, KHÔNG field cấp-instance).
    const otherCompany = await handler.run({ companyId: COMPANY_B });
    expect(otherCompany.metadata?.["skipped"]).toBeUndefined();
    expect(repo.materializeCandidatesTx).toHaveBeenCalledTimes(2);
  });

  it("[CHỐT #16] qua cửa sổ throttle (>= interval mặc định) ⇒ chạy lại bình thường", async () => {
    const { handler, repo } = buildHarness(EMPTY_BUNDLE);

    await handler.run({ companyId: COMPANY_A });
    expect(repo.materializeCandidatesTx).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-08-11T12:00:01.000Z")); // + 24h + 1s > DEFAULT_ATT_ALERT_DETECT_INTERVAL_MS
    await handler.run({ companyId: COMPANY_A });
    expect(repo.materializeCandidatesTx).toHaveBeenCalledTimes(2);
  });

  it("nhánh lỗi (silent-failure): intake() ném cho 1 ứng viên ⇒ GHI LOG ERROR, TIẾP TỤC ứng viên còn lại, failed đếm đúng", async () => {
    const bundle: AttAlertCandidateBundle = {
      ...EMPTY_BUNDLE,
      missingCheckout: [
        { id: "rec-fail", userId: EMPLOYEE_USER_ID, workDate: "2026-08-10", fullName: "A" },
        { id: "rec-ok", userId: EMPLOYEE_USER_ID, workDate: "2026-08-10", fullName: "B" },
      ],
    };
    const { handler, engine } = buildHarness(bundle);
    engine.intake
      .mockImplementationOnce(async () => {
        throw new Error("boom");
      })
      .mockImplementationOnce(async () => ({ createdCount: 1, skippedCount: 0, dedupedCount: 0 }));

    const result = await handler.run({ companyId: COMPANY_A });

    expect(engine.intake).toHaveBeenCalledTimes(2); // KHÔNG dừng cả lượt vì 1 bản ghi lỗi
    expect(result.failed).toBe(1);
    expect(result.success).toBe(1);
    expect(result.total).toBe(2);
  });

  it("[CHỐT #7] loại tập 'đã từng phát' TRƯỚC khi intake — dedupeKey đã tồn tại ⇒ 0 intake cho ứng viên đó", async () => {
    const { handler, repo, engine } = buildHarness(makeOneMissingCheckoutBundle());
    repo.findExistingDedupeKeysTx.mockResolvedValueOnce(
      new Set(["ATT_MISSING_CHECKOUT:rec-1:2026-08-10"]),
    );

    const result = await handler.run({ companyId: COMPANY_A });

    expect(engine.intake).not.toHaveBeenCalled();
    expect(result.total).toBe(0);
    expect(result.metadata?.["alreadyNotified"]).toBe(1);
  });
});
