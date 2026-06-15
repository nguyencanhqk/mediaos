import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { users } from "../db/schema";
import { ValkeyService } from "../permission/valkey.service";
import { LoginRateLimiter } from "../auth/login-rate-limiter";
import { PasswordService } from "../auth/password.service";

type RequestUser = { id: string; companyId: string };

/** Cửa sổ step-up cho xem payslip (~5 phút), keyed per-(userId, payslipId). Plan §re-auth. */
const REAUTH_TTL_SEC = 300;

/**
 * Valkey key cửa sổ re-auth xem payslip (scope hẹp per-payslip). reauth(payslip A) KHÔNG cho xem payslip B.
 * Export để PayslipReauthGuard đọc CÙNG key service ghi (1 nguồn, không lệch format). Namespace 'reauth:payslip:'
 * tách khỏi reveal-secret media ('reauth:{u}:{acc}') — không đụng nhau.
 */
export function payslipReauthKey(userId: string, payslipId: string): string {
  return `reauth:payslip:${userId}:${payslipId}`;
}

/**
 * PayslipReauthService (G12-4) — step-up trước khi xem chi tiết payslip (lương nhạy cảm, BẤT BIẾN #3).
 * Mirror PlatformAccountsService.reauth: verify lại mật khẩu user → mint cửa sổ Valkey để
 * PayslipReauthGuard đọc ở request GET /payslips/:id kế tiếp. Tách khỏi PayslipService để KHÔNG đổi
 * chữ ký constructor PayslipService (giữ nguyên 5 call-site test).
 *
 * Fail-closed: verify sai → 401 (+ rate-limit per (user,payslip)); cửa sổ KHÔNG persist được → 503
 * (KHÔNG báo thành công giả — reveal sau sẽ deny mãi). KHÔNG log mật khẩu/hash.
 */
@Injectable()
export class PayslipReauthService {
  private readonly logger = new Logger(PayslipReauthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly valkey: ValkeyService,
    private readonly password: PasswordService,
    private readonly rateLimiter: LoginRateLimiter,
  ) {}

  async reauth(
    user: RequestUser,
    payslipId: string,
    factor: { password: string },
  ): Promise<{ reauthValidUntil: Date }> {
    if (!factor.password) {
      throw new UnauthorizedException("Re-authentication requires a password.");
    }
    // Throttle step-up per (userId, payslipId) — cổng xem lương cưỡi trên password check này, không
    // chặn = đường brute-force vào dữ liệu lương. Tái dùng login limiter, key riêng (không đụng login/media).
    const rlKey = `reauth-payslip|${user.id}|${payslipId}`;
    if (await this.rateLimiter.isLocked(rlKey)) {
      throw new HttpException(
        "Too many re-authentication attempts. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const verified = await this.db.withTenant(user.companyId, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (!row) return false;
      return this.password.verify(row.passwordHash, factor.password);
    });
    if (!verified) {
      await this.rateLimiter.recordFailure(rlKey);
      throw new UnauthorizedException("Re-authentication failed.");
    }
    await this.rateLimiter.reset(rlKey);

    const reauthValidUntil = new Date(Date.now() + REAUTH_TTL_SEC * 1000);
    // Persist-fail → 503 (KHÔNG nuốt): cửa sổ không persist nhưng báo OK ⇒ GET /payslips/:id deny mãi.
    // set() trả true khi cache tắt (test/no-URL) nên chỉ fire khi outage thật.
    const persisted = await this.valkey.set(
      payslipReauthKey(user.id, payslipId),
      String(reauthValidUntil.getTime()),
      REAUTH_TTL_SEC,
    );
    if (!persisted) {
      this.logger.warn("Payslip re-auth window failed to persist to Valkey — step-up not durable", {
        userId: user.id,
        payslipId,
      });
      throw new ServiceUnavailableException(
        "Re-authentication temporarily unavailable. Please retry.",
      );
    }
    return { reauthValidUntil };
  }
}
