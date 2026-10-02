/**
 * Đích kết nối SMTP — S19-SEC-MAILCREDEXFIL-1.
 *
 * Mật khẩu SMTP lưu dạng write-only (envelope) và GẮN với bộ bốn `(host, port, username, secure)` của
 * chính hàng chứa nó. Hai bất biến dựa trên module này:
 *   - I1: mật khẩu ĐÃ LƯU chỉ được gửi tới đích của chính hàng đó (route "Kiểm tra kết nối" vắng mật khẩu);
 *   - I2: cột đích chỉ được ghi cùng envelope MỚI — nhánh "giữ mật khẩu cũ" của PUT không ghi được cột đích
 *     (repo dùng vị từ đích; DB thu hồi quyền UPDATE cột đích của `mediaos_app` — mig 0591).
 *
 * So sánh CHÍNH XÁC (không chuẩn hoá hoa/thường/khoảng trắng): lệch thì bắt nhập lại mật khẩu — fail-closed.
 */

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
 * Lỗi miền: muốn dùng mật khẩu đã lưu cho một đích khác hàng đã lưu. Repo ném (không ném HttpException);
 * service map sang 400 `FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED`.
 */
export class MailPasswordRequiredError extends Error {
  constructor(message = "Đích SMTP khác hàng đã lưu — cần mật khẩu mới.") {
    super(message);
    this.name = "MailPasswordRequiredError";
  }
}
