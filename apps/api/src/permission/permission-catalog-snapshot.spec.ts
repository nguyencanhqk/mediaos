/**
 * S14-SEC-DASHGATE-WILDCARD-1 §5.1 — ảnh chụp catalog `is_sensitive` theo CẶP ĐÍCH.
 *
 * Không cần DB: `load` là hàm tiêm, đồng hồ là hàm tiêm. Đồng hồ TIÊM chứ KHÔNG
 * `vi.useFakeTimers()` toàn cục — dịch đồng hồ toàn cục làm gãy thư viện nền khác trong cùng run
 * (memory `fake-timers-break-socketio-client-emit`), và ca timeout dưới đây cần timer THẬT chạy.
 */
import { describe, expect, it, vi } from "vitest";
import { PermissionCatalogSnapshot } from "./permission-catalog-snapshot";
import type { PermissionCatalogEntry } from "./permission.types";

const entry = (
  action: string,
  resourceType: string,
  isSensitive: boolean,
): PermissionCatalogEntry => ({
  id: `${action}-${resourceType}`,
  action,
  resourceType,
  isSensitive,
});

const CATALOG: PermissionCatalogEntry[] = [
  entry("view-line", "payroll-period", true),
  entry("view", "candidate", true),
  entry("read", "notification", false),
  entry("manage", "offer", false),
];

