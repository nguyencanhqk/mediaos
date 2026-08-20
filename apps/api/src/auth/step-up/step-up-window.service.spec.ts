import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { StepUpWindowService, type StepUpWindowKey } from "./step-up-window.service";
import { stepUpKey } from "../../common/valkey/valkey-key";
import { isReauthValid } from "../../permission/permission.decide";
import { loadEnv } from "../../config/env.schema";

/**
 * S10-AUTH-STEPUP-1 · RED-first — cửa sổ step-up (DECISIONS-09 §6 điểm 1/6/7).
 *
 * Ba thứ được đóng đinh ở đây, mỗi thứ đều đã có tiền lệ hỏng thật trong repo:
 *   (6) NGỮ NGHĨA: cửa sổ DÙNG LẠI ĐƯỢC trong TTL, TTL TUYỆT ĐỐI — đường ĐỌC là đọc THUẦN. Thiếu ràng
 *       buộc này, một `EXPIRE`/`SET` lén trong `getValidWindow()` biến TTL 5 phút thành phiên vô hạn.
 *   (7) GHI KHÔNG SUY TỪ `set()`: `ValkeyService.set()` trả `true` KHI CHƯA CẤU HÌNH (valkey.service.ts:99)
 *       ⇒ ai suy "đã ghi" từ giá trị đó sẽ trả 200 kèm `reauthValidUntil` trong khi cửa sổ không nằm ở
 *       đâu cả ⇒ guard đọc null ⇒ 403 CÂM = KI-065 nguyên xi. Nhánh lưu rẽ theo `isEnabled()`.
 *   (1) CODEC: Valkey trả STRING. Đường đọc phải deserialize lại thành `Date` — `permission.decide`
 *       nhận `Date`, một chuỗi lọt qua sẽ so sánh sai lặng lẽ.
 */

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const RESOURCE_ID = "33333333-3333-3333-3333-333333333333";

const BASE: StepUpWindowKey = {
  companyId: COMPANY_ID,
  userId: USER_ID,
  action: "read",
  resourceType: "employee_salary",
  resourceId: RESOURCE_ID,
};

const TTL_SEC = loadEnv().STEP_UP_TTL_SEC;
const NOW = Date.parse("2026-08-20T03:00:00.000Z");

function keyOf(k: StepUpWindowKey): string {
  return stepUpKey(k.companyId, k.userId, k.action, k.resourceType, k.resourceId);
}

/**
 * ValkeyService giả. `isEnabled` và `set` TÁCH RỜI CÓ CHỦ ĐÍCH để dựng lại đúng bẫy V2-BLOCK#1:
 * `enabled:false` + `set` trả `true` = môi trường thiếu `VALKEY_URL`.
 * `expire`/`del`/`getex` có mặt để nếu đường ĐỌC lỡ gọi chúng thì spy bắt được (chứ không nổ TypeError
 * khó đọc) — đó là phép đo "đọc không gia hạn TTL".
 */
