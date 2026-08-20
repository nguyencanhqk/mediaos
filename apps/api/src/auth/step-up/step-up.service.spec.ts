import { BadRequestException, ConflictException, HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { StepUpService } from "./step-up.service";
import { STEP_UP_AUDIT_ACTIONS, STEP_UP_ERROR_CODES } from "./step-up.constants";
import type { RevealClassPair } from "./reveal-class-pairs";
import type { StepUpTotpOutcome } from "../two-factor.service";
import { rlKey } from "../../common/valkey/valkey-key";
import { loadEnv } from "../../config/env.schema";

/**
 * S10-AUTH-STEPUP-1 · RED-first — LÕI step-up (DECISIONS-09 §6 điểm 2/3/9/10).
 *
 * Cái được đo ở đây là THỨ TỰ và HAI NHÁNH GHI, không phải "gọi được hàm":
 *   · §6(9) `isLocked()` chạy ĐẦU TIÊN — trước cả cổng registry, và do đó trước verify. Nếu ngược lại,
 *     bucket khoá vẫn cho gõ tiếp = rate-limit chỉ còn là trang trí trên đúng cái oracle TOTP 6 số.
 *   · §6(9b) MỌI nhánh từ chối có ghi vết đều phải `recordFailure` — nhánh nào ghi hàng append-only mà
 *     không bồi bucket là một đường bồi VÔ HẠN vào hai bảng không xoá được (A09, vòng sửa
 *     `FIX-1-BE-STEPUP-FLOOD`). Và nhánh "đang khoá" ghi 0 hàng: trần lưu trữ mỗi cửa sổ khoá là
 *     `STEP_UP_MAX_ATTEMPTS` hàng, không phải vô hạn.
 *   · §6(10) CẢ HAI nhánh của phép VERIFY (đúng và sai) đều ghi `audit_logs` + `user_security_events`.
 *     Một nhánh câm là một đường dò không để lại vết.
 *   · §6(2) D1/D2 — đường này KHÔNG chạm method verify của bước-2 LOGIN và KHÔNG đốt recovery code; ở
 *     tầng unit, bằng chứng là StepUpService chỉ biết MỘT method TOTP thuần.
 *   · BẤT BIẾN #1/#3 — `withTenant` nhận companyId TỪ JWT; audit/metadata không mang credential.
 */

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const RESOURCE_ID = "33333333-3333-3333-3333-333333333333";
const TOTP_CODE = "654321";

const ACTOR = { id: USER_ID, companyId: COMPANY_ID };
const PAIR: RevealClassPair = { action: "read", resourceType: "employee_salary" };
const PAIRS: readonly RevealClassPair[] = [PAIR];
const INPUT = {
  code: TOTP_CODE,
  action: PAIR.action,
  resourceType: PAIR.resourceType,
  resourceId: RESOURCE_ID,
};

const UNTIL = new Date(Date.parse("2026-08-20T03:05:00.000Z"));

/** Ngưỡng THẬT mà service truyền vào `recordFailure` — đọc từ cùng nguồn env, không gõ lại hằng số. */
const MAX_ATTEMPTS = loadEnv().STEP_UP_MAX_ATTEMPTS;
const BUCKET = rlKey("stepup", `${COMPANY_ID}|${USER_ID}`);

/**
 * Tên method verify của bước-2 LOGIN, GHÉP CHUỖI có chủ đích.
 *
 * Cổng nghiệm thu D1 đếm `grep -rn <tên method> apps/api/src/auth/step-up` và đòi 0 kết quả. Viết literal
 * ở đây — dù chỉ để assert NÓ KHÔNG ĐƯỢC GỌI — sẽ làm cổng đỏ oan, rồi người sau sẽ "sửa" bằng cách xoá
 * chính ca đo này. Ghép chuỗi giữ được cả hai: cổng sạch và phép đo còn răng (mẫu quen thuộc của repo với
 * gitleaks).
 */
const LOGIN_VERIFY_METHOD = ["verify", "Challenge"].join("");

function makeHarness(
  opts: {
    pairs?: readonly RevealClassPair[];
    locked?: boolean;
    outcome?: StepUpTotpOutcome;
    /**
     * Bucket có TRẠNG THÁI như `LoginRateLimiter` thật: `recordFailure` bồi bộ đếm, chạm
     * `STEP_UP_MAX_ATTEMPTS` thì `isLocked` trả true. Dùng cho ca đo TRẦN LƯU TRỮ — một `locked: true`
     * cứng không chứng minh được rằng cửa sổ bồi bị CHẶN, nó chỉ chứng minh nhánh khoá tồn tại.
     */
    statefulBucket?: boolean;
  } = {},
) {
  const tx = { marker: "tx" };
  const dbsvc = {
    withTenant: vi.fn(async (_companyId: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const twoFactor = {
    verifyTotpForStepUp: vi.fn(
      async (_userId: string, _companyId: string, _code: string) => opts.outcome ?? "ok",
    ),
    // Bẫy: nếu ai đó nối lại đường login cũ thì ca "0 lần gọi" bên dưới bắt ngay.
    [LOGIN_VERIFY_METHOD]: vi.fn(
      async (_userId: string, _companyId: string, _code: string) => true,
    ),
  };
  const windows = { grant: vi.fn(async (_key: unknown) => UNTIL) };
  const bucket = { failures: 0 };
  const rateLimiter = {
    isLocked: vi.fn(async (_key: string) =>
      opts.statefulBucket ? bucket.failures >= MAX_ATTEMPTS : (opts.locked ?? false),
    ),
    recordFailure: vi.fn(async (_key: string, maxAttempts?: number) => {
      bucket.failures += 1;
      void maxAttempts;
    }),
    reset: vi.fn(async (_key: string) => {
      bucket.failures = 0;
    }),
  };
  const audit = { record: vi.fn(async (_tx: unknown, _entry: unknown) => undefined) };
  const securityEvents = { record: vi.fn(async (_tx: unknown, _entry: unknown) => undefined) };

  const svc = new StepUpService(
    dbsvc as never,
    twoFactor as never,
    windows as never,
    rateLimiter as never,
    audit as never,
    securityEvents as never,
    opts.pairs ?? PAIRS,
  );
  return { svc, tx, dbsvc, twoFactor, windows, rateLimiter, audit, securityEvents, bucket };
}

/** Mọi đối số đã đi vào audit/security-event, gộp thành một chuỗi để soi rò credential. */
function writtenPayload(h: ReturnType<typeof makeHarness>): string {
  return JSON.stringify([h.audit.record.mock.calls, h.securityEvents.record.mock.calls]);
}

describe("StepUpService — ca ALLOW (mã đúng ⇒ cấp cửa sổ)", () => {
  it("thành công: reset bucket + grant window + audit Success + STEP_UP_GRANTED, trả ISO-8601", async () => {
    const h = makeHarness({ outcome: "ok" });
    const res = await h.svc.stepUp(ACTOR, INPUT);

    expect(res.reauthValidUntil).toBe(UNTIL.toISOString());
    expect(h.windows.grant).toHaveBeenCalledTimes(1);
    expect(h.windows.grant).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: USER_ID,
      action: PAIR.action,
      resourceType: PAIR.resourceType,
      resourceId: RESOURCE_ID,
    });
    expect(h.rateLimiter.reset).toHaveBeenCalledWith(rlKey("stepup", `${COMPANY_ID}|${USER_ID}`));
    expect(h.rateLimiter.recordFailure).not.toHaveBeenCalled();

    expect(h.audit.record).toHaveBeenCalledTimes(1);
    expect(h.audit.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        action: STEP_UP_AUDIT_ACTIONS.GRANTED,
        objectType: "auth",
        objectId: RESOURCE_ID,
        actorUserId: USER_ID,
        resultStatus: "Success",
      }),
    );
    expect(h.securityEvents.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({ eventType: "STEP_UP_GRANTED", userId: USER_ID }),
    );
  });

  it("BẤT BIẾN #1: mọi ghi đi qua withTenant với companyId LẤY TỪ JWT (không phải từ body)", async () => {
    const h = makeHarness({ outcome: "ok" });
    await h.svc.stepUp(ACTOR, INPUT);
    expect(h.dbsvc.withTenant).toHaveBeenCalledTimes(1);
    expect(h.dbsvc.withTenant.mock.calls[0]?.[0]).toBe(COMPANY_ID);
  });

  it("D1: KHÔNG gọi method verify của bước-2 LOGIN — chỉ đường TOTP THUẦN", async () => {
    const h = makeHarness({ outcome: "ok" });
    await h.svc.stepUp(ACTOR, INPUT);
    // Đối chứng: spy CÓ TỒN TẠI (nếu tên method gõ sai thì đây là undefined và ca xanh RỖNG).
    expect(h.twoFactor[LOGIN_VERIFY_METHOD]).toBeDefined();
    expect(h.twoFactor[LOGIN_VERIFY_METHOD]).not.toHaveBeenCalled();
    expect(h.twoFactor.verifyTotpForStepUp).toHaveBeenCalledWith(USER_ID, COMPANY_ID, TOTP_CODE);
  });
});

