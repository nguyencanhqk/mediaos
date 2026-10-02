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
 * Thẻ CỐ ĐỊNH của dòng log `error` khi envelope mật khẩu SMTP đã lưu không mở được (owner D3) — giám sát bắt
 * theo thẻ này. Giải mã hỏng = vi phạm toàn vẹn (đích bị đổi ngoài app, envelope hỏng hoặc mã hoá dưới ngữ cảnh
 * cũ, mất KEK), không bao giờ là chuyện thường. Dòng log chỉ mang company + config id — KHÔNG ngữ cảnh/đích/chi
 * tiết crypto.
 */
export const SMTP_ENVELOPE_UNUSABLE_TAG = "smtp-envelope-unusable";

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
 * Lỗi miền (B4, owner D4): đích PG THẬT SỰ lưu khác đích đã gắn vào ngữ cảnh mã hoá lúc encrypt (vd surrogate
 * lẻ ⇒ PG lưu U+FFFD) ⇒ envelope vừa ghi sẽ không bao giờ mở được, «nhập lại mật khẩu» cũng không chữa. Repo
 * ném trong tx (rollback, chưa audit); service map sang 400 không mã module (`VALIDATION-ERR-001`).
 */
export class MailDestinationNotPersistedError extends Error {
  constructor(message = "Đích SMTP PG lưu khác giá trị đã gắn vào ngữ cảnh mã hoá.") {
    super(message);
    this.name = "MailDestinationNotPersistedError";
  }
}
