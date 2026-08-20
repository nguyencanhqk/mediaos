import { Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { loadEnv } from "../../config/env.schema";
import { ERROR_CODES } from "../../common/errors/error-codes";
import { ValkeyService } from "../../permission/valkey.service";
import { stepUpKey } from "../../common/valkey/valkey-key";

/** Bộ-5 khoá một cửa sổ. Mọi thành phần đứng TRONG khoá — không cái nào "suy ra" từ ngữ cảnh request. */
export interface StepUpWindowKey {
  companyId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
}

/**
 * StepUpWindowService — CỬA SỔ xác thực lại lưu PHÍA SERVER (DECISIONS-09 §6 điểm 1, 6, 7).
 *
 * `POST /auth/step-up` GHI, `ReauthGuard` ĐỌC. Client KHÔNG giữ chứng chỉ nào: body phản hồi chỉ mang mốc
 * hết hạn để FE biết khi nào phải hỏi lại; sửa/bịa giá trị đó ở client không mở được gì.
 *
 * ─── §6(6) NGỮ NGHĨA: DÙNG-LẠI-ĐƯỢC TRONG TTL, TTL TUYỆT ĐỐI ────────────────────────────────────
 * Một cửa sổ đã cấp dùng lại được nhiều lần cho tới khi hết TTL (một thao tác UI thường đẻ >1 request:
 * ghi rồi refetch, hoặc replay sau 401). Bán kính nổ đã bị bộ-5 chặn: không mở được đối tượng khác,
 * người khác, công ty khác, hành động khác.
 *
 * ⛔ Vì thế `getValidWindow()` là ĐỌC THUẦN: **CẤM** `SET`/`EXPIRE`/`TOUCH`/`GETEX`/ghi lại entry — kể cả
 * "chỉ dọn cho gọn". Thiếu ràng buộc này, sliding-window biến TTL 5 phút thành phiên step-up VÔ HẠN cho
 * ai còn gõ tiếp. Dọn entry hết hạn nằm ở đường GHI (`grant`), nơi việc ghi vốn đã hợp lệ.
 *
 * ─── §6(7) NHÁNH LƯU CHỌN THEO `isEnabled()`, KHÔNG SUY TỪ `set()` ──────────────────────────────
 * `ValkeyService.set()` có `if (!this.client) return true` (valkey.service.ts:99) — ở môi trường thiếu
 * `VALKEY_URL` nó trả `true` MÀ KHÔNG GHI GÌ. Ai kiểm giá trị trả về của `set()` NGAY TRONG một điều
 * kiện phủ định rồi ném lỗi sẽ thấy `true`, trả 200 kèm `reauthValidUntil`, trong khi cửa sổ không nằm
 * ở đâu cả ⇒ guard đọc null ⇒ 403 CÂM = KI-065 nguyên xi. Vì vậy nhánh rẽ theo `isEnabled()` (khuôn `ReplayGuardService:52` /
 * `LoginRateLimiter:117`), và CHỈ TRONG nhánh "Valkey bật" mới kiểm kết quả `set()`:
 *   · bật + set() false = outage THẬT ⇒ 503 tường minh. **Không** rơi memory: ở deployment nhiều
 *     instance, memory của instance A vô hình với instance B ⇒ đúng bẫy "200 nhưng 403 vĩnh viễn".
 *   · chưa cấu hình ⇒ fallback memory per-process, tôn trọng TTL (dev/test/single-instance).
 * Đường ĐỌC rẽ theo CÙNG nhánh — ghi memory mà đọc Valkey (hoặc ngược lại) là deny vĩnh viễn.
 *
 * HỆ QUẢ VẬN HÀNH PHẢI NÓI RA: chạy >1 instance API mà KHÔNG có `VALKEY_URL` ⇒ cửa sổ mint ở instance A
 * vô hình ở instance B ⇒ deny (fail-closed: mất tiện, KHÔNG mất an toàn). PROD/dev-online BẮT BUỘC có
 * `VALKEY_URL`.
 *
 * ─── CODEC ──────────────────────────────────────────────────────────────────────────────────────
 * Valkey lưu STRING; `permission.decide.isReauthValid()` nhận `Date`. Đường đọc deserialize lại thành
 * `Date` và trả `Date | null` — CHỈ mốc ĐỌC ĐƯỢC TỪ STORE, không bao giờ tự tính `Date.now() + ttl`
 * (tự tính = cửa sổ "hợp lệ" cho một khoá chưa từng được ghi).
 */
@Injectable()
export class StepUpWindowService {
  private readonly env = loadEnv();
  /** Fallback per-process. Khoá theo chuỗi ĐÃ scoped: hai môi trường trên cùng máy không chung ô nhớ. */
  private readonly memory = new Map<string, number>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /** TTL cửa sổ (giây) — `STEP_UP_TTL_SEC`, có `.default()` VÀ `.max(1800)` ở env.schema. */
  get ttlSec(): number {
    return this.env.STEP_UP_TTL_SEC;
  }

  /**
   * Cấp cửa sổ. Trả mốc hết hạn ĐÃ ghi được. Ném 503 khi Valkey bật nhưng ghi hỏng (outage thật).
   */
  async grant(key: StepUpWindowKey, nowMs: number = Date.now()): Promise<Date> {
    const storeKey = this.storeKey(key);
    const expiresAtMs = nowMs + this.ttlSec * 1000;
    const expiresAt = new Date(expiresAtMs);

    if (this.valkey?.isEnabled() === true) {
      // Gán vào BIẾN CÓ TÊN rồi mới kiểm (§6.7). Hình dạng này CỐ Ý khác kiểu kiểm-thẳng-trong-điều-kiện:
      // ở đây ta CHỈ tới được dòng này khi `isEnabled()` đã true, nên `false` mới thật sự là outage.
      const written = await this.valkey.set(storeKey, expiresAt.toISOString(), this.ttlSec);
      if (written !== true) {
        throw new ServiceUnavailableException({
          code: ERROR_CODES.SYSTEM,
          message: "Không thể ghi cửa sổ xác thực lại — vui lòng thử lại.",
        });
      }
      return expiresAt;
    }

    this.memory.set(storeKey, expiresAtMs);
    this.pruneExpired(nowMs);
    return expiresAt;
  }

  /**
   * Đọc cửa sổ còn hạn. `null` = không có / hết hạn / không giải mã được ⇒ caller DENY (fail-closed).
   * ĐỌC THUẦN — không ghi, không gia hạn, không tiêu thụ.
   */
  async getValidWindow(key: StepUpWindowKey, nowMs: number = Date.now()): Promise<Date | null> {
    const storeKey = this.storeKey(key);

    if (this.valkey?.isEnabled() === true) {
      const raw = await this.valkey.get(storeKey);
      if (raw === null) return null;
      const parsed = new Date(raw);
      // Chuỗi rác ⇒ `Invalid Date`; so sánh với Invalid Date luôn false nên nó sẽ "hết hạn" một cách
      // mập mờ. Chặn tường minh để null có đúng MỘT nghĩa: không có cửa sổ dùng được.
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.getTime() > nowMs ? parsed : null;
    }

    const expiresAtMs = this.memory.get(storeKey);
    if (expiresAtMs === undefined || expiresAtMs <= nowMs) return null;
    return new Date(expiresAtMs);
  }

  private storeKey(key: StepUpWindowKey): string {
    return stepUpKey(key.companyId, key.userId, key.action, key.resourceType, key.resourceId);
  }

  /** Dọn entry hết hạn ở ĐƯỜNG GHI (không phải đường đọc — xem docblock §6.6). */
  private pruneExpired(nowMs: number): void {
    for (const [k, expiresAtMs] of this.memory) {
      if (expiresAtMs <= nowMs) this.memory.delete(k);
    }
  }
}
