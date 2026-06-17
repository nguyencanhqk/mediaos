import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import { reauthRequestSchema, type ReauthResponse } from "@mediaos/contracts";
import type { Request } from "express";
import { OperatorOnly } from "../auth/operator-only.decorator";
import { OperatorReauthService } from "./operator-reauth.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/** Body: password step-up (reuses platform-accounts reauthRequestSchema — { password, otp? }). */
class OperatorStepUpDto extends createZodDto(reauthRequestSchema) {}

/**
 * OperatorStepUpController (🔒 AC-0b) — mint a step-up window for a sensitive cross-tenant operation.
 *
 * @OperatorOnly: only an operator-audience token (platform-admin session) reaches this route. The window
 * is scoped to (operator, targetTenant=:id) and consumed by OperatorReauthGuard on the follow-up write.
 * This lane PROVIDES the primitive — it does not retrofit the write routes onto it.
 */
@Controller("admin/platform/companies")
@OperatorOnly()
@UsePipes(ZodValidationPipe)
export class OperatorStepUpController {
  constructor(private readonly reauth: OperatorReauthService) {}

  @Post(":id/step-up")
  async stepUp(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) targetTenantId: string,
    @Body() dto: OperatorStepUpDto,
  ): Promise<ReauthResponse> {
    const { reauthValidUntil } = await this.reauth.stepUp(
      { id: req.user.id, companyId: req.user.companyId },
      targetTenantId,
      { password: dto.password },
    );
    return { reauthValidUntil: reauthValidUntil.toISOString() };
  }
}
