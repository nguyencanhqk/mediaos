import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

/**
 * S4-NOTI-BE-2 (L2-engine) — mã lỗi + guard trust-boundary cho engine intake (SPEC-08 §19 slug).
 * Surface qua `HttpException` payload `.code` (AllExceptionsFilter đọc trực tiếp — mẫu my-notifications.errors.ts).
 *
 * DEVIATION vs SPEC-08 §19 (ghi rõ để S4-NOTI-BE-3 biết): route `POST /internal/v1/notifications/events` là
 * FIRE-AND-FORGET — event disabled / dedupe hit KHÔNG ném lỗi mà trả `200 + summary`. Vì vậy 2 mã single-shot
 * **422 NOTI-ERR-EVENT-DISABLED** và **409 NOTI-ERR-DEDUPE-CONFLICT** KHÔNG khai ở BE-2 (mã treo không có
 * deny-path). Chúng thuộc `POST /internal/v1/notifications/send` → S4-NOTI-BE-3 (docs/plans/S4-NOTI-BE-2.md §6.4).
 */
export const NOTI_ENGINE_ERR = {
  EVENT_NOT_FOUND: "NOTI-ERR-EVENT-NOT-FOUND",
  TARGET_UNAVAILABLE: "NOTI-ERR-TARGET-UNAVAILABLE",
  TEMPLATE_VARIABLE_INVALID: "NOTI-ERR-TEMPLATE-VARIABLE-INVALID",
  /** BE-4: field template PATCH chứa biến placeholder nhạy cảm bị cấm → 422 (ngữ cảnh KHÁC payload JSON). */
  TEMPLATE_FORBIDDEN_VARIABLE: "NOTI-ERR-TEMPLATE-FORBIDDEN-VARIABLE",
} as const;

/**
 * Placeholder `{var_name}` — cú pháp SINGLE-BRACE seed 0481 (`{task_code}`, `{actor_name}`…). NGUỒN CHUẨN
 * DUY NHẤT (renderer import lại) để scan biến cấm (BE-4) và interpolate (engine) KHÔNG lệch cú pháp. `g`
 * flag phục vụ matchAll (không dùng .test/.exec để tránh lệ thuộc lastIndex chia sẻ).
 */
export const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** eventCode client gửi KHÔNG tồn tại trong catalog (khác disabled — disabled là skip 200). → 404. */
export class EventNotFoundError extends NotFoundException {
  constructor(eventCode: string) {
    super({
      code: NOTI_ENGINE_ERR.EVENT_NOT_FOUND,
      message: `Không tìm thấy sự kiện thông báo: ${eventCode}`,
    });
  }
}

