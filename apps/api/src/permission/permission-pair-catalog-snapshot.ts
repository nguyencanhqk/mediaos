/**
 * S14-SEC-CAPWILDCARD-1 — ảnh chụp DANH SÁCH CẶP của catalog `permissions` (kèm cờ `is_sensitive`), nguồn
 * khai triển grant wildcard cho `capabilities` / `scopes` (plan §4.3.1, ADR `DECISIONS-13`).
 *
 * LỚP MỚI, KHÔNG tái dùng / gộp vào `PermissionCatalogSnapshot`: hai lớp mượn cùng HÌNH DẠNG (TTL 300 s ·
 * trần nạp 5 s · single-flight · epoch · hook `onError` · state per-instance) nhưng bất biến suy biến
 * NGƯỢC CHIỀU — gộp hai bất biến ngược chiều vào một ô là đúng khuôn
 * `cache-breaks-two-source-flag-invariants`.
 *
 * |          | `PermissionCatalogSnapshot`   | `PermissionPairCatalogSnapshot` (lớp này)                  |
 * | -------- | ----------------------------- | ---------------------------------------------------------- |
 * | Giữ gì   | tập cặp sensitive             | danh sách CẶP kèm cờ, ĐÃ LOẠI hàng chứa `*`                |
 * | Suy biến | SIẾT — mọi cặp = sensitive    | giữ ẢNH CŨ; chưa từng nạp ⇒ RỖNG (+ `onError`)             |
 * | Ai đọc   | `can()` — CỔNG                | `getCapabilities`/`getCapabilityScopes` — GỢI Ý UI         |
 *
 * Chiều suy biến kể ĐÚNG (plan §4.4): RỖNG ở đây nghĩa là actor giữ wildcard MẤT phần khoá khai triển
 * (giữ khoá exact) ⇒ SIẾT, không nới. Không bao giờ phát `*:*` để «giữ hành vi cũ» — đó là đổi một sự cố
 * khả dụng lấy một lỗ. Không dựng sàn thử-lại kiểu ADR-12 D9: đường này không phải hot-path `can()` —
 * chỉ actor giữ wildcard mới đọc tới đây.
 *
 * ⚠️ KHÔNG BAO GIỜ ném / reject: mọi lỗi nạp ⇒ giá trị suy biến + `onError` (luật quan sát).
 *
 * Nợ ghi nhận (plan §13.2): `capabilities` nay phụ thuộc CATALOG (không chỉ grant) — seed cặp mới hoặc
 * lật `is_sensitive` đổi caps sau tối đa một TTL. `can()` đọc ảnh chụp KHÁC (cờ sensitive, TTL riêng,
 * mốc nạp độc lập) ⇒ cửa sổ hai ảnh lệch nhau tới ~2 × TTL, tính riêng từng instance (gate CW-G3); deploy
 * khởi động lại nạp cả hai cùng lúc. Ai reset ảnh chụp cho test phải reset CẢ HAI
 * (`PermissionService.resetCatalogSnapshotForTest()` làm việc đó).
 */
import type { CapabilityCatalogPair } from "./capability-projection";
import {
  PERMISSION_CATALOG_LOAD_TIMEOUT_MS,
  PERMISSION_CATALOG_TTL_MS,
  type CatalogDegradeCause,
  type CatalogDegradePhase,
} from "./permission-catalog-snapshot";
import type { PermissionCatalogEntry } from "./permission.types";

export interface PermissionPairCatalogSnapshotDeps {
  /** Nạp toàn catalog (global, no-RLS, không cột `company_id`). Thường là `() => repo.getAllPermissions()`. */
  load: () => Promise<PermissionCatalogEntry[]>;
  /** Đồng hồ tiêm được; mặc định `Date.now`. */
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
  /**
   * Gọi khi suy biến. KHÔNG được ném (có nuốt phòng thủ). `phase` = KẾT QUẢ (giữ ảnh cũ hay rỗng),
   * `cause` = NGUYÊN NHÂN — hai chiều tách bạch như lớp cũ.
   */
  onError?: (error: unknown, phase: CatalogDegradePhase, cause: CatalogDegradeCause) => void;
}

const NO_PAIRS: readonly CapabilityCatalogPair[] = Object.freeze([]);

export class PermissionPairCatalogSnapshot {
  /** `null` = CHƯA từng nạp thành công. */
  private pairs: readonly CapabilityCatalogPair[] | null = null;
  private loadedAtMs = 0;
  /** Single-flight. Promise này KHÔNG BAO GIỜ reject (try/catch nằm bên trong). */
  private inFlight: Promise<readonly CapabilityCatalogPair[]> | null = null;
  /** Thế hệ ảnh chụp, tăng ở mỗi `reset()` — lượt nạp lạc hậu không được ghi đè ảnh mới. */
  private epoch = 0;

