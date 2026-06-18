import { Body, Controller, Get, Post, Put, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { CONFIGURE_MAIL_ACTION, CONFIGURE_MAIL_RESOURCE_TYPE } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { MailConfigService } from "./mail-config.service";
import { TestMailConfigDto, UpsertMailConfigDto } from "./mail-config.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * CS-8 Cấu hình mail server SMTP (🔴 SECRET — tenant self-service). companyId LẤY TỪ JWT.
 *
 * Guard `configure-mail:company` SENSITIVE (is_sensitive=true cả seed lẫn decorator — chống *:* wildcard
 * bypass). KHÔNG requiresReauth: mirror tiền lệ AC-6 webhook (tenant self-service secret, KHÔNG cross-tenant
 * reveal) — reauth FE step-up ghi DEBT (xem CS-8 plan). GET đọc dùng cùng quyền (không có ô đọc riêng).
 */
@Controller("settings/mail-config")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class MailConfigController {
  constructor(private readonly mail: MailConfigService) {}

  @Get()
  @RequirePermission(CONFIGURE_MAIL_ACTION, CONFIGURE_MAIL_RESOURCE_TYPE, { isSensitive: true })
  list(@Req() req: AuthenticatedRequest) {
    return this.mail.list(req.user.companyId);
  }

  @Put()
  @RequirePermission(CONFIGURE_MAIL_ACTION, CONFIGURE_MAIL_RESOURCE_TYPE, { isSensitive: true })
  upsert(@Req() req: AuthenticatedRequest, @Body() dto: UpsertMailConfigDto) {
    return this.mail.upsert(req.user.companyId, dto, req.user.id);
  }

  @Post("test")
  @RequirePermission(CONFIGURE_MAIL_ACTION, CONFIGURE_MAIL_RESOURCE_TYPE, { isSensitive: true })
  test(@Req() req: AuthenticatedRequest, @Body() dto: TestMailConfigDto) {
    return this.mail.testConnection(req.user.companyId, dto);
  }
}
