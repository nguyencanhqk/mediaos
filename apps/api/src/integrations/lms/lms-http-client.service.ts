import { Injectable, Logger } from "@nestjs/common";

/** 1 user gửi sang LMS. name optional (đường TẠO account cần; khoá/mở chỉ cần email+active). */
export interface LmsSyncUser {
  email: string;
  name?: string;
  active: boolean;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * S5-LMS-BE-1 — client server-to-server tới LMS `POST /api/admin/sync-users` (upsert per-email idempotent).
 * Body `{ users: [...] }`, header `Authorization: Bearer <LMS_SYNC_TOKEN>` (= MEDIAOS_SYNC_TOKEN phía LMS).
 *
 * BẤT BIẾN #3: token đọc từ env, KHÔNG hardcode/log. `syncUsers` KHÔNG log email/body ở error path —
 * chỉ status + message (không kèm payload). LMS 5xx/timeout → THROW để caller (bridge) được outbox-worker
 * retry ×5 → dead-letter. Env thiếu → isEnabled()=false; caller tự quyết skip (KHÔNG gọi syncUsers khi tắt).
 */
@Injectable()
export class LmsHttpClient {
  private readonly logger = new Logger(LmsHttpClient.name);
  private readonly baseUrl = process.env.LMS_BASE_URL?.replace(/\/+$/, "") ?? null;
  private readonly token = process.env.LMS_SYNC_TOKEN ?? null;

  /** Auto-sync bật khi có ĐỦ base URL + token (company-gate kiểm riêng ở producer/bridge/job). */
  isEnabled(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  /**
   * POST 1+ user sang LMS. Không kiểm isEnabled ở đây — caller PHẢI kiểm trước (fail-closed). Ném khi
   * chưa cấu hình (bảo vệ: gọi nhầm lúc tắt = lỗi lập trình, không im lặng), khi timeout, hoặc khi !ok.
   */
  async syncUsers(users: LmsSyncUser[]): Promise<void> {
    if (!this.baseUrl || !this.token) {
      throw new Error("LMS auto-sync chưa cấu hình (LMS_BASE_URL/LMS_SYNC_TOKEN)");
    }
    if (users.length === 0) return;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/admin/sync-users`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ users }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeout/network — KHÔNG log body/email (BẤT BIẾN #3), chỉ message. Ném để được retry.
      const message = err instanceof Error ? err.message : "unknown network error";
      this.logger.warn(`LMS sync request failed (network): ${message}`);
      throw new Error(`LMS sync network error: ${message}`);
    }

    if (!res.ok) {
      // KHÔNG đọc/log response body (có thể vọng lại email). Chỉ status. Ném để được retry.
      this.logger.warn(`LMS sync trả HTTP ${res.status}`);
      throw new Error(`LMS sync HTTP ${res.status}`);
    }
  }
}