  private readonly load: () => Promise<PermissionCatalogEntry[]>;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly onError?: PermissionPairCatalogSnapshotDeps["onError"];

  constructor(deps: PermissionPairCatalogSnapshotDeps) {
    this.load = deps.load;
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? PERMISSION_CATALOG_TTL_MS;
    this.timeoutMs = deps.timeoutMs ?? PERMISSION_CATALOG_LOAD_TIMEOUT_MS;
    this.onError = deps.onError;
  }

  /**
   * Danh sách cặp (không hàng nào chứa `*`). Ảnh còn hạn ⇒ trả ngay; hết hạn / chưa có ⇒ nạp lại
   * (single-flight, trần `timeoutMs`). Nạp hỏng/rỗng/quá trần ⇒ ẢNH CŨ nếu có, ngược lại RỖNG.
   */
  async list(): Promise<readonly CapabilityCatalogPair[]> {
    if (this.pairs !== null && this.now() - this.loadedAtMs < this.ttlMs) return this.pairs;
    return this.refresh();
  }

  /** Seam test — gọi qua `PermissionService.resetCatalogSnapshotForTest()`. Đánh dấu, không chờ. */
  reset(): void {
    this.epoch += 1;
    this.pairs = null;
    this.loadedAtMs = 0;
    this.inFlight = null;
  }

  private current(): readonly CapabilityCatalogPair[] {
    return this.pairs ?? NO_PAIRS;
  }

  private phase(): CatalogDegradePhase {
    return this.pairs === null ? "no-snapshot" : "stale-kept";
  }

  private refresh(): Promise<readonly CapabilityCatalogPair[]> {
    if (this.inFlight !== null) return this.inFlight;
    const epochAtStart = this.epoch;

    // Khởi động ĐỒNG BỘ rồi chờ trong thân async; `try` ôm cả `withTimeout` vì nó cũng ném đồng bộ được
    // (non-promise) — ném thoát ra ngoài sẽ cướp dòng `this.inFlight = flight` bên dưới.
    let started: Promise<PermissionCatalogEntry[]>;
    try {
      started = this.withTimeout(this.load());
    } catch (syncError: unknown) {
      started = Promise.reject(syncError);
    }

    const flight = (async (): Promise<readonly CapabilityCatalogPair[]> => {
      try {
        const rows = await started;
        if (epochAtStart !== this.epoch) return this.current();
        // `permissions` là catalog GLOBAL do migration seed ⇒ 0 hàng là sự cố HẠ TẦNG, không phải
        // «không có cặp nào». Không đóng dấu: lượt sau thử lại.
        if (rows.length === 0) {
          this.emitError(
            new Error("permission pair catalog loaded 0 rows — degenerate"),
            this.phase(),
            "empty-catalog",
          );
          return this.current();
        }
        this.pairs = Object.freeze(
          rows
            .filter((r) => !r.action.includes("*") && !r.resourceType.includes("*"))
            .map((r) => ({
              action: r.action,
              resourceType: r.resourceType,
              isSensitive: r.isSensitive,
            })),
        );
        this.loadedAtMs = this.now();
        return this.pairs;
      } catch (error: unknown) {
        // Không đóng dấu `loadedAtMs`: một blip DB không được khoá trạng thái suy biến suốt TTL.
        this.emitError(error, this.phase(), "load-failed");
        return this.current();
      } finally {
        // CHỈ nhả ô của CHÍNH mình — sau `reset()` ô có thể đang giữ lượt nạp mới hơn.
        if (epochAtStart === this.epoch) this.inFlight = null;
      }
    })();

    this.inFlight = flight;
    return flight;
  }

  /** Hook quan sát hỏng KHÔNG được biến promise single-flight thành reject. */
  private emitError(error: unknown, phase: CatalogDegradePhase, cause: CatalogDegradeCause): void {
    try {
      this.onError?.(error, phase, cause);
    } catch {
      /* mất một dòng log còn hơn reject trên đường /auth/me */
    }
  }

  /** Trần một lượt nạp; promise THUA được nuốt lỗi; timer luôn được dọn. */
  private withTimeout(work: Promise<PermissionCatalogEntry[]>): Promise<PermissionCatalogEntry[]> {
    work.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`permission pair catalog load timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
      timer.unref?.();
    });
    return Promise.race([work, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }
}
