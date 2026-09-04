/**
 * S14-SEC-DASHGATE-WILDCARD-1 — ảnh chụp cờ `permissions.is_sensitive` theo **CẶP ĐÍCH**.
 *
 * Lý do tồn tại (ADR `DECISIONS-12`): `decideCan`/`decideStrongestScope` xưa nay đọc `is_sensitive`
 * của **HÀNG GRANT KHỚP**. Actor chỉ cầm `('*','*')` ⇒ hàng khớp là hàng wildcard, `is_sensitive=false`
 * ⇒ cổng sensitive KHÔNG bật ⇒ wildcard mở được cặp sensitive. Cổng tự khoá mình bằng chìa của kẻ đi qua.
 * Ảnh chụp này là nguồn cho `pairIsSensitive` — cờ của CẶP ĐÍCH, độc lập với grant mà actor cầm.
 *
 * ⚠️ **State PER-INSTANCE, KHÔNG module-level** (ADR §5.3 D7): module-level làm mọi `PermissionService`
 * trong CÙNG file test dùng chung ảnh chụp bất kể repo nào nạp trước — vỡ ở các spec dựng nhiều instance
 * với stub catalog khác nhau.
 *
 * ⚠️ **KHÔNG BAO GIỜ ném** (ADR §5.3 D2): `can()` bọc try/catch fail-closed ⇒ một lỗi catalog ném ra sẽ
 * DENY toàn bộ kiểm quyền của tiến trình = sự cố lớn hơn lỗ đang vá. Mọi lỗi nạp → giá trị suy biến + hook
 * `onError` để người vận hành thấy (luật quan sát), không phải im lặng.
 */
import type { PermissionCatalogEntry } from "./permission.types";

/** ADR §5.3 D5 — TTL ảnh chụp. Cặp sensitive seed lúc API đang chạy lọt tối đa một cửa sổ này. */
export const PERMISSION_CATALOG_TTL_MS = 300_000;

/** ADR §5.3 D5 — trần thời gian một lượt nạp: DB treo KHÔNG được kéo `can()` treo theo. */
export const PERMISSION_CATALOG_LOAD_TIMEOUT_MS = 5_000;

/**
 * Khoá tra cứu. Dùng `\u0000` chứ không phải `:` — `:` là ký tự người-đọc dùng ở mọi nơi khác
 * (`view:leave`), nên nếu một `action`/`resourceType` nào đó chứa `:` thì hai cặp khác nhau sẽ trùng
 * khoá. Trùng khoá ở đây = tra nhầm cờ = đúng loại lỗ WO này đang vá, nên không đánh cược.
 *
 * ⚠️ Viết bằng ESCAPE (xem `PAIR_KEY_SEP` bên dưới), TUYỆT ĐỐI không dán ký tự NUL thật vào
 * file nguồn — kể cả trong comment này. Một byte NUL làm
 * `grep`/`rg` xếp cả file vào loại BINARY và bỏ qua nó **trong im lặng** ⇒ mọi census bằng grep sau
 * này (kể cả census cặp nhạy cảm của chính WO này) sẽ mù với file. Đã vấp đúng một lần khi viết bản này.
 */
const PAIR_KEY_SEP = "\u0000";
const pairKey = (action: string, resourceType: string): string =>
  `${action}${PAIR_KEY_SEP}${resourceType}`;

export interface PermissionCatalogSnapshotDeps {
  /** Nạp toàn catalog (global, no-RLS). Thường là `() => repo.getAllPermissions()`. */
  load: () => Promise<PermissionCatalogEntry[]>;
  /**
   * Đồng hồ TIÊM — KHÔNG `vi.useFakeTimers()` toàn cục ở spec TTL (dịch đồng hồ toàn cục làm gãy
   * các thư viện nền khác trong cùng run). Mặc định `Date.now`.
   */
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
  /** Gọi khi nạp hỏng. KHÔNG được ném. */
  onError?: (error: unknown, phase: "stale-kept" | "no-snapshot") => void;
}

export class PermissionCatalogSnapshot {
  /** `null` = CHƯA từng nạp thành công. Set chứa khoá của các cặp `is_sensitive = true`. */
  private sensitivePairs: Set<string> | null = null;
  private loadedAtMs = 0;
  /** ADR §5.3 D6 — single-flight. Promise này KHÔNG BAO GIỜ reject (xem `refresh`). */
  private inFlight: Promise<Set<string> | null> | null = null;

  private readonly load: () => Promise<PermissionCatalogEntry[]>;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly onError?: (error: unknown, phase: "stale-kept" | "no-snapshot") => void;