/** target_url render ra KHÔNG phải route nội bộ (SSRF / external / scheme) → 422 (loud, KHÔNG strip im lặng). */
export class TargetUnavailableError extends HttpException {
  constructor() {
    // KHÔNG echo URL vào message (tránh phản chiếu giá trị client-injected).
    super(
      {
        code: NOTI_ENGINE_ERR.TARGET_UNAVAILABLE,
        message: "target_url không phải route nội bộ hợp lệ",
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** payload chứa khóa nhạy cảm bị cấm / chuỗi quá dài → 400. */
export class TemplateVariableInvalidError extends BadRequestException {
  constructor(reason: string) {
    super({ code: NOTI_ENGINE_ERR.TEMPLATE_VARIABLE_INVALID, message: reason });
  }
}

/**
 * BE-4: field template (title/body/…) admin PATCH chứa biến placeholder `{password}`/`{token}`/… nhạy cảm
 * → 422 (API-07 §14.3 rule #6). RIÊNG BIỆT TemplateVariableInvalidError (400, ngữ cảnh payload JSON keys ở
 * engine POST /events): ngữ cảnh ở đây là NỘI DUNG template do admin soạn — status khác (422) theo done_when.
 * Message CHỈ echo TÊN biến (là field-name, không phải giá trị secret) — an toàn.
 */
export class TemplateForbiddenVariableError extends UnprocessableEntityException {
  constructor(variableName: string) {
    super({
      code: NOTI_ENGINE_ERR.TEMPLATE_FORBIDDEN_VARIABLE,
      message: `Template chứa biến nhạy cảm bị cấm: {${variableName}}`,
    });
  }
}

/**
 * Khóa nhạy cảm CẤM xuất hiện trong `payload` (biến template client soạn). Chặn secret/PII lọt vào body
 * notification hoặc audit before/after (BẤT BIẾN #3). So khớp lowercase để không lách bằng casing.
 */
const SENSITIVE_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "secret_ref",
  "salary",
  "bank_account",
  "identity_number",
  "private_file_url",
  "signed_url",
]);

/** Chặn payload phình to (comment quá dài) → DoS / body notification rác. */
const MAX_PAYLOAD_STRING_LEN = 2000;
const MAX_SCAN_DEPTH = 4;

/**
 * Quét đệ quy `payload` (biến template) — có khóa nhạy cảm hoặc chuỗi quá dài → throw 400 (loud). CỐ Ý
 * KHÔNG strip âm thầm: caller phải sửa payload, không để secret lọt qua rồi giả vờ ok.
 */
export function assertPayloadSafe(payload: unknown): void {
  scanPayload(payload, 0);
}

/**
 * BE-4: quét các field TEXT template đang được admin PATCH — nếu chứa BIẾN PLACEHOLDER nhạy cảm
 * (`{password}`/`{salary}`/…, khớp lowercase với SENSITIVE_PAYLOAD_KEYS) → throw 422 (loud, KHÔNG strip âm
 * thầm). CỐ Ý quét placeholder single-brace (PLACEHOLDER_RE) chứ KHÔNG substring thô — biến template lộ
 * secret khi RENDER chèn giá trị nhạy cảm vào body, còn từ mô tả (không phải `{var}`) thì vô hại. null/
 * undefined field (không PATCH) bỏ qua. Ngừng NGAY ở biến cấm ĐẦU TIÊN (fail-closed) — chưa chạm DB.
 */
export function assertTemplateVariablesSafe(
  fields: ReadonlyArray<string | null | undefined>,
): void {
  for (const text of fields) {
    if (!text) continue;
    for (const match of text.matchAll(PLACEHOLDER_RE)) {
      const varName = match[1];
      if (SENSITIVE_PAYLOAD_KEYS.has(varName.toLowerCase())) {
        throw new TemplateForbiddenVariableError(varName);
      }
    }
  }
}

function scanPayload(value: unknown, depth: number): void {
  if (depth > MAX_SCAN_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) scanPayload(item, depth + 1);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_PAYLOAD_KEYS.has(key.toLowerCase())) {
        throw new TemplateVariableInvalidError(`payload chứa khóa nhạy cảm bị cấm: ${key}`);
      }
      scanPayload(child, depth + 1);
    }
    return;
  }
  if (typeof value === "string" && value.length > MAX_PAYLOAD_STRING_LEN) {
    throw new TemplateVariableInvalidError(
      `giá trị payload vượt quá ${MAX_PAYLOAD_STRING_LEN} ký tự`,
    );
  }
}

/**
 * target_url PHẢI là route nội bộ: bắt đầu `/` nhưng KHÔNG `//` (protocol-relative), KHÔNG scheme
 * (`http:`/`https:`/`javascript:`/`data:` — dấu `:` không nằm trong char-class nên bị chặn), KHÔNG `\`.
 * Char-class chỉ cho path/query an toàn. Ngoài whitelist → 422 (loud).
 */
const INTERNAL_TARGET_URL_RE = /^\/(?!\/)[\w\-./?=&%#]*$/;

export function assertInternalTargetUrl(url: string): void {
  if (!INTERNAL_TARGET_URL_RE.test(url)) {
    throw new TargetUnavailableError();
  }
}
