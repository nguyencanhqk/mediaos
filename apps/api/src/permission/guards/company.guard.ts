import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../public.decorator';
import type { AuthRequest } from './jwt-auth.guard';

/**
 * CompanyGuard — asserts that the authenticated user has a companyId in JWT claims.
 * Must run AFTER JwtAuthGuard. Routes decorated with @Public() bypass this guard.
 */
@Injectable()
export class CompanyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Partial<AuthRequest>>();
    if (!req.user?.companyId) {
      throw new ForbiddenException('Company context missing — ensure JwtAuthGuard runs first');
    }
    return true;
  }
}