function makeValkey(opts: { enabled: boolean; setResult?: boolean; seed?: [string, string][] }) {
  const store = new Map<string, string>(opts.seed ?? []);
  const svc = {
    isEnabled: vi.fn(() => opts.enabled),
    set: vi.fn(async (key: string, value: string, _ttlSec: number) => {
      if (opts.setResult === false) return false;
      store.set(key, value);
      return true;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    getex: vi.fn(async () => null),
  };
  return { svc, store };
}

function makeSvc(valkey?: { isEnabled: () => boolean }) {
  return new StepUpWindowService(valkey as never);
}

describe("StepUpWindowService — ca ALLOW đối chứng (mint rồi đọc lại được)", () => {
  it("Valkey TẮT: grant ⇒ đọc lại ra Date còn hạn, isReauthValid true", async () => {
    const svc = makeSvc(undefined);
    const until = await svc.grant(BASE, NOW);
    expect(until).toBeInstanceOf(Date);
    expect(until.getTime()).toBe(NOW + TTL_SEC * 1000);

    const read = await svc.getValidWindow(BASE, NOW + 1_000);
    expect(read).toBeInstanceOf(Date);
    expect(isReauthValid(read, new Date(NOW + 1_000))).toBe(true);
  });
});

describe("StepUpWindowService — khoá là BỘ-5: đổi ĐÚNG MỘT thành phần ⇒ khoá KHÁC", () => {
  const variants: [string, StepUpWindowKey][] = [
    ["companyId", { ...BASE, companyId: "99999999-9999-9999-9999-999999999999" }],
    ["userId", { ...BASE, userId: "88888888-8888-8888-8888-888888888888" }],
    ["action", { ...BASE, action: "export" }],
    ["resourceType", { ...BASE, resourceType: "employee_profile" }],
    ["resourceId", { ...BASE, resourceId: "77777777-7777-7777-7777-777777777777" }],
  ];

  it.each(variants)("đổi %s (chỉ MỘT vế) ⇒ cửa sổ KHÔNG mở", async (field, variant) => {
    // Tự-kiểm bảng không trôi thành ca "đổi kèm": đúng 1/5 thành phần được lệch.
    const diff = (Object.keys(BASE) as (keyof StepUpWindowKey)[]).filter(
      (k) => BASE[k] !== variant[k],
    );
    expect(diff).toEqual([field]);

    const svc = makeSvc(undefined);
    await svc.grant(BASE, NOW);
    expect(await svc.getValidWindow(variant, NOW + 1_000)).toBeNull();
    // Đối chứng trong CÙNG ca: bộ-5 gốc vẫn mở ⇒ null ở trên không phải vì mint hỏng.
    expect(await svc.getValidWindow(BASE, NOW + 1_000)).toBeInstanceOf(Date);
  });
});

describe("StepUpWindowService — TTL", () => {
  it("quá TTL ⇒ null (hết hạn là hết, không có ân hạn)", async () => {
    const svc = makeSvc(undefined);
    await svc.grant(BASE, NOW);
    expect(await svc.getValidWindow(BASE, NOW + TTL_SEC * 1000 + 1)).toBeNull();
  });

  it("§6(6) DÙNG LẠI ĐƯỢC: đọc 2 lần trong TTL, lần 2 VẪN hợp lệ", async () => {
    const svc = makeSvc(undefined);
    await svc.grant(BASE, NOW);
    const first = await svc.getValidWindow(BASE, NOW + 1_000);
    const second = await svc.getValidWindow(BASE, NOW + 2_000);
    expect(first).toBeInstanceOf(Date);
    expect(second).toBeInstanceOf(Date);
    expect(second?.getTime()).toBe(first?.getTime());
  });

  it("§6(6) KHÔNG SLIDING (memory): đọc muộn KHÔNG đẩy hạn — vẫn chết đúng mốc gốc", async () => {
    const svc = makeSvc(undefined);
    await svc.grant(BASE, NOW);
    await svc.getValidWindow(BASE, NOW + TTL_SEC * 1000 - 1_000); // đọc sát hạn
    expect(await svc.getValidWindow(BASE, NOW + TTL_SEC * 1000 + 1)).toBeNull();
  });
});

describe("StepUpWindowService — nhánh Valkey BẬT", () => {
  it("CODEC: store trả STRING ⇒ ra Date (không phải string) và isReauthValid true", async () => {
    const expiry = new Date(NOW + 60_000).toISOString();
    const { svc: valkey } = makeValkey({ enabled: true, seed: [[keyOf(BASE), expiry]] });
    const svc = makeSvc(valkey);

    const read = await svc.getValidWindow(BASE, NOW);
    expect(read).toBeInstanceOf(Date);
    expect(typeof read).not.toBe("string");
    expect(read?.toISOString()).toBe(expiry);
    expect(isReauthValid(read, new Date(NOW))).toBe(true);
  });

  it("CODEC hỏng (chuỗi rác trong store) ⇒ null, KHÔNG ném, KHÔNG Invalid Date lọt ra", async () => {
    const { svc: valkey } = makeValkey({ enabled: true, seed: [[keyOf(BASE), "khong-phai-ngay"]] });
    expect(await makeSvc(valkey).getValidWindow(BASE, NOW)).toBeNull();
  });

  it("grant ghi ĐÚNG khoá bộ-5 mang envScope + TTL từ env", async () => {
    const { svc: valkey } = makeValkey({ enabled: true });
    const svc = makeSvc(valkey);
    await svc.grant(BASE, NOW);
    expect(valkey.set).toHaveBeenCalledTimes(1);
    const call = valkey.set.mock.calls[0];
    expect(call?.[0]).toBe(keyOf(BASE));
    expect(call?.[2]).toBe(TTL_SEC);
    expect(new Date(String(call?.[1])).getTime()).toBe(NOW + TTL_SEC * 1000);
  });

  it("§6(6) đường ĐỌC KHÔNG gia hạn: 0 set/expire/getex/del, expiry đọc lại y hệt lúc mint", async () => {
    const { svc: valkey } = makeValkey({ enabled: true });
    const svc = makeSvc(valkey);
    const until = await svc.grant(BASE, NOW);
    const setCallsAfterGrant = valkey.set.mock.calls.length;

    const first = await svc.getValidWindow(BASE, NOW + 1_000);
    const second = await svc.getValidWindow(BASE, NOW + 120_000);

    expect(valkey.set.mock.calls.length).toBe(setCallsAfterGrant); // KHÔNG ghi lại
    expect(valkey.expire).not.toHaveBeenCalled();
    expect(valkey.getex).not.toHaveBeenCalled();
    expect(valkey.del).not.toHaveBeenCalled();
    expect(first?.getTime()).toBe(until.getTime());
    expect(second?.getTime()).toBe(until.getTime());
  });

  it("Valkey BẬT mà set() trả false (outage THẬT) ⇒ 503 SYSTEM-ERR-001, KHÔNG rơi memory", async () => {
    const { svc: valkey } = makeValkey({ enabled: true, setResult: false });
    const svc = makeSvc(valkey);
    const err = await svc.grant(BASE, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getStatus()).toBe(503);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
      code: "SYSTEM-ERR-001",
    });
    // KHÔNG được âm thầm lưu vào memory rồi trả 200: nhiều instance ⇒ 200-nhưng-403-vĩnh-viễn.
    expect(await svc.getValidWindow(BASE, NOW + 1_000)).toBeNull();
  });
});

