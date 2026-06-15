import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import { ValkeyService } from "../permission/valkey.service";
import { payslipReauthKey } from "./payslip-reauth.service";

/** Request sau JwtAuthGuard: mang user + route :id; gắn cửa sổ re-auth đã resolve. */
type ReauthGuardRequest = Request & {
  user?: { id?: string };
  params: Record<string, string>;
  reauthContext?: { reauthValidUntil?: Date | null };
};

/**
 * PayslipReauthGuard (G12-4) — mirror media ReauthGuard, nhưng đọc cửa sổ step-up xem payslip
 * (key `reauth:payslip:{userId}:{payslipId}` do PayslipReauthService.reauth ghi). KHÔNG phải cổng
 * authz — LUÔN trả true; enforcement fail-closed ở PayslipService.getOne (permission.can requiresReauth).
 * Cửa sổ thiếu/hết hạn ⇒ reauthContext không set ⇒ getOne deny 'deny-reauth-required'. Valkey best-effort
 * (cache fail-open): outage ⇒ không cửa sổ ⇒ getOne deny, KHÔNG bao giờ false-allow.
 *
 * PHẢI chạy TRƯỚC PermissionGuard: khai method-level @UseGuards(PayslipReauthGuard, PermissionGuard)
 * (global JwtAuthGuard + CompanyGuard chạy trước, set req.user).
 */
@Injectable()
export class PayslipReauthGuard implements CanActivate {
  private readonly logger = new Logger(PayslipReauthGuard.name);

  constructor(private readonly valkey: ValkeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ReauthGuardRequest>();
    const userId = req.user?.id;
    const payslipId = req.params?.id;
    if (!userId || !payslipId) return true; // Không định danh/target → không cửa sổ; PermissionGuard/service quyết.

    const raw = await this.valkey.get(payslipReauthKey(userId, payslipId));
    if (raw == null) return true; // Không cửa sổ (chưa step-up / hết hạn / bị evict) → getOne sẽ deny.

    const epoch = Number(raw);
    if (!Number.isFinite(epoch)) {
      this.logger.warn("Payslip re-auth window value is not a finite epoch — ignoring", {
        userId,
        payslipId,
      });
      return true;
    }
    if (epoch > Date.now()) {
      req.reauthContext = { reauthValidUntil: new Date(epoch) };
    }
    return true;
  }
}