  constructor(deps: PermissionCatalogSnapshotDeps) {
    this.load = deps.load;
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? PERMISSION_CATALOG_TTL_MS;
    this.timeoutMs = deps.timeoutMs ?? PERMISSION_CATALOG_LOAD_TIMEOUT_MS;
    this.onError = deps.onError;
  }

  /**
   * Cặp đích có phải cặp SENSITIVE trong catalog?
   *
   * - cặp chứa `*` ⇒ `true` (ADR D4) — chặn `*` thành đường lách chính bản vá. Kiểm TRƯỚC khi nạp:
   *   câu trả lời không phụ thuộc catalog.
   * - ảnh chụp đã nạp mà cặp VẮNG ⇒ `false` (ADR D3) — cặp không có trong catalog không thể là cặp
   *   sensitive CỦA catalog.
   * - chưa có ảnh chụp nào + nạp hỏng ⇒ `true` (ADR D2) — suy biến về phía SIẾT. Nhờ chỗ đặt cờ
   *   (`permission.decide.ts`, SAU object-tier và SAU `needsObjectGrant`), `true` chỉ siết cổng
   *   wildcard: KHÔNG lật `auditRequired` (mask→reveal), KHÔNG bật `needsObjectGrant`.
   */
  async isPairSensitive(action: string, resourceType: string): Promise<boolean> {
    if (action === "*" || resourceType === "*") return true;
    const snapshot = await this.ensureSnapshot();
    if (snapshot === null) return true;
    return snapshot.has(pairKey(action, resourceType));
  }

  /** ADR §5.3 D7 — seam test. Gọi qua `PermissionService.resetCatalogSnapshotForTest()`. */
  reset(): void {
    this.sensitivePairs = null;
    this.loadedAtMs = 0;
    this.inFlight = null;
  }

  private async ensureSnapshot(): Promise<Set<string> | null> {
    if (this.sensitivePairs !== null && this.now() - this.loadedAtMs < this.ttlMs) {
      return this.sensitivePairs;
    }
    return this.refresh();
  }

  /**
   * ADR §5.3 D6 — single-flight: ảnh chụp lạnh + N widget kiểm quyền song song (`Promise.all` ở
   * `dashboard-widget-registry.service.ts`) phải là **1** query, không phải N.
   *
   * ⚠️ Promise chia sẻ **KHÔNG BAO GIỜ reject**: try/catch nằm BÊN TRONG, trả sentinel. Để nó reject là
   * bắn unhandled rejection trên đường **mọi** `can()` đi qua — repo đã từng ăn đúng đòn này (CI ĐỎ
   * trong khi 1821/1821 PASS).
   */
  private refresh(): Promise<Set<string> | null> {
    if (this.inFlight !== null) return this.inFlight;

    const flight = (async (): Promise<Set<string> | null> => {
      try {
        const rows = await this.withTimeout(this.load());
        const next = new Set<string>();
        for (const row of rows) {
          if (row.isSensitive) next.add(pairKey(row.action, row.resourceType));
        }
        this.sensitivePairs = next;
        this.loadedAtMs = this.now();
        return next;
      } catch (error: unknown) {
        // ADR §5.3 D2. CỐ Ý không đóng dấu `loadedAtMs`: một blip DB không được khoá trạng thái suy
        // biến suốt TTL — lần gọi kế tiếp phải thử nạp lại. Giá phải trả: DB hỏng KÉO DÀI ⇒ mỗi lượt
        // kiểm quyền tuần tự tốn một lần thử (đã có trần `timeoutMs`, và single-flight gộp lượt song song).
        this.onError?.(error, this.sensitivePairs === null ? "no-snapshot" : "stale-kept");
        return this.sensitivePairs; // ảnh chụp CŨ nếu có, `null` nếu chưa từng nạp được
      } finally {
        this.inFlight = null;
      }
    })();

    this.inFlight = flight;
    return flight;
  }

  /**
   * Trần thời gian cho một lượt nạp. `getAllPermissions()` không nhận `AbortSignal` nên phải race —
   * và promise THUA phải được nuốt lỗi (`.catch`), nếu không nó thành unhandled rejection sau khi
   * caller đã đi tiếp. Timer luôn được `clearTimeout` để không giữ event loop sống qua teardown test.
   */
  private withTimeout(work: Promise<PermissionCatalogEntry[]>): Promise<PermissionCatalogEntry[]> {
    work.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`permission catalog load timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
      timer.unref?.();
    });
    return Promise.race([work, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }
}
