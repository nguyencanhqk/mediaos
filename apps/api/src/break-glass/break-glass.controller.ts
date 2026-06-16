import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { BreakGlassGrantService } from "./break-glass-grant.service";
import { RequestBreakGlassDto } from "./break-glass.dto";

/** Request after the global JwtAuthGuard + CompanyGuard populate req.user. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

const RESOURCE = "break-glass";

/**
 * BreakGlassController (🔒 G6-2 PR-B) — HTTP surface for break-glass emergency-access lifecycle + listing.
 *
 * Defense-in-depth: PermissionGuard (HTTP) AND BreakGlassGrantService.assertCan() both check the sensitive
 * permission. request/approve/revoke are company-tier sensitive (no object grant, no re-auth) — the
 * PermissionGuard's reveal-class resourceId forwarding is intentionally NOT triggered here ({isSensitive}
 * only, no requiresReauth), so the :id path param is the GRANT id consumed by the service, not an
 * object-grant target. SoD is enforced at the DB (UNIQUE + CHECK) + service (COUNT DISTINCT) — see mig 0200.
 *
 * Reveal lives on PlatformAccountsController (POST /platform-accounts/:id/break-glass-reveal): the crypto/
 * decrypt stays in PlatformAccountsService (no crypto copy here), gated by an active grant (ROUND 2 gate b).
 */
@Controller("break-glass")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class BreakGlassController {
  constructor(private readonly grants: BreakGlassGrantService) {}

  /**
   * List the caller's OWN break-glass grants (status/approvalCount/expiresAt) — drives the reveal screen.
   * Gated on `reveal-break-glass` (the screen's purpose is reveal): a user who holds reveal-break-glass but
   * never `request-break-glass` (a valid role split) must still see their grants to reveal active ones.
   * Data is the caller's own rows (RLS + requester filter) — no cross-user/secret exposure.
   */
  @Get("grants")
  @RequirePermission("reveal-break-glass", RESOURCE, { isSensitive: true })
  listMyGrants(@Req() req: AuthenticatedRequest) {
    return this.grants.listMyGrants(req.user);
  }

  /** Open an emergency-access request on one platform account (reason + TTL). Starts at 'pending'. */
  @Post("grants")
  @RequirePermission("request-break-glass", RESOURCE, { isSensitive: true })
  request(@Req() req: AuthenticatedRequest, @Body() dto: RequestBreakGlassDto) {
    return this.grants.requestGrant(req.user, {
      platformAccountId: dto.platformAccountId,
      reason: dto.reason,
      ttlSeconds: dto.ttlSeconds,
    });
  }

  /** Approve a grant (SoD: ≥2 distinct approvers, no self-approval). Flips to 'active' at threshold. */
  @Post("grants/:id/approve")
  @HttpCode(200)
  @RequirePermission("approve-break-glass", RESOURCE, { isSensitive: true })
  approve(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.grants.approveGrant(req.user, id);
  }

  /** Revoke a grant (pending/active → revoked) — closes the emergency window early. */
  @Post("grants/:id/revoke")
  @HttpCode(200)
  @RequirePermission("revoke-break-glass", RESOURCE, { isSensitive: true })
  revoke(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.grants.revokeGrant(req.user, id);
  }
}
