import { createHash } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";
import { ValkeyService } from "../../permission/valkey.service";

/**
 * S5-BE-CONTRACT-1 (WS-D §13.2) — kho trạng thái idempotency: Valkey-first, fallback bộ nhớ.
 *
 * MIRROR `ReplayGuardService` (cùng dạng Valkey-first/memory-fallback) để hành vi nhất quán và test
 * KHÔNG cần Valkey. KHÁC ở mục đích: đây là control TRẢI NGHIỆM (chống bấm-đúp/retry mạng), KHÔNG phải
 * control an ninh ⇒ mất Valkey thì hạ về bộ nhớ single-instance là chấp nhận được (nhiều instance sẽ
 * mất khả năng chống trùng chéo-instance — ghi rõ để vận hành biết, xem docs/BACKEND-12).
 *
 * TTL ngắn có chủ ý: cửa sổ này chỉ để bắt retry của CÙNG một thao tác người dùng, không phải sổ cái.
 */

/** Cửa sổ giữ khoá (giây) — đủ dài cho retry mạng/bấm-đúp, đủ ngắn để không phình bộ nhớ. */
export const IDEMPOTENCY_TTL_SEC = 900;

/** Bỏ qua việc lưu phản hồi lớn bất thường (byte) — cache là tối ưu hoá, không phải kho dữ liệu. */
export const IDEMPOTENCY_MAX_BODY_BYTES = 64 * 1024;

/** Giá trị đánh dấu "đang chạy" (chưa có phản hồi để phát lại). */
const IN_FLIGHT = "in-flight";

/** Bản ghi phản hồi đã hoàn tất, đủ để phát lại nguyên trạng. */
interface CompletedRecord {
  status: number;
  /** Vân tay nội dung request — phát hiện dùng lại khoá cho payload KHÁC. */
  fingerprint: string;
  body: unknown;
}

/** Kết quả `begin()` — quyết định của interceptor. */
export type BeginResult =
  | { kind: "first" }
  | { kind: "in-flight" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "key-reused" };

interface MemEntry {
  expiresAtMs: number;
  value: string;
}

/** Vân tay nội dung request (sha256 rút gọn) — KHÔNG lưu chính nội dung (có thể chứa dữ liệu nhạy cảm). */
export function fingerprintBody(body: unknown): string {
  const serialized = body === undefined ? "" : (JSON.stringify(body) ?? "");
  return createHash("sha256").update(serialized).digest("hex").slice(0, 32);
}

@Injectable()
export class IdempotencyStore {
  private readonly mem = new Map<string, MemEntry>();

  constructor(@Optional() private readonly valkey?: ValkeyService) {}

  /**
   * Giành quyền chạy cho `key`.
   *  - `first`      → chưa ai giữ: caller chạy handler rồi gọi `complete()`.
   *  - `in-flight`  → request trước CÙNG khoá đang chạy → caller trả 409 (client chờ, không đổi khoá).
   *  - `replay`     → đã có phản hồi hoàn tất + cùng vân tay → caller phát lại, KHÔNG chạy nghiệp vụ.
   *  - `key-reused` → đã có phản hồi nhưng vân tay KHÁC → caller trả 409 (lỗi phía client).
   */
  async begin(key: string, fingerprint: string, nowMs: number = Date.now()): Promise<BeginResult> {
    const claimed = await this.setNx(key, IN_FLIGHT, nowMs);
    if (claimed) return { kind: "first" };

    const existing = await this.read(key, nowMs);
    // Hết hạn/biến mất giữa hai lệnh (race hiếm) → coi như lần đầu, ghi lại marker.
    if (existing === null) {
      await this.write(key, IN_FLIGHT, nowMs);
      return { kind: "first" };
    }
    if (existing === IN_FLIGHT) return { kind: "in-flight" };

    const record = this.parse(existing);
    if (record === null) return { kind: "first" }; // bản ghi hỏng → không chặn nghiệp vụ
    if (record.fingerprint !== fingerprint) return { kind: "key-reused" };
    return { kind: "replay", status: record.status, body: record.body };
  }

