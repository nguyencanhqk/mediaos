import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { Request } from "express";

/**
 * S3-INT-1 — InternalGuard: defense-in-depth for `/internal/v1/**` routes (manual/retry recalculate).
 * These routes still run behind the normal JwtAuthGuard→CompanyGuard→PermissionGuard chain (an
 * authenticated tenant user with `manage:attendance` can call them) PLUS this guard, which additionally
 * requires the `x-internal-key` header to match INTERNAL_API_KEY (server-only secret, env — BẤT BIẾN #3:
 * never hard-coded, never logged). Missing/unset INTERNAL_API_KEY fails CLOSED (deny), never fail-open.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  private readonly logger = new Logger(InternalGuard.name);

  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env["INTERNAL_API_KEY"];
    if (!expected) {
      this.logger.warn(
        "INTERNAL_API_KEY chưa cấu hình — fail-closed 403 trên mọi route /internal/**",
      );
      throw new ForbiddenException("Internal route unavailable — not configured");
    }
    const req = ctx.switchToHttp().getRequest<Request>();
    const provided = req.headers["x-internal-key"];
    if (typeof provided !== "string" || provided !== expected) {
      throw new ForbiddenException("Internal route: invalid or missing x-internal-key");
    }
    return true;
  }
}