/** Đồng hồ tiêm — trả về controller để ca TTL đẩy thời gian mà không đụng timer toàn cục. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("PermissionCatalogSnapshot", () => {
  it("cặp sensitive trong catalog ⇒ true", async () => {
    const snap = new PermissionCatalogSnapshot({ load: async () => CATALOG });
    expect(await snap.isPairSensitive("view-line", "payroll-period")).toBe(true);
    expect(await snap.isPairSensitive("view", "candidate")).toBe(true);
  });

  it("cặp non-sensitive trong catalog ⇒ false", async () => {
    const snap = new PermissionCatalogSnapshot({ load: async () => CATALOG });
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(await snap.isPairSensitive("manage", "offer")).toBe(false);
  });

  it("D3 — ảnh chụp ĐÃ nạp mà cặp VẮNG ⇒ false (không phải true)", async () => {
    const snap = new PermissionCatalogSnapshot({ load: async () => CATALOG });
    // Cặp không có trong catalog không thể là cặp sensitive CỦA catalog. Chọn `true` ở đây sẽ biến
    // mọi mock `getAllPermissions(): []` thành "mọi cặp sensitive" và làm hàng loạt spec đỏ vì lý do sai.
    expect(await snap.isPairSensitive("khong", "ton-tai")).toBe(false);

    const empty = new PermissionCatalogSnapshot({ load: async () => [] });
    expect(await empty.isPairSensitive("view-line", "payroll-period")).toBe(false);
  });

  it("D4 — cặp truy vấn tự chứa `*` ⇒ true ở CẢ BỐN hình dạng, KHÔNG chạm catalog", async () => {
    // Matcher grant xử lý `action==='*'` HOẶC `resourceType==='*'` ĐỘC LẬP ⇒ phải phủ đủ 4 hình dạng
    // (memory `permission-grant-census-must-cover-four-wildcard-shapes`), không chỉ `*:*`.
    const load = vi.fn(async () => CATALOG);
    const snap = new PermissionCatalogSnapshot({ load });

    expect(await snap.isPairSensitive("*", "*")).toBe(true);
    expect(await snap.isPairSensitive("*", "payroll-period")).toBe(true);
    expect(await snap.isPairSensitive("view-line", "*")).toBe(true);
    expect(await snap.isPairSensitive("*", "notification")).toBe(true);
    // Trả lời được mà không cần catalog ⇒ `*` không mở được đường nạp nào.
    expect(load).not.toHaveBeenCalled();
  });

  it("N lời gọi TUẦN TỰ trong TTL ⇒ nạp đúng 1 lần", async () => {
    const load = vi.fn(async () => CATALOG);
    const snap = new PermissionCatalogSnapshot({ load, now: fakeClock().now });
    for (let i = 0; i < 5; i++) await snap.isPairSensitive("view", "candidate");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("D6 — N lời gọi ĐỒNG THỜI ⇒ nạp đúng 1 lần (single-flight)", async () => {
    // Ca tuần tự ở trên một mình là xanh-RỖNG với bug fan-out: `Promise.all` của N widget trên ảnh
    // chụp LẠNH là đúng hình dạng đường mà WO này đang vá (dashboard-widget-registry.service.ts).
    let resolveLoad: ((rows: PermissionCatalogEntry[]) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<PermissionCatalogEntry[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const snap = new PermissionCatalogSnapshot({ load, now: fakeClock().now });

    const inflight = Promise.all([
      snap.isPairSensitive("view-line", "payroll-period"),
      snap.isPairSensitive("view", "candidate"),
      snap.isPairSensitive("read", "notification"),
      snap.isPairSensitive("manage", "offer"),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    resolveLoad?.(CATALOG);

    expect(await inflight).toEqual([true, true, false, false]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("D5 — hết TTL ⇒ nạp lần 2 và thấy catalog MỚI", async () => {
    const clock = fakeClock();
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockResolvedValueOnce([entry("read", "notification", false)])
      .mockResolvedValueOnce([entry("read", "notification", true)]);
    const snap = new PermissionCatalogSnapshot({ load, now: clock.now, ttlMs: 300_000 });

    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    clock.advance(299_999);
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);

    clock.advance(2);
    expect(await snap.isPairSensitive("read", "notification")).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("D2 — refresh lỗi khi ĐÃ có ảnh chụp ⇒ giữ giá trị cũ, KHÔNG ném, có onError", async () => {
    const clock = fakeClock();
    const onError = vi.fn();
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockResolvedValueOnce(CATALOG)
      .mockRejectedValue(new Error("db down"));
    const snap = new PermissionCatalogSnapshot({ load, now: clock.now, ttlMs: 1_000, onError });

    expect(await snap.isPairSensitive("view", "candidate")).toBe(true);
    clock.advance(2_000);

    expect(await snap.isPairSensitive("view", "candidate")).toBe(true);
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[1]).toBe("stale-kept");
  });

  it("D2 — nạp lỗi khi CHƯA có ảnh chụp ⇒ true, KHÔNG ném, và lần gọi kế tiếp VẪN thử nạp lại", async () => {
    const clock = fakeClock();
    const onError = vi.fn();
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(CATALOG);
    const snap = new PermissionCatalogSnapshot({ load, now: clock.now, onError });

    // Suy biến về phía SIẾT.
    expect(await snap.isPairSensitive("read", "notification")).toBe(true);
    expect(onError.mock.calls[0]?.[1]).toBe("no-snapshot");

    // Đồng hồ KHÔNG nhúc nhích: một blip DB không được khoá trạng thái suy biến suốt TTL.
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("D5 — query TREO quá timeout ⇒ hành xử như lỗi nạp, KHÔNG treo caller", async () => {
    const onError = vi.fn();
    // Promise không bao giờ settle: nếu không có trần, `await` dưới đây treo và ca này timeout.
    const load = vi.fn(() => new Promise<PermissionCatalogEntry[]>(() => {}));
    const snap = new PermissionCatalogSnapshot({ load, timeoutMs: 20, onError });

    expect(await snap.isPairSensitive("read", "notification")).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toBe("no-snapshot");
  });

  it("D7 — reset() xoá ảnh chụp: lần gọi sau nạp lại", async () => {
    const load = vi.fn(async () => CATALOG);
    const snap = new PermissionCatalogSnapshot({ load, now: fakeClock().now });

    await snap.isPairSensitive("view", "candidate");
    expect(load).toHaveBeenCalledTimes(1);

    snap.reset();
    await snap.isPairSensitive("view", "candidate");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
