import { Injectable, Logger } from "@nestjs/common";

/**
 * Kết quả 1 lần đọc tiến độ. `found:false` = LMS trả **404** = email này CHƯA TỪNG có tài khoản học
 * (`docs/plans/S5-LMS-APP-3.md` §4.6 — tài khoản ĐÃ KHOÁ vẫn trả 200 kèm `user.active=false`). Đây KHÔNG
 * phải lỗi hạ tầng ⇒ tách khỏi nhánh throw để service map thành envelope `no_account` (fail-soft).
 *
 * `body` là `unknown` CỐ Ý: client KHÔNG tin shape của LMS. Validate = việc của `MeTrainingService` qua
 * `meTrainingProgressSchema` (packages/contracts) — biên giới "dữ liệu ngoài" chỉ được vượt qua bằng Zod.
 */
export type LmsProgressFetchResult = { found: true; body: unknown } | { found: false };

/** Timeout client-side: request của người dùng KHÔNG được treo theo LMS (WO S5-LMS-BE-3 done_when). */
const REQUEST_TIMEOUT_MS = 5_000;
/** Trần payload: LMS cắt 100 khoá (~vài chục KB). 512KB = biên rộng rãi, chỉ chặn body bất thường. */
const MAX_PROGRESS_BODY_BYTES = 512 * 1024;

/**
 * S5-LMS-BE-3 — client server-to-server tới LMS `GET /api/mediaos/progress?email=` (chỉ ĐỌC).
 *
 * BẤT BIẾN #3 (secret): `LMS_PROGRESS_TOKEN` đọc từ env, KHÔNG hardcode, KHÔNG log ở BẤT KỲ nhánh nào.
 * Token này là **token ĐỌC riêng** (= `MEDIAOS_PROGRESS_TOKEN` phía LMS) — TUYỆT ĐỐI KHÔNG fallback sang
 * `LMS_SYNC_TOKEN` (token quyền-GHI: tạo/khoá tài khoản LMS). Quyết định HIGH-2 của security review
 * S5-LMS-APP-3 §2: đường ĐỌC mở ra internet không được mang quyền GHI.
 *
 * KHÔNG log email (PII) và KHÔNG log/đọc response body ở nhánh lỗi — kể cả `err.message` của SyntaxError
 * (V8 nhét tiền tố body vào message, mà body chứa email/tên người học). Chỉ log CHUỖI CỐ ĐỊNH + status.
 *
 * Không tự kiểm `isEnabled()` bên trong `fetchProgress`: caller PHẢI kiểm trước (fail-closed) — gọi khi
 * chưa cấu hình là LỖI LẬP TRÌNH nên ném, không im lặng trả rỗng.
 */
@Injectable()
export class LmsProgressClient {
  private readonly logger = new Logger(LmsProgressClient.name);
  private readonly baseUrl = process.env.LMS_BASE_URL?.replace(/\/+$/, "") ?? null;
  private readonly token = process.env.LMS_PROGRESS_TOKEN ?? null;

  /** Bật khi có ĐỦ base URL + token ĐỌC. Thiếu ⇒ endpoint /me/training trả 503 (tắt mềm). */
  isEnabled(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  async fetchProgress(email: string): Promise<LmsProgressFetchResult> {
    if (!this.baseUrl || !this.token) {
      throw new Error("LMS progress chưa cấu hình (LMS_BASE_URL/LMS_PROGRESS_TOKEN)");
    }

    // LMS match email lowercase-exact (đã kiểm PROD: 36/36 user lowercase) — chuẩn hoá giống
    // lms-sso.service.ts để tài khoản hợp lệ không bị 404 oan vì hoa/thường.
    const normalized = email.trim().toLowerCase();
    const url = `${this.baseUrl}/api/mediaos/progress?email=${encodeURIComponent(normalized)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeout/network. KHÔNG log email/URL (URL chứa email trong query!) — chỉ tên lỗi.
      this.logger.warn(`LMS progress request failed (network/timeout): ${errName(err)}`);
      throw new Error("LMS progress network error");
    }

    // 404 CỦA HỢP ĐỒNG (APP-3 §4.6: JSON `{message:'Not found'}`) = "chưa từng có tài khoản LMS" — KHÔNG
    // đọc body, KHÔNG log (tránh biến log thành oracle liệt kê email nào có tài khoản học).
    //
    // NHƯNG 404 KHÔNG-JSON = HỎNG CẤU HÌNH, không phải trạng thái nghiệp vụ: `LMS_BASE_URL` sai, route
    // `/api/mediaos/progress` chưa deploy (APP-3 §9.3 cố ý chưa build), hoặc proxy/tunnel chen giữa — cả ba
    // đều trả 404 **HTML** của Next.js. Nuốt nó thành `found:false` sẽ báo "chưa có tài khoản đào tạo" cho
    // TOÀN BỘ nhân viên, vĩnh viễn, không log/metric ⇒ hỏng hạ tầng đội lốt dữ liệu hợp lệ (finding MEDIUM
    // security-review 2026-07-23). Fail-loud: ném → service map 502, người vận hành thấy ngay.
    if (res.status === 404) {
      if (isJson(res)) return { found: false };
      this.logger.warn(
        "LMS progress: 404 không phải JSON (sai LMS_BASE_URL hoặc route chưa deploy?)",
      );
      throw new Error("LMS progress 404 invalid content-type");
    }

    if (!res.ok) {
      // KHÔNG đọc/log body (có thể vọng lại email). Chỉ status.
      this.logger.warn(`LMS progress trả HTTP ${res.status}`);
      throw new Error(`LMS progress HTTP ${res.status}`);
    }

    // Chặn 2 ca rẻ tiền TRƯỚC khi parse: sai content-type (proxy/tunnel trả HTML) và body khổng lồ (áp lực
    // bộ nhớ tiến trình API). Residual đã biết: response chunked không có content-length thì ngưỡng không
    // áp được — chấp nhận (LMS là service của chính ta), Zod ở service vẫn là hàng rào cuối.
    if (!isJson(res)) {
      this.logger.warn("LMS progress: response không phải JSON");
      throw new Error("LMS progress invalid content-type");
    }
    const declaredBytes = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_PROGRESS_BODY_BYTES) {
      this.logger.warn("LMS progress: response vượt ngưỡng kích thước");
      throw new Error("LMS progress body too large");
    }

    try {
      return { found: true, body: await res.json() };
    } catch {
      // CẤM log err.message: SyntaxError của V8 chứa TIỀN TỐ BODY (có thể mang email/tên). Chuỗi cố định.
      this.logger.warn("LMS progress: không parse được JSON");
      throw new Error("LMS progress invalid JSON");
    }
  }
}

/**
 * Response có đúng là JSON không. Dùng CHUNG cho nhánh 404-hợp-đồng và nhánh 2xx: chỉ khi LMS **thật sự**
 * trả JSON thì 404 mới được hiểu là câu trả lời nghiệp vụ "chưa có tài khoản".
 */
function isJson(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("application/json");
}

/** Tên lỗi (TimeoutError/AbortError/TypeError…) — an toàn để log, KHÔNG kèm message/URL/PII. */
function errName(err: unknown): string {
  return err instanceof Error ? err.name : "UnknownError";
}