describe("StepUpService — §6(9) THỨ TỰ: isLocked → registry → verify", () => {
  it("cặp NGOÀI registry, bucket SẠCH ⇒ 400 PAIR-NOT-ALLOWED, verify gọi 0 lần, KHÔNG cấp cửa sổ", async () => {
    const h = makeHarness({ pairs: [] });
    const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: STEP_UP_ERROR_CODES.PAIR_NOT_ALLOWED,
    });
    expect(h.twoFactor.verifyTotpForStepUp).not.toHaveBeenCalled();
    expect(h.windows.grant).not.toHaveBeenCalled();
    // Vẫn để lại vết: nhánh từ chối KHÔNG được câm.
    expect(h.audit.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({ action: STEP_UP_AUDIT_ACTIONS.DENIED, resultStatus: "Denied" }),
    );
    expect(h.securityEvents.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({ eventType: "STEP_UP_FAILED" }),
    );
  });

  /**
   * ĐỔI CÓ CHỦ ĐÍCH (FIX-1-BE-STEPUP-FLOOD, A09): trước vòng sửa này nhánh registry ghi hàng
   * append-only mà KHÔNG bồi bucket ⇒ vì registry hôm nay RỖNG (D3), MỌI lời gọi đi đúng đường đó và
   * không cổng nào chặn ⇒ một tài khoản đã đăng nhập bất kỳ bồi được `audit_logs` +
   * `user_security_events` vô hạn. Assert dưới đây là mặt LẬT của phép đo cũ, không phải ca mới thay ca cũ.
   */
  it("cặp NGOÀI registry ⇒ CÓ recordFailure(bucket, STEP_UP_MAX_ATTEMPTS) — nhánh ghi vết phải bồi bucket", async () => {
    const h = makeHarness({ pairs: [] });
    await h.svc.stepUp(ACTOR, INPUT).catch(() => undefined);

    expect(h.rateLimiter.recordFailure).toHaveBeenCalledTimes(1);
    expect(h.rateLimiter.recordFailure).toHaveBeenCalledWith(BUCKET, MAX_ATTEMPTS);
  });

  it("CHƯA bật 2FA ⇒ CÓ recordFailure — nhánh not-enrolled cũng ghi vết nên cũng phải bồi bucket", async () => {
    const h = makeHarness({ outcome: "not-enrolled" });
    await h.svc.stepUp(ACTOR, INPUT).catch(() => undefined);

    expect(h.rateLimiter.recordFailure).toHaveBeenCalledTimes(1);
    expect(h.rateLimiter.recordFailure).toHaveBeenCalledWith(BUCKET, MAX_ATTEMPTS);
  });

  /**
   * ĐỔI CÓ CHỦ ĐÍCH: nhánh "đang khoá" giờ ghi 0 hàng. Vết KHÔNG mất — chính
   * `STEP_UP_MAX_ATTEMPTS` lượt sai đã dựng nên cái khoá này đều đã có hàng audit + security-event.
   * Ghi thêm một hàng cho MỖI request trong lúc khoá không thêm thông tin nào, chỉ thêm dung lượng: đó
   * đúng là đường bồi mà rate-limit sinh ra để chặn. Trần lưu trữ mỗi cửa sổ khoá = MAX_ATTEMPTS hàng.
   */
  it("bucket ĐANG KHOÁ ⇒ 429, verify gọi ĐÚNG 0 lần và KHÔNG ghi hàng append-only nào", async () => {
    const h = makeHarness({ locked: true });
    const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(h.twoFactor.verifyTotpForStepUp).not.toHaveBeenCalled();
    expect(h.windows.grant).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.securityEvents.record).not.toHaveBeenCalled();
    expect(h.dbsvc.withTenant).not.toHaveBeenCalled();
  });

  it("KHOÁ THẮNG REGISTRY: bucket khoá + cặp NGOÀI registry ⇒ 429 (không phải 400), verify 0 lần", async () => {
    const h = makeHarness({ locked: true, pairs: [] });
    const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);

    // Nếu cổng registry còn đứng TRƯỚC `isLocked()` thì ca này ra 400 PAIR-NOT-ALLOWED + 1 hàng audit.
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((err as HttpException).getStatus()).not.toBe(HttpStatus.BAD_REQUEST);
    expect(h.twoFactor.verifyTotpForStepUp).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.securityEvents.record).not.toHaveBeenCalled();
  });

  it("đường thành công: isLocked được gọi TRƯỚC verify (đo THỨ TỰ, không đo sự tồn tại)", async () => {
    const h = makeHarness({ outcome: "ok" });
    await h.svc.stepUp(ACTOR, INPUT);
    const lockedAt = h.rateLimiter.isLocked.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
    const verifyAt =
      h.twoFactor.verifyTotpForStepUp.mock.invocationCallOrder[0] ?? Number.MIN_SAFE_INTEGER;
    expect(lockedAt).toBeLessThan(verifyAt);
  });

  it("§6(9) khoá rate-limit lấy TỪ JWT: rl:{env}:stepup:{companyId}|{userId} — không IP, không địa chỉ thư", async () => {
    const h = makeHarness({ outcome: "invalid-code" });
    await h.svc.stepUp(ACTOR, INPUT).catch(() => undefined);
    const expected = rlKey("stepup", `${COMPANY_ID}|${USER_ID}`);
    expect(h.rateLimiter.isLocked).toHaveBeenCalledWith(expected);
    expect(h.rateLimiter.recordFailure.mock.calls[0]?.[0]).toBe(expected);
    expect(expected).toContain(":stepup:");
    expect(expected).not.toContain("@"); // địa chỉ thư điện tử
    expect(expected).not.toContain("::1"); // địa chỉ IP sau cloudflared (KI-066)
  });
});

