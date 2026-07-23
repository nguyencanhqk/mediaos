import { Injectable, Logger } from "@nestjs/common";

/** 1 user gửi sang LMS. name optional (đường TẠO account cần; khoá/mở chỉ cần email+active). */
export interface LmsSyncUser {
  email: string;
  name?: string;
  active: boolean;
}

/**
 * S5-LMS-BE-4 — kết quả 1 lần đồng bộ, do LMS trả về (`POST /api/admin/sync-users`).
 *
 * LUẬT KIỂU: MỌI field CHỈ `number` hoặc `boolean`. **CẤM `string`** — đây là thứ chặn đường body-text
 * của LMS lọt vào `metadata` `audit_logs` (append-only, KHÔNG xoá được) và `system_job_runs.error_message`.
 *
 * PHÂN HOẠCH per-user — 6 counter, tổng LUÔN `=== users.length` (mỗi user rơi đúng 1 nhánh của
 * `apps/lms/app/api/admin/sync-users/route.ts:75-107`):
 *   THAY ĐỔI  : created + reactivated + deactivated   → tính vào `changed` (⇒ ghi audit)
 *   KHÔNG ĐỔI : existing + skipped + alreadyDisabled  → KHÔNG vào `changed`, NHƯNG VÀO tổng
 */
export interface LmsSyncSummary {
  created: number;
  existing: number;
  reactivated: number;
  deactivated: number;
  skipped: number;
  /** HỢP ĐỒNG (không phải field lạ) — user vốn ĐÃ khoá từ trước, LMS không ghi gì thêm. */
  alreadyDisabled: number;
  /** true khi KHÔNG đọc/parse/tin được summary → caller PHẢI fail-safe (coi như có thể có thay đổi). */
  unknown: boolean;
}

/** Whitelist counter — field NGOÀI danh sách này bị bỏ qua im lặng (KHÔNG bật `unknown`). */
const SUMMARY_COUNTERS = [
  "created",
  "existing",
  "reactivated",
  "deactivated",
  "skipped",
  "alreadyDisabled",
] as const;

const REQUEST_TIMEOUT_MS = 10_000;

function zeroSummary(unknown = false): LmsSyncSummary {
  return {
    created: 0,
    existing: 0,
    reactivated: 0,
    deactivated: 0,
    skipped: 0,
    alreadyDisabled: 0,
    unknown,
  };
}

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
   * POST 1+ user sang LMS, trả summary ĐẾM để caller quyết định có ghi audit hay không (S5-LMS-BE-4).
   * Không kiểm isEnabled ở đây — caller PHẢI kiểm trước (fail-closed). Ném khi chưa cấu hình (bảo vệ:
   * gọi nhầm lúc tắt = lỗi lập trình, không im lặng), khi timeout, hoặc khi !ok.
   *
   * KHÔNG BAO GIỜ ném vì lý do đọc body: 2xx nghĩa là LMS ĐÃ áp thay đổi, hạ cấp nó thành lỗi mạng sẽ
   * đếm sai `failed` và ghi `resultStatus:"Failure"` oan.
   */
  async syncUsers(users: LmsSyncUser[]): Promise<LmsSyncSummary> {
    if (!this.baseUrl || !this.token) {
      throw new Error("LMS auto-sync chưa cấu hình (LMS_BASE_URL/LMS_SYNC_TOKEN)");
    }
    if (users.length === 0) return zeroSummary();

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

    // try RIÊNG cho body-read, TÁCH khỏi try bọc fetch: `AbortSignal.timeout` ở trên vẫn còn hiệu lực
    // lúc đọc body, gộp chung sẽ biến AbortError-khi-đọc thành "network error" ⇒ lô bị đếm failed SAI.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // CẤM log err.message: V8 sinh `SyntaxError: ... "<body…>" is not valid JSON` — message CHỨA
      // TIỀN TỐ BODY, mà body có thể mang email. Chỉ log CHUỖI CỐ ĐỊNH.
      this.logger.warn("LMS sync: không đọc được summary (shape lạ) — coi như unknown");
      return zeroSummary(true);
    }

    return this.normalizeSummary(body, users.length);
  }

  /**
   * Dựng summary TỪ WHITELIST (CẤM spread body: `unknown` do LMS gửi kèm sẽ ghi đè cờ MediaOS tự tính —
   * cờ fail-safe không được để nguồn ngoài điều khiển).
   *
   * Luật `unknown = true` (fail-safe — không đọc được số thì KHÔNG được im lặng bỏ audit):
   *   · `summary` thiếu / không phải object
   *   · counter CÓ MẶT nhưng không thoả `Number.isInteger(v) && v >= 0`  ← bắt TẠI CHỖ, KHÔNG suy ra
   *     từ phép trừ tổng: `{deactivated:"1", skipped:1, alreadyDisabled:1}` với 2 user vẫn khớp tổng,
   *     suy-ra sẽ NUỐT MẤT một lần khoá tài khoản thật.
   *   · tổng 6 counter ≠ `users.length` (LMS đổi shape / phân hoạch vỡ)
   * Counter VẮNG MẶT → 0 (tương thích ngược: LMS bản cũ chưa gửi `alreadyDisabled`).
   */
  private normalizeSummary(body: unknown, expectedTotal: number): LmsSyncSummary {
    const raw = (body as { summary?: unknown } | null | undefined)?.summary;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return zeroSummary(true);
    }

    const source = raw as Record<string, unknown>;
    const out = zeroSummary();
    let total = 0;
    for (const key of SUMMARY_COUNTERS) {
      if (!(key in source)) continue; // vắng mặt → giữ 0
      const value = source[key];
      if (!Number.isInteger(value) || (value as number) < 0) return zeroSummary(true);
      out[key] = value as number;
      total += value as number;
    }

    if (total !== expectedTotal) return zeroSummary(true);
    return out;
  }
}
