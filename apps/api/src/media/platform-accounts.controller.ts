import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Request } from 'express';
import { PermissionGuard } from '../permission/guards/permission.guard';
import { RequirePermission } from '../permission/require-permission.decorator';
import { ReauthGuard } from './reauth.guard';
import { PlatformAccountsService, type RevealCtx } from './platform-accounts.service';
import {
  CreatePlatformAccountDto,
  ListPlatformAccountsQueryDto,
  ReauthDto,
  UpdatePlatformAccountSecretDto,
} from './platform-accounts.dto';

/** Request after the global JwtAuthGuard + CompanyGuard, plus the re-auth window from ReauthGuard. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
  reauthContext?: { reauthValidUntil?: Date | null };
  requestId?: string;
}

/**
 * PlatformAccountsController (🔒 G6-2e) — crown-jewel reveal/edit HTTP surface for platform_accounts.
 *
 * Guards are applied PER-METHOD (not class-level) on purpose: the reveal route needs
 * ReauthGuard to run BEFORE PermissionGuard (NestJS runs class guards before method guards, so a
 * class-level PermissionGuard would invert the order). The global JwtAuthGuard + CompanyGuard still
 * run first and populate req.user.
 *
 * reauth has NO @RequirePermission/PermissionGuard by design: it is password-verified step-up that
 * mints a window which is useless without the fully-enforced reveal (F2 object-grant + valid window,
 * checked at BOTH PermissionGuard and the service). Gating it at company-tier would lock out
 * object-grant-only users — the intended reveal-secret persona (grants are per-account, 0027).
 *
 * Enforcement is defense-in-depth: PermissionGuard (HTTP) AND PlatformAccountsService.can() both
 * check reveal/edit. Masking is at the repository query-projection — secret/recovery columns never
 * leave the DB via list/get/create/update.
 */
@Controller()
@UsePipes(ZodValidationPipe)
export class PlatformAccountsController {
  constructor(private readonly accounts: PlatformAccountsService) {}

  // ── List / detail (masked projection) ──────────────────────────────────────

  @Get('platform-accounts')
  @UseGuards(PermissionGuard)
  @RequirePermission('read', 'platform-account')
  listAccounts(@Req() req: AuthenticatedRequest, @Query() query: ListPlatformAccountsQueryDto) {
    return this.accounts.listAccounts(req.user, {
      platformId: query.platformId,
      status: query.status,
      q: query.q,
    });
  }

  @Get('platform-accounts/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('read', 'platform-account')
  getAccount(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.accounts.getAccount(req.user, id);
  }

  // ── Create (app-gen id BEFORE encrypt → AAD bind) ──────────────────────────

  @Post('platform-accounts')
  @UseGuards(PermissionGuard)
  @RequirePermission('create', 'platform-account')
  createAccount(@Req() req: AuthenticatedRequest, @Body() dto: CreatePlatformAccountDto) {
    return this.accounts.createAccount(req.user, dto);
  }

  // ── Update secret (rotate-secret — sensitive edit, fresh DEK+nonce) ─────────

  @Patch('platform-accounts/:id/secret')
  @UseGuards(PermissionGuard)
  @RequirePermission('edit-platform-account', 'platform-account', { isSensitive: true })
  updateSecret(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePlatformAccountSecretDto,
  ) {
    return this.accounts.updateSecret(req.user, id, dto);
  }

  // ── Re-auth (step-up) — mint per-(userId, accountId) window. Global guards only. ──

  @Post('platform-accounts/reauth')
  @HttpCode(200)
  reauth(@Req() req: AuthenticatedRequest, @Body() dto: ReauthDto) {
    return this.accounts.reauth(req.user, dto.accountId, { password: dto.password, otp: dto.otp });
  }

  // ── Reveal (sensitive + object-grant + re-auth + audit each view) ──────────
  // ReauthGuard BEFORE PermissionGuard: it populates req.reauthContext that PermissionGuard reads.

  @Post('platform-accounts/:id/reveal')
  @HttpCode(200)
  @UseGuards(ReauthGuard, PermissionGuard)
  @RequirePermission('reveal-secret', 'platform-account', { isSensitive: true, requiresReauth: true })
  revealSecret(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const ctx: RevealCtx = {
      reauthValidUntil: req.reauthContext?.reauthValidUntil ?? null,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return this.accounts.revealSecret(req.user, id, ctx);
  }

  // ── Break-glass reveal (🔒 G6-2 PR-B ROUND 2 — emergency JIT reveal, NO re-auth window) ──
  // NO ReauthGuard: the gate is the company-tier reveal-break-glass permission (a) PLUS an active grant (b),
  // NOT the per-account object grant + re-auth window that the normal reveal-secret route requires. The :id is
  // the platform_account id; the service looks up the caller's own active grant for it. {isSensitive} only (no
  // requiresReauth) → PermissionGuard does a company-tier check, does NOT treat :id as an object-grant target.
  @Post('platform-accounts/:id/break-glass-reveal')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('reveal-break-glass', 'break-glass', { isSensitive: true })
  revealSecretViaBreakGlass(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const ctx: RevealCtx = {
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return this.accounts.revealSecretViaBreakGlass(req.user, id, ctx);
  }
}
