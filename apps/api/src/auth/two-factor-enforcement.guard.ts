import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  forwardRef,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { loadEnv } from "../config/env.schema";
import { IS_PUBLIC } from "../permission/public.decorator";
import type { AuthRequest } from "../permission/guards/jwt-auth.guard";
import { DatabaseService } from "../db/db.service";
import { SecurityPolicyService } from "../security-policy/security-policy.service";
import { ALLOW_WITHOUT_TWO_FACTOR } from "./two-factor-enforcement.decorator";
import { TwoFactorService } from "./two-factor.service";

/** TTL cache cho quyết định 2FA-enforced theo công ty (chống +1 query mỗi request — plan §6). */
const COMPANY_2FA_CACHE_TTL_MS = 30_000;

/** Mã máy-đọc-được để FE redirect tới luồng thiết lập 2FA (KHÔNG hard-code message ở client). */
export const TWO_FACTOR_SETUP_REQUIRED = "TWO_FACTOR_SETUP_REQUIRED";

/**
 * S10-AUTH-2FAGUARD-FAILMODE-1 (KI-083) — mã cho lỗi HẠ TẦNG khi guard không xác minh được trạng thái 2FA.
 * Fail-closed CÓ PHÂN LOẠI (owner chốt hướng (b), `docs/plans/S10-AUTH-2FAGUARD-FAILMODE-1.md`): vẫn TỪ CHỐI
 * như trước, nhưng trả 503 mang mã riêng thay vì 500 `SYSTEM-ERR-001` vô danh.
 *
 * VÌ SAO KHÔNG fail-to-floor: hạ sàn không cứu được request nào — 468/507 route có `@RequirePermission` sẽ
 * rơi tiếp vào PermissionGuard fail-closed và trả **403**, một mã SAI NGỮ NGHĨA khiến sự cố hạ tầng tàng hình
 * với cảnh báo 5xx; còn 16 route không gate quyền (census runtime, xem plan §2.1) thì cũng đọc tenant DB nên
 * DB hỏng là chúng hỏng. Đổi lại ta mất ép-2FA trong lúc đó. Không đáng.
 */
export const TWO_FACTOR_UNAVAILABLE = "AUTH-ERR-2FA-UNAVAILABLE";

/**
 * TwoFactorEnforcementGuard — ÉP server-side (G16-1b): user có role `requires_two_factor` nhưng CHƯA enroll
 * 2FA bị DENY mọi tài nguyên được bảo vệ, KHÔNG chỉ là cờ tư vấn `mustSetupTwoFactor` (me()). Chạy SAU
 * JwtAuthGuard + CompanyGuard (cần `req.user`). Route @Public() hoặc @AllowWithoutTwoFactor() được bỏ qua
 * (nếu không user sẽ deadlock — không có đường enroll). Ném 403 + `code:TWO_FACTOR_SETUP_REQUIRED` để FE redirect.
 *
 * Quyết định bằng DB (requiresTwoFactor && !isEnabled) chứ KHÔNG dựa claim trong JWT — claim có thể cũ
 * (role đổi sau khi cấp token); enforcement phải phản ánh trạng thái role HIỆN TẠI.
 */
@Injectable()
export class TwoFactorEnforcementGuard implements CanActivate {
  private readonly logger = new Logger(TwoFactorEnforcementGuard.name);
  private readonly globalEnabled = loadEnv().TWO_FACTOR_ENFORCEMENT_ENABLED === "true";
  /** Cache ngắn per-company: company explicitly enforces 2FA (policy.two_factor_enforced=true). */
  private readonly company2faCache = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly twoFactor: TwoFactorService,
    private readonly dbsvc: DatabaseService,
    @Inject(forwardRef(() => SecurityPolicyService))
    private readonly securityPolicy: SecurityPolicyService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;
    const allowWithout = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_TWO_FACTOR, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (allowWithout) return true;

    // WS: APP_GUARD chạy cho gateway handler — không HTTP request. 2FA enforcement chỉ áp REST tài nguyên.
    if (ctx.getType() !== "http") return true;

    const req = ctx.switchToHttp().getRequest<Partial<AuthRequest>>();
    const user = req.user as (AuthRequest["user"] & { viaApiKey?: boolean }) | undefined;
    if (!user) return true; // JwtAuthGuard đã ném nếu thiếu — không double-throw ở đây.

    // AC-5: PAT request (viaApiKey) bỏ qua enrollment 2FA. PAT KHÔNG phải phiên người tương tác (không có
    // bước nhập TOTP); bảo mật PAT nằm ở scope∩grant + revoke + TTL. Cấp PAT lại đòi manage:api-key (sensitive)
    // — đường cấp key đã qua phiên người (có 2FA). Đây KHÔNG phải bypass: scope∩grant vẫn ép ở PermissionGuard.
    if (user.viaApiKey) return true;

