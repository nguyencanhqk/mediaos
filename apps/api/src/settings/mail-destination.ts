/**
 * Đích kết nối SMTP — S19-SEC-MAILCREDEXFIL-1 + S19-SEC-MAILAADBIND-1.
 *
 * Mật khẩu SMTP lưu dạng write-only (envelope) và GẮN với bộ bốn `(host, port, username, secure)` của
 * chính hàng chứa nó. Các bất biến dựa trên module này:
 *   - I1: mật khẩu ĐÃ LƯU chỉ được gửi tới đích của chính hàng đó (route "Kiểm tra kết nối" vắng mật khẩu);
 *   - I2: cột đích chỉ được ghi cùng envelope MỚI — nhánh "giữ mật khẩu cũ" của PUT không ghi được cột đích
 *     (repo: SET không có cột đích + vị từ đích; DB: `mediaos_app` hết quyền UPDATE cột đích — mig 0591);
 *   - B1 (lớp MẬT MÃ, độc lập với lớp DB): `smtpSecretContext` gắn bộ năm `(id, host, port, username, secure)`
 *     vào ngữ cảnh mã hoá (AAD) của envelope ⇒ đổi id hoặc đích mà KHÔNG mã hoá lại — superuser/DBA, migration
 *     lỗi, một đường DELETE+INSERT chép envelope (0591 không chặn INSERT/DELETE) — thì GCM từ chối ⇒ không có
 *     mật khẩu nào để gửi đi. KHÔNG chống PHÁT LẠI: chép lại NGUYÊN một ảnh chụp cũ (id + đích + envelope) vẫn
 *     mở được — ngữ cảnh không có bộ đếm/độ tươi (rủi ro tồn dư chấp nhận, plan §7).
 *
 * So sánh CHÍNH XÁC (không chuẩn hoá hoa/thường/khoảng trắng/Unicode): lệch thì bắt nhập lại mật khẩu —
 * fail-closed.
 */

import { SMTP_SECRET_PURPOSE } from "@mediaos/contracts";
import type { EncryptCtx } from "../crypto/secret-encryption.types";

export interface MailDestination {
  host: string;
  port: number;
  username: string;
  secure: boolean;
}

const DESTINATION_FIELDS = ["host", "port", "username", "secure"] as const;

/** Bóc bộ bốn đích khỏi một hàng/DTO (bỏ mọi trường khác — nhất là cột envelope). */
export function destinationOf(source: MailDestination): MailDestination {
  return {
    host: source.host,
    port: source.port,
    username: source.username,
    secure: source.secure,
  };
}

/** Tên các trường đích khác nhau — CHỈ tên, không giá trị (dùng cho log). */
export function changedDestinationFields(a: MailDestination, b: MailDestination): string[] {
  return DESTINATION_FIELDS.filter((field) => a[field] !== b[field]);
}

export function sameDestination(a: MailDestination, b: MailDestination): boolean {
  return changedDestinationFields(a, b).length === 0;
}

/**
 * Ngữ cảnh mã hoá envelope mật khẩu SMTP — NƠI DUY NHẤT dựng nó (S19-SEC-MAILAADBIND-1, B2): mọi encrypt
 * (PUT có mật khẩu) và MỌI decrypt hàng đã lưu (route test, lời mời) đi qua đây.
 *
 * `recordId` của ngữ cảnh = `JSON.stringify([id, host, port, username, secure])`:
 *   - JSON, KHÔNG ký tự phân cách tự chọn: host/username không validate nên ký tự phân cách nào cũng va chạm
 *     được; JSON thoát nháy/gạch chéo/ký tự điều khiển ⇒ không có byte NUL thô (`buildAad` phân cách bằng NUL);
 *   - kiểu có nghĩa (`25` ≠ `"25"`, `true` ≠ `"true"`) ⇒ nguồn phải là giá trị PG THẬT SỰ lưu (repo ép — B4);
 *   - id hàng đứng đầu: chép envelope sang hàng khác cùng đích vẫn hỏng; luôn mở đầu bằng `[` ⇒ không trùng
 *     recordId UUID trần của purpose khác (TOTP/reset);
 *   - CHỈ 4 trường đích (bóc bằng `destinationOf`): `scope`/`from_*`/mốc thời gian không phải ĐÍCH của mật
 *     khẩu — PUT «chỉ đổi người gửi» giữ envelope.
 * Envelope mã hoá dưới ngữ cảnh CŨ (`recordId` = id trần, trước WO) KHÔNG mở được — fail-closed, admin nhập lại
 * mật khẩu (owner D1). Không đổi `buildAad`/`SecretEncryptionService` (dùng chung TOTP/reset/platform_account).
 */
