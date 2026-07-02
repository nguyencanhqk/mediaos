import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { TokenService, type TokenAudience } from "../../auth/token.service";
import { OPERATOR_ONLY } from "../../auth/operator-only.decorator";
import { IS_PUBLIC } from "../public.decorator";

export interface AuthenticatedUser {
  id: string;
  companyId: string;
  email: string;
  /** AC-0b: audience của access token đã verify ('operator' phiên platform-admin, 'tenant' phiên thường). */
  aud: TokenAudience;
  /**
   * S2-AUTH-BE-7: id phiên (user_sessions.id, từ claim jti của access token) — CHỈ định danh "phiên hiện
   * tại" cho revoke-others (KHÔNG cấp quyền). undefined khi token legacy thiếu jti (ký trước WO này) hoặc
   * qua ApiKeyAuthGuard (PAT KHÔNG có session).
   */
  sessionId?: string;
}

/** Extend Express Request to carry the resolved user after JWT validation. */
export type AuthRequest = Request & { user: AuthenticatedUser };

/**
 * JwtAuthGuard — verifies Bearer access token and attaches user to request.
 * Must run FIRST in the guard pipeline (before CompanyGuard + PermissionGuard).
 * Routes decorated with @Public() bypass this guard entirely.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // WS execution context: guard này là APP_GUARD toàn cục → cũng chạy cho gateway message handler.
    // WS KHÔNG có HTTP request → switchToHttp().getRequest() undefined sẽ crash. WS tự auth ở handshake
    // (RealtimeGateway.verify token → socket.data.user) và MỌI handler đọc socket.data.user fail-closed,
    // nên ở đây trả true cho non-http (không phải free pass — auth đã ép tầng gateway). Xem plan G10-1.
    if (ctx.getType() !== "http") return true;

    const req = ctx.switchToHttp().getRequest<Request>();

    // AC-5: nếu ApiKeyAuthGuard (chạy TRƯỚC) đã xác thực qua PAT → req.user.viaApiKey=true. Bỏ qua verify
    // JWT (token là mok_, KHÔNG phải JWT — verifyAccessToken sẽ ném). PAT đã set companyId/scope từ key.
    const existing = (req as Partial<AuthRequest>).user as { viaApiKey?: boolean } | undefined;
    if (existing?.viaApiKey) return true;

    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid Authorization header");
    }

    // AC-0b: route @OperatorOnly ⇒ audience='operator'; còn lại mặc định 'tenant' (route cũ KHÔNG đổi).
    // verifyAccessToken ép biên: token sai audience (operator↔tenant) throw → 401. Token legacy (không
    // aud) = 'tenant' (backward-compat) nên KHÔNG qua được route operator.
    const operatorOnly = this.reflector.getAllAndOverride<boolean>(OPERATOR_ONLY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const expectedAudience: TokenAudience = operatorOnly ? "operator" : "tenant";

    const token = authHeader.slice(7);
    try {
      const claims = this.tokens.verifyAccessToken(token, expectedAudience);
      (req as AuthRequest).user = {
        id: claims.sub,
        companyId: claims.companyId,
        email: claims.email,
        aud: claims.aud,
        sessionId: claims.jti,
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}
