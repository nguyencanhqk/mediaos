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
 * ADR §5.3 D9 — sàn thử-lại của nhánh SUY BIẾN-RỖNG (catalog nạp THÀNH CÔNG mà 0 hàng).
 *
 * Vì sao nhánh rỗng cần sàn mà nhánh `catch` (D2) thì không: khi `load()` NÉM, DB đang chết ⇒ mỗi lượt
 * thử đã tự có giá (và trần `timeoutMs`), và trạng thái TỰ HẾT khi DB sống lại. Khi `load()` trả 0
 * hàng thì DB **khoẻ**: query thành công và NHANH, còn trạng thái **không tự lành** nếu chưa ai chạy
 * seed ⇒ không có sàn thì mỗi `can()` = 1 `SELECT` + 1 `logger.error`, **mãi mãi**, trên đúng hot-path
 * mà MỌI kiểm quyền đi qua (single-flight chỉ gộp lượt SONG SONG, không gộp lượt tuần tự).
 *
 * Vì sao 5s: ≪ TTL 300s nên không tái lập «khoá suy biến 300s» mà D2 cấm; ≫ thời gian một request nên
 * mọi `can()` trong cùng một request chia nhau MỘT lần thử; đủ để một vòng poll dashboard không đẻ ra
 * hai query.
 */
export const PERMISSION_CATALOG_EMPTY_RETRY_MS = 5_000;

/** KẾT QUẢ suy biến — suy DUY NHẤT từ `sensitivePairs === null`. Đừng nhét nguyên nhân vào đây. */
export type CatalogDegradePhase = "stale-kept" | "no-snapshot";

/** NGUYÊN NHÂN suy biến — trực giao với `CatalogDegradePhase` (một sự cố rỗng vẫn có thể stale-kept). */
export type CatalogDegradeCause = "load-failed" | "empty-catalog";

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
  /** ADR D9 — sàn thử-lại nhánh rỗng. TIÊM để test không phải chờ 5s thật. */
  degradedRetryMs?: number;
  /**
   * Gọi khi suy biến. KHÔNG được ném.
   *
   * `phase` = KẾT QUẢ (giữ được ảnh cũ hay không), `cause` = NGUYÊN NHÂN. Hai chiều TÁCH BẠCH: nhét
   * cause vào `phase` làm `degradedTo` ở `permission.service.ts` NÓI DỐI ở ca «rỗng nhưng CÓ ảnh cũ»
   * (kết quả là stale-kept, không phải siết) — bẫy `cache-breaks-two-source-flag-invariants`.
   *
   * Handler 2 tham số vẫn gán được (structural typing) ⇒ thêm `cause` là non-breaking.
   */
  onError?: (error: unknown, phase: CatalogDegradePhase, cause: CatalogDegradeCause) => void;
}

export class PermissionCatalogSnapshot {
  /** `null` = CHƯA từng nạp thành công. Set chứa khoá của các cặp `is_sensitive = true`. */
  private sensitivePairs: Set<string> | null = null;
  private loadedAtMs = 0;
  /** ADR §5.3 D6 — single-flight. Promise này KHÔNG BAO GIỜ reject (xem `refresh`). */
  private inFlight: Promise<Set<string> | null> | null = null;
  /**
   * Thế hệ ảnh chụp, tăng ở mỗi `reset()`. Một lượt nạp CHỈ được ghi kết quả nếu thế hệ của nó còn
   * hiện hành — xem `refresh`. Không có nó, `reset()` giữa chừng làm lượt nạp CŨ ghi đè lượt MỚI.
   */
  private epoch = 0;
  /**
   * ADR D9 — mốc `now()` mà TRƯỚC đó không thử nạp lại. `0` = không có sàn.
   *
   * Chỉ nhánh SUY BIẾN-RỖNG đặt nó. Đường gỡ THẬT có hai: **tự hết hạn** (so với `now()`) và
   * `reset()`.
   *
   * ⚠️ Dòng `retryNotBeforeMs = 0` ở nhánh nạp LÀNH là **phòng thủ, KHÔNG phải một đường gỡ** — nó
   * không thể chạy khi sàn còn hiệu lực: sàn được kiểm ở ĐẦU `refresh()` nên không lượt nạp nào khởi
   * động được trong cửa sổ sàn, và single-flight bảo đảm không có lượt nào đang bay sẵn lúc sàn được
   * đặt (sàn được đặt và ô `inFlight` được nhả trong cùng một job đồng bộ). Nghĩa là: sàn nào mà một
   * lượt nạp lành với tới được thì đã hết hạn từ trước, tức đã trơ. Giữ dòng đó vì nó vô hại và
   * đúng-theo-ý-định; đừng viết vào tài liệu rằng nó là một cơ chế nhả.
   */
  private retryNotBeforeMs = 0;

  private readonly load: () => Promise<PermissionCatalogEntry[]>;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly degradedRetryMs: number;
  private readonly onError?: (
    error: unknown,
    phase: CatalogDegradePhase,
    cause: CatalogDegradeCause,
  ) => void;