export function smtpSecretContext(
  companyId: string,
  recordId: string,
  destination: MailDestination,
): EncryptCtx {
  const d = destinationOf(destination);
  return {
    companyId,
    recordId: JSON.stringify([recordId, d.host, d.port, d.username, d.secure]),
    purpose: SMTP_SECRET_PURPOSE,
  };
}

/**
 * Thẻ CỐ ĐỊNH đứng ĐẦU dòng log `error` khi envelope mật khẩu SMTP đã lưu không mở được (owner D3). Giải mã
 * hỏng không bao giờ là chuyện thường: envelope ghi dưới ngữ cảnh cũ (trước WO), đích bị đổi NGOÀI ứng dụng
 * (đúng ca B1 chặn), envelope hỏng, sự cố khoá mã hoá. Dòng chỉ mang company + config id — KHÔNG ngữ cảnh/đích/
 * chi tiết crypto.
 *
 * Quy tắc giám sát (chưa dựng — WO S19-SEC-MAILTAMPERDETECT-1): `level=error` VÀ `context` ∈
 * {`MailConfigService`, `InviteMailService`} VÀ `message` BẮT ĐẦU bằng thẻ. KHÔNG khớp chuỗi con: host do tenant
 * chọn xuất hiện GIỮA các dòng log khác (lỗi gửi mời, từ chối đích) nên chèn được nguyên chữ của thẻ vào đó.
 */
export const SMTP_ENVELOPE_UNUSABLE_TAG = "smtp-envelope-unusable";

/**
 * Dòng log của thẻ trên — TRUNG LẬP về nguyên nhân (sửa đổi owner 02/10/2026, FULL gate silent-failure HIGH):
 * KHÔNG bảo «nhập lại mật khẩu» — nếu đích đã bị tráo ngoài ứng dụng, nhập lại mật khẩu vào form (đã nạp sẵn
 * đích bị tráo) là hoàn tất chính vụ rò B1 vừa chặn ⇒ bắt xác minh đích TRƯỚC. `action` là chữ cố định của
 * server; chỉ uuid (company/config) — không giá trị do tenant chọn ⇒ thẻ luôn đứng đầu dòng.
 */
export function smtpEnvelopeUnusableLogLine(
  action: string,
  companyId: string,
  configId: string,
): string {
  return `${SMTP_ENVELOPE_UNUSABLE_TAG}: không mở được envelope mật khẩu SMTP đã lưu dưới đích/ngữ cảnh hiện tại (${action}) — nguyên nhân có thể: envelope ghi dưới ngữ cảnh cũ, đích bị đổi ngoài ứng dụng, sự cố khoá mã hoá (KEK); xác minh đích (máy chủ, cổng, tên đăng nhập, TLS) TRƯỚC khi nhập lại mật khẩu (company=${companyId} config=${configId})`;
}

/**
 * Lỗi miền: muốn dùng mật khẩu đã lưu cho một đích khác hàng đã lưu. Repo ném (không ném HttpException);
 * service map sang 400 `FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED`.
 */
export class MailPasswordRequiredError extends Error {
  constructor(message = "Đích SMTP khác hàng đã lưu — cần mật khẩu mới.") {
    super(message);
    this.name = "MailPasswordRequiredError";
  }
}