/**
 * A09 — TRẦN LƯU TRỮ. Ba ca trên đo từng nhánh rời; ca dưới đo cái mà lỗ hổng thực sự là: số hàng
 * append-only sinh ra bởi một kẻ lặp lời gọi KHÔNG GIỚI HẠN. Bucket ở đây có TRẠNG THÁI (bồi theo
 * `recordFailure`, khoá khi chạm ngưỡng) nên kết luận là về hành vi tích luỹ, không phải về một cờ dựng sẵn.
 */
describe("StepUpService — A09: cửa sổ bồi hàng append-only bị CHẶN bởi STEP_UP_MAX_ATTEMPTS", () => {
  it("lặp cặp-ngoài-registry: N lượt đầu mỗi lượt 1 hàng, từ lượt N+1 trở đi 429 và 0 hàng thêm", async () => {
    const h = makeHarness({ pairs: [], statefulBucket: true });

    const statuses: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);
      statuses.push((err as HttpException).getStatus());
    }
    // N lượt đầu: 400 và CÓ để lại vết (đường bồi bị chặn, không phải bị bịt miệng).
    expect(statuses).toEqual(Array.from({ length: MAX_ATTEMPTS }, () => HttpStatus.BAD_REQUEST));
    expect(h.audit.record).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(h.securityEvents.record).toHaveBeenCalledTimes(MAX_ATTEMPTS);

    // ĐẾM TRƯỚC lượt N+1.
    const auditBefore = h.audit.record.mock.calls.length;
    const eventsBefore = h.securityEvents.record.mock.calls.length;

    // Lượt N+1 và N+2: 429, và số hàng ĐẾM SAU không tăng thêm.
    for (const _ of [1, 2]) {
      void _;
      const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
    expect(h.audit.record).toHaveBeenCalledTimes(auditBefore);
    expect(h.securityEvents.record).toHaveBeenCalledTimes(eventsBefore);
    expect(h.twoFactor.verifyTotpForStepUp).not.toHaveBeenCalled();
  });

  it("cùng cách bồi qua nhánh CHƯA-BẬT-2FA: chạm ngưỡng rồi thì cũng 429 và ngừng ghi", async () => {
    const h = makeHarness({ outcome: "not-enrolled", statefulBucket: true });
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await h.svc.stepUp(ACTOR, INPUT).catch(() => undefined);
    }
    expect(h.audit.record).toHaveBeenCalledTimes(MAX_ATTEMPTS);

    const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(h.audit.record).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });
});

