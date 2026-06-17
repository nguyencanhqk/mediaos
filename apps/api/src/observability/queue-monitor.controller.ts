import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { OperatorOnly } from "../auth/operator-only.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { OperatorReauthGuard } from "../platform/operator-reauth.guard";
import { OperatorReauthService } from "../platform/operator-reauth.service";
import { QueueMonitorService } from "./queue-monitor.service";
import { PLATFORM_AUDIT_SCOPE } from "./observability.constants";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * AC-8 QueueMonitorController — viewer queue (outbox + dead-letter) CHÉO tenant cho platform operator.
 *
 * GET /admin/platform/queue: @OperatorOnly + @RequirePermission(view:platform-audit, {isSensitive:true})
 *   + OperatorReauthGuard step-up (sentinel PLATFORM_AUDIT_SCOPE). MIRROR AuditReadController operator path.
 *   KHÔNG requiresReauth:true (TRAP reveal-class). row-cap qua ?limit (clamp [1..MAX] ở service).
 */
@Controller("admin/platform/queue")
@OperatorOnly()
@UseGuards(OperatorReauthGuard, PermissionGuard)
export class QueueMonitorController {
  constructor(
    private readonly queueMonitor: QueueMonitorService,
    private readonly operatorReauth: OperatorReauthService,
  ) {}

  @Get()
  @RequirePermission("view", "platform-audit", { isSensitive: true })
  async getQueueStatus(@Req() req: AuthenticatedRequest, @Query("limit") limit?: string) {
    await this.requireStepUp(req.user);
    const parsedLimit = limit != null ? Number(limit) : undefined;
    return this.queueMonitor.getQueueStatus(req.user, parsedLimit);
  }

  /** FAIL-CLOSED: thiếu/hết hạn cửa sổ step-up (operator, sentinel) ⇒ 403. */
  private async requireStepUp(operator: { id: string; companyId: string }): Promise<void> {
    const window = await this.operatorReauth.resolveWindow(operator.id, PLATFORM_AUDIT_SCOPE);
    if (!window) {
      throw new ForbiddenException(
        "Cross-tenant queue read requires operator step-up (re-authentication).",
      );
    }
  }
}