    // CS-9 fail-STRICTER (BẤT BIẾN #1): effective2FA = globalEnv || policy.two_factor_enforced. Tenant CHỈ
    // tăng chuẩn (KHÔNG hạ global). Quyết định "user này PHẢI có 2FA":
    //   - global ON  → giữ ngữ nghĩa cũ: ép theo ROLE requires_two_factor (KHÔNG +query khi user không có
    //     role + công ty không ép riêng — đọc company-policy chỉ khi cần leo thang).
    //   - global OFF → CHỈ ép nếu CÔNG TY tự bật (policy.two_factor_enforced=true) — áp cho MỌI user công ty.
    //   - company ON (bất kể global) → áp cho MỌI user (tenant nâng chuẩn lên toàn công ty).
    const companyEnforced = await this.isCompany2faEnforced(user.companyId);
    const roleRequired = this.globalEnabled
      ? await this.guardedRead("role requires_two_factor", () =>
          this.twoFactor.requiresTwoFactor(user.id, user.companyId),
        )
      : false;
    const mustHaveTwoFactor = companyEnforced || roleRequired;
    if (!mustHaveTwoFactor) return true;

    const enabled = await this.guardedRead("trạng thái enroll 2FA", () =>
      this.twoFactor.isEnabled(user.id, user.companyId),
    );
    if (enabled) return true;

    // Bị ép 2FA + chưa enroll → DENY. Payload mang `code` để FE redirect (không render message hard-code).
    throw new ForbiddenException({
      code: TWO_FACTOR_SETUP_REQUIRED,
      message: "Bạn phải thiết lập xác thực 2 bước (2FA) trước khi tiếp tục.",
    });
  }

  /**
   * CS-9: công ty có TỰ bật ép 2FA không (policy.two_factor_enforced=true). Cache ngắn (TTL) tránh +1
   * query mỗi request. getEffectiveTwoFactorRequired đã gói công thức fail-stricter (global || policy) +
   * kill-switch CS-9 + fail-to-floor khi lỗi đọc. Ta truyền globalEnabled=false để lấy RIÊNG nhánh
   * company-policy (global đã xử lý ở roleRequired) — kết quả = (policy.two_factor_enforced ?? false).
   */
  private async isCompany2faEnforced(companyId: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.company2faCache.get(companyId);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = await this.guardedRead("chính sách 2FA của công ty", () =>
      this.dbsvc.withTenant(companyId, (tx) =>
        this.securityPolicy.getEffectiveTwoFactorRequired(tx, companyId, false),
      ),
    );
    // Chỉ đóng dấu cache trên đường THÀNH CÔNG: đường lỗi đã ném ở trên nên không bao giờ tới đây. Nếu
    // sau này ai đó đổi sang fail-to-floor thì PHẢI giữ bất biến "không cache giá trị sinh từ lỗi" —
    // cache 30s một quyết định-từ-lỗi = kéo dài hạ-chuẩn thêm 30s (ca (7) của int-spec ghim điều này).
    this.company2faCache.set(companyId, { value, expiresAt: now + COMPANY_2FA_CACHE_TTL_MS });
    return value;
  }

  /**
   * Bọc MỘT lời đọc DB của guard. Lỗi HẠ TẦNG ở VỎ transaction (lấy connection · BEGIN · set_config ·
   * COMMIT) là phần KHÔNG try/catch nào bên trong callback đỡ được — kể cả
   * `SecurityPolicyService.getEffectiveTwoFactorRequired` (try/catch của nó nằm BÊN TRONG callback).
   *
   * `HttpException` đi qua NGUYÊN TRẠNG: đó là đường NGHIỆP VỤ (vd 403 từ tầng dưới), không phải lỗi hạ
   * tầng — nuốt nó thành 503 sẽ che mất quyết định bảo mật thật. Ca GHIM là (9) của int-spec, KHÔNG phải
   * (8): 403 nghiệp vụ được ném từ THÂN canActivate (ngoài helper này) nên (8) không chạm dòng dưới —
   * đo đột biến vòng đầu cho thấy (8) xanh-RỖNG với đúng đột biến đó.
   *
   * Message ra client KHÔNG mang chi tiết nội bộ (security.md); lý do thật chỉ vào log server-side.
   */
  private async guardedRead<T>(label: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Không đọc được ${label} (lỗi hạ tầng) — từ chối request với ${TWO_FACTOR_UNAVAILABLE}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new ServiceUnavailableException({
        code: TWO_FACTOR_UNAVAILABLE,
        message: "Không xác minh được trạng thái xác thực 2 bước — vui lòng thử lại.",
      });
    }
  }
}