/**
 * Lỗi miền (B4, owner D4): host/username PG THẬT SỰ lưu khác giá trị đã gắn vào ngữ cảnh mã hoá lúc encrypt (vd
 * surrogate lẻ ⇒ PG lưu U+FFFD) ⇒ envelope vừa ghi sẽ không bao giờ mở được, «nhập lại mật khẩu» cũng không chữa
 * (cùng đầu vào). Repo ném trong tx (rollback, chưa audit); service log TÊN trường rồi map sang 400 không mã module
 * (`VALIDATION-ERR-001`). `changedFields` chỉ mang TÊN trường — giá trị do client chọn không vào message/log.
 */
export class MailDestinationNotPersistedError extends Error {
  constructor(readonly changedFields: readonly string[]) {
    super(
      `Đích SMTP PG lưu khác giá trị đã gắn vào ngữ cảnh mã hoá (trường: ${changedFields.join(",")}).`,
    );
    this.name = "MailDestinationNotPersistedError";
  }
}

/** Hàng PG trả về (`RETURNING`) — đủ trường để so với bộ đã gắn vào ngữ cảnh mã hoá. */
export type PersistedMailDestination = MailDestination & { id: string; companyId: string };

/** Bộ caller đã gắn vào ngữ cảnh lúc encrypt — `smtpSecretContext(companyId, recordId, destination)`. */
export interface BoundSmtpContext {
  companyId: string;
  recordId: string;
}

/** Trường đích mà đầu vào hợp lệ KHÔNG làm lệch được: số nguyên / boolean đã qua Zod, cột integer / boolean. */
const SYSTEM_ONLY_DRIFT: ReadonlySet<string> = new Set(["port", "secure"]);

/**
 * B4 (owner D4 + FULL gate lượt 1): bộ PG THẬT SỰ lưu (`RETURNING`) phải bằng bộ đã gắn vào ngữ cảnh mã hoá —
 * companyId + id + 4 trường đích (`smtpSecretContext`). Lệch ⇒ envelope vừa ghi không bao giờ mở được ⇒ repo gọi
 * TRONG tx ở CẢ HAI nhánh INSERT ⇒ ném = rollback (audit ghi sau). So trong JS trên hàng sẵn có, không truy vấn.
 * Phân loại theo AI gây ra được:
 *   - companyId / id lệch ⇒ LỖI LẬP TRÌNH (companyId của JWT/khoá API lấy từ DB; id = `randomUUID()` chữ thường;
 *     PG trả uuid chữ thường bất kể đầu vào) ⇒ 500 qua filter (log + stack), KHÔNG gói thành 400;
 *   - port / secure lệch ⇒ LỖI HỆ THỐNG (trigger chuẩn hoá, đổi kiểu cột — đầu vào không gây ra được) ⇒ 500;
 *   - CHỈ host / username lệch (chuỗi tự do — surrogate lẻ ⇒ U+FFFD) ⇒ `MailDestinationNotPersistedError` ⇒ 400.
 * Message chỉ mang TÊN trường — không id, không giá trị.
 */
export function assertPersistedAsBound(
  row: PersistedMailDestination,
  bound: BoundSmtpContext,
  destination: MailDestination,
): void {
  if (row.companyId !== bound.companyId) {
    throw new Error(
      "Mail config: companyId gắn vào ngữ cảnh mã hoá không khớp company_id PG lưu (lỗi lập trình — companyId phải là uuid chữ thường).",
    );
  }
  if (row.id !== bound.recordId) {
    throw new Error(
      "Mail config: recordId gắn vào ngữ cảnh mã hoá không khớp id PG lưu (lỗi lập trình — recordId phải là uuid chữ thường app-gen).",
    );
  }
  const changed = changedDestinationFields(destinationOf(row), destination);
  if (changed.length === 0) return;
  if (changed.some((field) => SYSTEM_ONLY_DRIFT.has(field))) {
    throw new Error(
      `Mail config: PG lưu ${changed.join(",")} khác giá trị đã gắn vào ngữ cảnh mã hoá (lỗi hệ thống — đầu vào hợp lệ không gây ra được).`,
    );
  }
  throw new MailDestinationNotPersistedError(changed);
}