describe("StepUpWindowService — 🚩V2-BLOCK#1: Valkey CHƯA CẤU HÌNH", () => {
  it("isEnabled()=false + set() trả true ⇒ KHÔNG gọi set, rơi memory, ĐỌC LẠI ĐƯỢC từ chính fallback", async () => {
    const { svc: valkey } = makeValkey({ enabled: false, setResult: true });
    const svc = makeSvc(valkey);

    const until = await svc.grant(BASE, NOW);

    // Nhánh lưu chọn theo isEnabled(), KHÔNG suy từ giá trị trả về của set().
    expect(valkey.isEnabled).toHaveBeenCalled();
    expect(valkey.set).not.toHaveBeenCalled();

    const read = await svc.getValidWindow(BASE, NOW + 1_000);
    expect(read).toBeInstanceOf(Date);
    expect(read?.getTime()).toBe(until.getTime());
    // Đường ĐỌC rẽ CÙNG nhánh: ghi memory thì đọc memory (ghi một nơi đọc nơi khác = deny vĩnh viễn).
    expect(valkey.get).not.toHaveBeenCalled();
  });

  it("memory fallback TÔN TRỌNG TTL (không phải cache vĩnh viễn)", async () => {
    const { svc: valkey } = makeValkey({ enabled: false, setResult: true });
    const svc = makeSvc(valkey);
    await svc.grant(BASE, NOW);
    expect(await svc.getValidWindow(BASE, NOW + TTL_SEC * 1000 + 1)).toBeNull();
  });
});
