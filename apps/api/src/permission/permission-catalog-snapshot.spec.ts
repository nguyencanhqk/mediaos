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

  it("D3 — ảnh chụp ĐÃ nạp (KHÔNG RỖNG) mà cặp VẮNG ⇒ false (không phải true)", async () => {
    const snap = new PermissionCatalogSnapshot({ load: async () => CATALOG });
    // Cặp không có trong catalog KHÔNG RỖNG không thể là cặp sensitive CỦA catalog.
    expect(await snap.isPairSensitive("khong", "ton-tai")).toBe(false);
  });

  it("D9 — catalog nạp THÀNH CÔNG mà RỖNG ⇒ SUY BIẾN (true), không phải ảnh hợp lệ", async () => {
    // ⚠️ Ca này TRƯỚC đây neo `empty ⇒ false` với lý do TIỆN TEST («làm hàng loạt spec đỏ vì lý do
    // sai») — mẫu `tests-can-pin-a-hole-open`. Bản vá sửa CHÍNH ca đó, không lách quanh nó.
    //
    // D3 nói về cặp VẮNG trong ảnh KHÔNG RỖNG; nó chưa bao giờ phát biểu gì về ảnh RỖNG. `permissions`
    // là catalog GLOBAL do migration seed ⇒ 0 hàng là phát biểu HẠ TẦNG («chưa seed / bị xoá»), không
    // phải phát biểu nghiệp vụ («không có cặp nhạy cảm nào»). Coi nó hợp lệ là để một sự cố hạ tầng
    // TỰ TUYÊN BỐ rằng không có gì cần bảo vệ — và đóng dấu tuyên bố đó suốt TTL 300s, KHÔNG một dòng log.
    const onError = vi.fn();
    const empty = new PermissionCatalogSnapshot({ load: async () => [], onError });

    expect(await empty.isPairSensitive("view-line", "payroll-period")).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toBe("no-snapshot");
    expect(onError.mock.calls[0]?.[2]).toBe("empty-catalog");
  });

  it("D9 — RỖNG khi ĐÃ có ảnh cũ ⇒ GIỮ giá trị cũ (stale-kept), có vết, KHÔNG lật sang false", async () => {
    const clock = fakeClock();
    const onError = vi.fn();
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockResolvedValueOnce(CATALOG)
      .mockResolvedValue([]);
    const snap = new PermissionCatalogSnapshot({ load, now: clock.now, ttlMs: 1_000, onError });

    expect(await snap.isPairSensitive("view", "candidate")).toBe(true);
    clock.advance(2_000);

    // Ảnh RỖNG không được ĐÈ ảnh cũ.
    expect(await snap.isPairSensitive("view", "candidate")).toBe(true);
    // ⚪ đối chứng: cặp non-sensitive VẪN false ⇒ bản vá «mọi cặp true» không lọt qua ca này.
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);

    expect(onError.mock.calls[0]?.[1]).toBe("stale-kept");
    expect(onError.mock.calls[0]?.[2]).toBe("empty-catalog");
  });

  it("D9 — RỖNG KHÔNG đóng dấu TTL: hết sàn là thử lại (đồng hồ đứng yên, sàn = 0)", async () => {
    // ⚠️ BẮT BUỘC tiêm `degradedRetryMs: 0`: sàn D9 (mặc định 5s) sẽ chặn lượt 2 và ca này đỏ vĩnh
    // viễn. Ca này đo «không đóng dấu TTL» — TÁCH BẠCH với ca đo «có sàn» bên dưới.
    const clock = fakeClock();
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(CATALOG);
    const snap = new PermissionCatalogSnapshot({
      load,
      now: clock.now,
      onError: vi.fn(),
      degradedRetryMs: 0,
    });

    expect(await snap.isPairSensitive("read", "notification")).toBe(true); // suy biến SIẾT
    // Đồng hồ KHÔNG nhúc nhích: ảnh rỗng không được khoá trạng thái suy biến suốt TTL.
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("D9 — vị ngữ là `rows.length`, KHÔNG `next.size`: catalog CÓ hàng mà 0 hàng sensitive ⇒ KHÔNG suy biến", async () => {
    // ⚪ đối chứng CHỊU LỰC. Đây là giả định mà cả luật «hàng canh» ở 7 stub repo đứng lên:
    // hàng canh có `isSensitive:false` ⇒ Set RỖNG nhưng `rows.length === 1` ⇒ KHÔNG suy biến.
    // Đổi vị ngữ sang `next.size === 0` trông như dọn dẹp vô hại (thậm chí «chặt hơn») nhưng làm NỔ
    // cả 7 stub cùng lúc. Ca này là thứ duy nhất chặn đường trôi đó.
    //
    // Hệ quả ĐƯỢC CHỌN, không phải bỏ sót: catalog 390 hàng mà 0 hàng `isSensitive` (migration hỏng
    // xoá sạch cờ) là fail-OPEN mà D9 KHÔNG bắt — vì không phân biệt được với một hệ hợp lệ không có
    // cặp nhạy cảm nào.
    const clock = fakeClock();
    const onError = vi.fn();
    const load = vi.fn(async () => [entry("read", "notification", false)]);
    const snap = new PermissionCatalogSnapshot({ load, now: clock.now, onError });

    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(await snap.isPairSensitive("view", "candidate")).toBe(false);
    expect(onError).not.toHaveBeenCalled(); // KHÔNG suy biến ⇒ không vết
    // Ảnh chụp ĐƯỢC đóng dấu TTL ⇒ N lượt trong TTL vẫn 1 lần nạp.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("D9 sàn — TRONG cửa sổ: N lượt tuần tự trên catalog rỗng ⇒ nạp 1 lần, log 1 dòng", async () => {
    // Hình dạng no-snapshot (rỗng TỪ ĐẦU) ⇒ `sensitivePairs` luôn `null` ⇒ nhánh TTL của
    // `ensureSnapshot` KHÔNG BAO GIỜ chạm tới ⇒ `load = 1` CHỈ CÓ THỂ do sàn. Không cần mẹo ttlMs.
    const clock = fakeClock();
    const onError = vi.fn();
    const load = vi.fn(async () => [] as PermissionCatalogEntry[]);
    const snap = new PermissionCatalogSnapshot({
      load,
      now: clock.now,
      onError,
      degradedRetryMs: 10_000,
    });

    for (let i = 0; i < 5; i++) {
      expect(await snap.isPairSensitive("read", "notification")).toBe(true);
    }
    expect(load).toHaveBeenCalledTimes(1);
    // Sàn chặn CẢ bão log, không chỉ bão query.
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("D9 sàn — HẾT cửa sổ: nạp lại và thấy catalog MỚI (sàn NHẢ, không phải chốt)", async () => {
    // ⚠️ BẮT BUỘC. Không có ca này thì sàn là một chốt mà không ai chứng minh được là nhả, và ba đột
    // biến sau đều XANH: `retryNotBeforeMs = MAX_SAFE_INTEGER`; dùng `ttlMs` thay `degradedRetryMs`;
    // đặt dòng gỡ sàn nhầm chỗ. Cả ba dựng lại M2 dưới tên khác (mọi cặp true vĩnh viễn).
    const clock = fakeClock();
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(CATALOG);
    const snap = new PermissionCatalogSnapshot({
      load,
      now: clock.now,
      onError: vi.fn(),
      degradedRetryMs: 10_000,
    });

    expect(await snap.isPairSensitive("view", "candidate")).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);

    clock.advance(9_999); // vẫn trong sàn
    expect(await snap.isPairSensitive("view", "candidate")).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);

    clock.advance(2); // HẾT sàn
    expect(await snap.isPairSensitive("view", "candidate")).toBe(true); // cờ THẬT, từ catalog mới
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("D9 sàn — `reset()` giữa cửa sổ sàn ⇒ lượt kế nạp lại NGAY", async () => {
    // Ghim dòng `retryNotBeforeMs = 0` trong `reset()`. Thiếu nó, seam D7 mất tác dụng đúng lúc cần
    // nhất: int-spec seed cặp quyền mới rồi gọi `resetCatalogSnapshotForTest()`
    // (`dash-wildcard-sensitive-gate.int-spec.ts:177`) sẽ vẫn bị sàn chặn.
    const clock = fakeClock();
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(CATALOG);
    const snap = new PermissionCatalogSnapshot({
      load,
      now: clock.now,
      onError: vi.fn(),
      degradedRetryMs: 10_000,
    });

    expect(await snap.isPairSensitive("view", "candidate")).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);

    snap.reset(); // đồng hồ KHÔNG nhúc nhích — sàn vẫn còn hiệu lực nếu reset() không gỡ nó
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("D9 sàn — lượt nạp LẠC HẬU (reset() xen giữa) KHÔNG được để lại sàn MỒ CÔI", async () => {
    // Ghim THỨ TỰ: kiểm `epoch` phải nằm TRƯỚC kiểm rỗng trong `refresh()`.
    //
    // Không có ca này thì XOÁ HẲN dòng `if (epochAtStart !== this.epoch) return ...` vẫn xanh toàn
    // suite (đo bằng đột biến). Mà chính dòng đó là thứ chặn một lượt nạp ĐÃ LẠC HẬU đặt
    // `retryNotBeforeMs` cho một thế hệ ảnh chụp không ai còn dùng — tức khoá thế hệ MỚI bằng sàn của
    // thế hệ CŨ, không đường gỡ: đúng hình dạng M2, chỉ đổi tên biến.
    const clock = fakeClock();
    let resolveStale: ((rows: PermissionCatalogEntry[]) => void) | undefined;
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockImplementationOnce(
        () =>
          new Promise<PermissionCatalogEntry[]>((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValue(CATALOG);
    const snap = new PermissionCatalogSnapshot({
      load,
      now: clock.now,
      onError: vi.fn(),
      degradedRetryMs: 10_000,
    });

    const stale = snap.isPairSensitive("view", "candidate"); // lượt 1 đang BAY
    snap.reset(); // sang thế hệ MỚI trong lúc lượt 1 chưa về
    resolveStale?.([]); // lượt CŨ về, và về RỖNG
    await stale;

    // Lượt kế thuộc thế hệ MỚI ⇒ phải nạp lại NGAY, không bị sàn của lượt lạc hậu chặn.
    // Đồng hồ KHÔNG nhúc nhích: nếu sàn mồ côi tồn tại thì nó còn hiệu lực 10s nữa.
    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("M2 — `load` ném ĐỒNG BỘ ⇒ ô single-flight KHÔNG kẹt: lượt kế tiếp vẫn nạp lại", async () => {
    // ⚠️ Phải ném ĐỒNG BỘ (`mockImplementationOnce(() => { throw })`), KHÔNG `mockRejectedValueOnce`:
    // promise-reject là đường đã có ca xanh sẵn ⇒ dùng nó ở đây là một ca RỖNG.
    //
    // Trước vá: thân async chạy hết ĐỒNG BỘ (catch → emitError → finally nhả ô, lúc đó ô vẫn `null`)
    // TRƯỚC dòng `this.inFlight = flight` ⇒ ô ghim một promise ĐÃ settle mà `finally` không còn cơ hội
    // xoá ⇒ mọi cặp = sensitive VĨNH VIỄN tới khi restart tiến trình.
    const clock = fakeClock();
    const load = vi
      .fn<() => Promise<PermissionCatalogEntry[]>>()
      .mockImplementationOnce(() => {
        throw new Error("sync boom");
      })
      .mockResolvedValue(CATALOG);
    const onError = vi.fn();
    const snap = new PermissionCatalogSnapshot({ load, now: clock.now, onError });

    expect(await snap.isPairSensitive("read", "notification")).toBe(true); // suy biến SIẾT
    expect(onError.mock.calls[0]?.[1]).toBe("no-snapshot");
    expect(onError.mock.calls[0]?.[2]).toBe("load-failed");

    expect(await snap.isPairSensitive("read", "notification")).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
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