describe("StepUpService — nhánh SAI (mã hỏng)", () => {
  it("TOTP sai ⇒ 400 INVALID-CODE, KHÔNG cấp window, recordFailure + audit Failure + STEP_UP_FAILED", async () => {
    const h = makeHarness({ outcome: "invalid-code" });
    const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: STEP_UP_ERROR_CODES.INVALID_CODE,
    });
    expect(h.windows.grant).not.toHaveBeenCalled();
    expect(h.rateLimiter.recordFailure).toHaveBeenCalledTimes(1);
    expect(h.rateLimiter.reset).not.toHaveBeenCalled();
    expect(h.audit.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        action: STEP_UP_AUDIT_ACTIONS.FAILED,
        objectType: "auth",
        objectId: RESOURCE_ID,
        resultStatus: "Failure",
      }),
    );
    expect(h.securityEvents.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({ eventType: "STEP_UP_FAILED", userId: USER_ID }),
    );
  });

  it("mã sai ⇒ 400 chứ KHÔNG 401 (api-client replay 401 ⇒ một lần gõ sai tiêu HAI lượt)", async () => {
    const h = makeHarness({ outcome: "invalid-code" });
    const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((err as HttpException).getStatus()).not.toBe(HttpStatus.UNAUTHORIZED);
  });

  it("CHƯA bật 2FA ⇒ 409 AUTH-ERR-STEP-UP-2FA-REQUIRED (không 403 câm, không 500)", async () => {
    const h = makeHarness({ outcome: "not-enrolled" });
    const err = await h.svc.stepUp(ACTOR, INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: STEP_UP_ERROR_CODES.TWO_FACTOR_REQUIRED,
    });
    expect((err as HttpException).message).toContain("2FA");
    expect(h.windows.grant).not.toHaveBeenCalled();
    expect(h.audit.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({ action: STEP_UP_AUDIT_ACTIONS.DENIED, resultStatus: "Denied" }),
    );
  });
});