  constructor(deps: PermissionCatalogSnapshotDeps) {
    this.load = deps.load;
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? PERMISSION_CATALOG_TTL_MS;
    this.timeoutMs = deps.timeoutMs ?? PERMISSION_CATALOG_LOAD_TIMEOUT_MS;
    this.degradedRetryMs = deps.degradedRetryMs ?? PERMISSION_CATALOG_EMPTY_RETRY_MS;
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

  /**
   * ADR §5.3 D7 — seam test. Gọi qua `PermissionService.resetCatalogSnapshotForTest()`.
   *
   * ⚠️ `reset()` KHÔNG huỷ được lượt nạp đang bay (không có AbortController xuyên qua `load`), nên nó
   * **đánh dấu** thay vì **chờ**: tăng `epoch` để lượt cũ tự biết mình lạc hậu và không ghi gì. Bỏ
   * `epoch` đi thì chuỗi «nạp L1 đang bay → reset() → L2 nạp xong ghi ảnh MỚI → L1 về, ghi đè ảnh CŨ»
   * dựng lại một ảnh chụp sai trong im lặng — và `finally` của L1 còn xoá luôn ô `inFlight` của L2.
   */
  reset(): void {
    this.epoch += 1;
    this.sensitivePairs = null;
    this.loadedAtMs = 0;
    this.inFlight = null;
    // ADR D9 — gỡ CẢ sàn thử-lại. Thiếu dòng này thì seam D7 mất tác dụng đúng lúc cần nhất: int-spec
    // seed cặp quyền mới rồi gọi `resetCatalogSnapshotForTest()` sẽ vẫn bị sàn chặn.
    this.retryNotBeforeMs = 0;
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

    // ADR D9 — sàn thử-lại của nhánh SUY BIẾN-RỖNG (xem `PERMISSION_CATALOG_EMPTY_RETRY_MS`).
    //
    // ⚠️ Sàn KHÔNG được gỡ ở nhánh `catch`, và đó là CHỦ Ý — chứng minh: sàn được kiểm ở ĐẦU
    // `refresh()`, nên khi sàn còn hiệu lực thì KHÔNG lượt nạp nào chạy ⇒ `catch` không thể chạy trong
    // cửa sổ sàn; và một sàn ĐÃ quá hạn là trơ (`now() < past` = false). Thêm `retryNotBeforeMs = 0`
    // vào `catch` là một dòng không ai giải thích được — đừng «vá cho chắc».
    if (this.now() < this.retryNotBeforeMs) return Promise.resolve(this.sensitivePairs);

    const epochAtStart = this.epoch;

    // M2 — khởi động HÁO HỨC, ngay trong lượt ĐỒNG BỘ này, rồi CHỜ trong thân async.
    //
    // Vì sao không gói cả thân vào `Promise.resolve().then(...)`: cách đó hoãn luôn lời gọi `load()`
    // sang microtask, làm ca D6 (đếm `load` ĐỒNG BỘ ngay sau khi phát N lượt song song) thấy 0 — tức
    // là hạ sàn một ca đang đo thật.
    //
    // `try` phải ôm CẢ biểu thức, không chỉ `this.load()`: `withTimeout` cũng ném ĐỒNG BỘ được
    // (`work.catch(...)` trên một non-promise ⇒ TypeError). Ném đồng bộ ở đây mà không bọc sẽ thoát
    // khỏi `refresh()` và CƯỚP MẤT dòng `this.inFlight = flight` bên dưới ⇒ ô ghim một promise ĐÃ
    // settle mà `finally` không còn cơ hội xoá ⇒ mọi cặp = sensitive VĨNH VIỄN tới khi restart.
    let started: Promise<PermissionCatalogEntry[]>;
    try {
      started = this.withTimeout(this.load());
    } catch (syncError: unknown) {
      started = Promise.reject(syncError);
    }

    const flight = (async (): Promise<Set<string> | null> => {
      try {
        // `await` LUÔN nhường ít nhất một microtask, kể cả trên promise ĐÃ settle ⇒ thân này KHÔNG
        // THỂ settle đồng bộ ⇒ `finally` chắc chắn chạy SAU `this.inFlight = flight`. Đó là bất biến
        // khoá bản vá M2.
        const rows = await started;
        // `reset()` xen vào giữa lượt nạp ⇒ kết quả này đã LẠC HẬU: không ghi đè ảnh mà lượt sau
        // (chạy trên catalog mới hơn) có thể đã đặt.
        //
        // Kiểm epoch nằm TRƯỚC kiểm rỗng: một lượt đã lạc hậu KHÔNG được đặt `retryNotBeforeMs` cho
        // một thế hệ ảnh chụp mà không ai còn dùng — nếu không, `reset()` xen giữa để lại một cái sàn
        // mồ côi, tức là «M2 phiên bản 2».
        if (epochAtStart !== this.epoch) return this.sensitivePairs;

        // ADR D9 — `permissions` là catalog GLOBAL do migration seed. 0 hàng là phát biểu HẠ TẦNG
        // («chưa seed / vừa bị xoá»), KHÔNG phải phát biểu nghiệp vụ («hệ này không có cặp nhạy cảm
        // nào»). Coi nó hợp lệ là để một sự cố hạ tầng TỰ TUYÊN BỐ rằng không có gì cần bảo vệ — và
        // đóng dấu tuyên bố đó suốt TTL, không một dòng log. Đối xứng ngược với nhánh `catch` bên
        // dưới: cùng một sự cố mà biểu hiện bằng THROW thì siết + có vết.
        //
        // ⚠️⚠️ VỊ NGỮ LÀ `rows.length`, TUYỆT ĐỐI KHÔNG `next.size`. Đổi sang `next.size === 0` trông
        // như dọn dẹp vô hại (thậm chí «chặt hơn») nhưng nó biến MỌI catalog không có cặp sensitive
        // nào thành trạng thái suy biến — kể cả các stub repo hợp lệ trong test. Có ca ghim.
        //
        // Hệ quả ĐƯỢC CHỌN, không phải bỏ sót: catalog CÓ hàng mà 0 hàng `isSensitive` (một migration
        // hỏng xoá sạch cờ) là fail-OPEN mà D9 KHÔNG bắt — vì không phân biệt được với một hệ hợp lệ
        // không có cặp nhạy cảm nào.
        if (rows.length === 0) {
          // Không đóng dấu `loadedAtMs` (lượt sau vẫn phải thử lại), nhưng CÓ đặt sàn: DB ở đây
          // KHOẺ ⇒ query nhanh và trạng thái không tự lành ⇒ không có sàn thì mỗi `can()` đẻ ra
          // một query + một dòng log, mãi mãi, trên hot-path.
          this.retryNotBeforeMs = this.now() + this.degradedRetryMs;
          this.emitError(
            new Error("permission catalog loaded 0 rows — degenerate (ADR DECISIONS-12 D9)"),
            this.sensitivePairs === null ? "no-snapshot" : "stale-kept",
            "empty-catalog",
          );
          // Ảnh chụp CŨ nếu có; `null` nếu chưa từng nạp được ⇒ mọi cặp = sensitive = SIẾT.
          return this.sensitivePairs;
        }

        const next = new Set<string>();
        for (const row of rows) {
          if (row.isSensitive) next.add(pairKey(row.action, row.resourceType));
        }
        this.sensitivePairs = next;
        this.loadedAtMs = this.now();
        this.retryNotBeforeMs = 0; // nạp LÀNH ⇒ gỡ sàn
        return next;
      } catch (error: unknown) {
        // ADR §5.3 D2. CỐ Ý không đóng dấu `loadedAtMs`: một blip DB không được khoá trạng thái suy
        // biến suốt TTL — lần gọi kế tiếp phải thử nạp lại. Giá phải trả: DB hỏng KÉO DÀI ⇒ mỗi lượt
        // kiểm quyền tuần tự tốn một lần thử (đã có trần `timeoutMs`, và single-flight gộp lượt song song).
        this.emitError(
          error,
          this.sensitivePairs === null ? "no-snapshot" : "stale-kept",
          "load-failed",
        );
        return this.sensitivePairs; // ảnh chụp CŨ nếu có, `null` nếu chưa từng nạp được
      } finally {
        // CHỈ nhả ô của CHÍNH mình: sau `reset()`, ô này có thể đang giữ lượt nạp MỚI hơn — xoá nó là
        // mở đường cho hai lượt nạp chạy song song, đúng thứ single-flight sinh ra để chặn.
        if (epochAtStart === this.epoch) this.inFlight = null;
      }
    })();

    this.inFlight = flight;
    return flight;
  }

  /**
   * Hook quan sát KHÔNG được phá hợp đồng "không bao giờ ném" của lớp này.
   *
   * `onError` trong sản phẩm là `logger.error` — một transport log hỏng mà ném ra sẽ khiến promise
   * single-flight **reject**, đúng điều doc-block ở đầu `refresh` cấm. Hệ quả dây chuyền: mọi caller
   * đang chờ chung lượt đó (vd `Promise.all` của dashboard) nhận reject thay vì sentinel, và lỗi
   * NGUYÊN NHÂN (DB/catalog) bị thay bằng lỗi THỨ CẤP của chính logger.
   *
   * Nuốt lỗi ở đây là chọn có ý thức: mất một dòng log còn hơn biến một sự cố ĐÃ XỬ LÝ thành reject
   * trên đường mà MỌI `can()` đi qua.
   */
  private emitError(error: unknown, phase: CatalogDegradePhase, cause: CatalogDegradeCause): void {
    try {
      this.onError?.(error, phase, cause);
    } catch {
      /* hook quan sát hỏng KHÔNG được leo thang thành lỗi quyền */
    }
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
