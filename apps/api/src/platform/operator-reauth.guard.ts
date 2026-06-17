import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import { ValkeyService } from "../permission/valkey.service";
import { operatorReauthKey } from "./operator-reauth.service";

/** Request after JwtAuthGuard: carries the operator + route :id (target tenant); we attach the window. */
type OperatorReauthRequest = Request & {
  user?: { id?: string };
  params: Record<string, string>;
  reauthContext?: { reauthValidUntil?: Date | null };
};

/**
 * OperatorReauthGuard (🔒 AC-0b) — populates `req.reauthContext` for an operator step-up route.
 *
 * Reads the (operatorId, targetTenantId) window from Valkey (key written by OperatorReauthService.stepUp,
 * target = route :id) and, when still valid, sets `req.reauthContext.reauthValidUntil` so the downstream
 * PermissionGuard / service can satisfy `requiresReauth`. SCOPED to the route :id — a window for tenant
 * A does NOT leak to tenant B.
 *
 * NOT an authorization gate — ALWAYS returns true. Enforcement is fail-closed at the consuming route.
 * A missing/expired window leaves reauthContext unset → the write denies with 'deny-reauth-required'.
 * Valkey is best-effort (fail-open cache): an outage means no window → write denied, never a false-allow.
 * MUST run BEFORE PermissionGuard (applied method-level).
 */
@Injectable()
export class OperatorReauthGuard implements CanActivate {
  private readonly logger = new Logger(OperatorReauthGuard.name);

  constructor(private readonly valkey: ValkeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<OperatorReauthRequest>();
    const operatorId = req.user?.id;
    const targetTenantId = req.params?.id;
    if (!operatorId || !targetTenantId) return true; // No identity/target → PermissionGuard decides.

    const raw = await this.valkey.get(operatorReauthKey(operatorId, targetTenantId));
    if (raw == null) return true; // No window (never stepped up, or expired/evicted) → write will deny.

    const epoch = Number(raw);
    if (!Number.isFinite(epoch)) {
      this.logger.warn("Operator re-auth window value is not a finite epoch — ignoring", {
        operatorId,
        targetTenantId,
      });
      return true;
    }
    if (epoch > Date.now()) {
      req.reauthContext = { reauthValidUntil: new Date(epoch) };
    }
    return true;
  }
}
