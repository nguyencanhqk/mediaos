import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from '../../auth/token.service';
import { IS_PUBLIC } from '../public.decorator';

export interface AuthenticatedUser {
  id: string;
  companyId: string;
  email: string;
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
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    try {
      const claims = this.tokens.verifyAccessToken(token);
      (req as AuthRequest).user = {
        id: claims.sub,
        companyId: claims.companyId,
        email: claims.email,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