  /** Ghi phản hồi hoàn tất để các request sau cùng khoá phát lại. Body quá lớn → bỏ qua (nhả khoá). */
  async complete(
    key: string,
    status: number,
    fingerprint: string,
    body: unknown,
    nowMs: number = Date.now(),
  ): Promise<void> {
    const record: CompletedRecord = { status, fingerprint, body };
    let serialized: string;
    try {
      serialized = JSON.stringify(record);
    } catch {
      // Body không serialize được (vòng lặp tham chiếu/BigInt) → nhả khoá, lần sau chạy lại thật.
      await this.release(key);
      return;
    }
    if (Buffer.byteLength(serialized, "utf8") > IDEMPOTENCY_MAX_BODY_BYTES) {
      await this.release(key);
      return;
    }
    await this.write(key, serialized, nowMs);
  }

  /** Nhả khoá (handler NÉM lỗi) — lỗi KHÔNG được cache: client phải gọi lại thật với cùng khoá. */
  async release(key: string): Promise<void> {
    if (this.useValkey) {
      await this.valkey?.del(key);
      return;
    }
    this.mem.delete(key);
  }

  // ── Tầng lưu trữ ────────────────────────────────────────────────────────────
  //
  // CHỌN ĐÚNG MỘT tầng cho cả vòng đời một khoá: Valkey khi được cấu hình, ngược lại bộ nhớ tiến trình.
  // KHÔNG ghi song song 2 nơi — bản sao bóng trong RAM chỉ làm phình bộ nhớ ở prod mà không thêm bảo đảm
  // nào (Valkey đã là nguồn chung cho mọi instance). Valkey bật nhưng lỗi → ValkeyService fail-soft
  // (get→null, set→false) ⇒ suy biến thành "không chống trùng" chứ KHÔNG chặn nghiệp vụ.

  private get useValkey(): boolean {
    return this.valkey?.isEnabled() === true;
  }

  private async setNx(key: string, value: string, nowMs: number): Promise<boolean> {
    if (this.useValkey) {
      // null (Valkey rớt) → coi như giành được: thà chạy nghiệp vụ thật còn hơn chặn oan người dùng.
      return (await this.valkey?.setNx(key, value, IDEMPOTENCY_TTL_SEC)) !== false;
    }
    const existing = this.mem.get(key);
    if (existing !== undefined && existing.expiresAtMs > nowMs) return false;
    this.mem.set(key, { value, expiresAtMs: nowMs + IDEMPOTENCY_TTL_SEC * 1000 });
    this.prune(nowMs);
    return true;
  }

  private async read(key: string, nowMs: number): Promise<string | null> {
    if (this.useValkey) return (await this.valkey?.get(key)) ?? null;
    const entry = this.mem.get(key);
    if (entry === undefined || entry.expiresAtMs <= nowMs) return null;
    return entry.value;
  }

  private async write(key: string, value: string, nowMs: number): Promise<void> {
    if (this.useValkey) {
      await this.valkey?.set(key, value, IDEMPOTENCY_TTL_SEC);
      return;
    }
    this.mem.set(key, { value, expiresAtMs: nowMs + IDEMPOTENCY_TTL_SEC * 1000 });
    this.prune(nowMs);
  }

  private parse(raw: string): CompletedRecord | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as CompletedRecord).status === "number" &&
        typeof (parsed as CompletedRecord).fingerprint === "string"
      ) {
        return parsed as CompletedRecord;
      }
    } catch {
      // rơi xuống null
    }
    return null;
  }

  /** Dọn entry hết hạn để Map không phình vô hạn (mirror ReplayGuardService). */
  private prune(nowMs: number): void {
    for (const [k, v] of this.mem) {
      if (v.expiresAtMs <= nowMs) this.mem.delete(k);
    }
  }
}