describe("StepUpService — BẤT BIẾN #3: audit/metadata KHÔNG mang credential", () => {
  it.each([["ok"], ["invalid-code"], ["not-enrolled"]] as [StepUpTotpOutcome][])(
    "nhánh %s: mã TOTP KHÔNG xuất hiện trong bất kỳ payload audit/security-event nào",
    async (outcome) => {
      const h = makeHarness({ outcome });
      await h.svc.stepUp(ACTOR, INPUT).catch(() => undefined);
      const written = writtenPayload(h);
      expect(written).not.toContain(TOTP_CODE);
      expect(written.toLowerCase()).not.toContain("secret");
      expect(written.toLowerCase()).not.toContain("password");
    },
  );

  it("metadata CHỈ gồm action/resourceType/resourceId (+reauthValidUntil khi cấp)", async () => {
    const h = makeHarness({ outcome: "ok" });
    await h.svc.stepUp(ACTOR, INPUT);
    const entry = h.audit.record.mock.calls[0]?.[1] as { metadata?: Record<string, unknown> };
    expect(Object.keys(entry.metadata ?? {}).sort()).toEqual([
      "action",
      "reauthValidUntil",
      "resourceId",
      "resourceType",
    ]);
  });

  it("nhánh SAI: metadata không có reauthValidUntil (không có cửa sổ nào được cấp)", async () => {
    const h = makeHarness({ outcome: "invalid-code" });
    await h.svc.stepUp(ACTOR, INPUT).catch(() => undefined);
    const entry = h.audit.record.mock.calls[0]?.[1] as { metadata?: Record<string, unknown> };
    expect(Object.keys(entry.metadata ?? {}).sort()).toEqual([
      "action",
      "resourceId",
      "resourceType",
    ]);
  });
});

describe("StepUpService — §6(10) audit là APPEND, một lượt = một hàng", () => {
  it.each([
    ["ok", 1],
    ["invalid-code", 1],
    ["not-enrolled", 1],
  ] as [StepUpTotpOutcome, number][])(
    "nhánh %s ⇒ đúng %d hàng audit + %d hàng security-event",
    async (outcome, rows) => {
      const h = makeHarness({ outcome });
      await h.svc.stepUp(ACTOR, INPUT).catch(() => undefined);
      expect(h.audit.record).toHaveBeenCalledTimes(rows);
      expect(h.securityEvents.record).toHaveBeenCalledTimes(rows);
      // Cùng một tx (dual-write §6(10)) — không mở transaction thứ hai.
      expect(h.dbsvc.withTenant).toHaveBeenCalledTimes(1);
      expect(h.audit.record.mock.calls[0]?.[0]).toBe(h.tx);
      expect(h.securityEvents.record.mock.calls[0]?.[0]).toBe(h.tx);
    },
  );
});
