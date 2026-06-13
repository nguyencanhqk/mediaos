import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { EvaluationService } from "./evaluation.service";
import {
  CreateEvaluationTemplateDto,
  ListEvaluationTemplateQueryDto,
  RecordScoresDto,
  UpdateCriteriaDto,
} from "./evaluation.dto";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * G8-3 — Evaluation HTTP layer. PermissionGuard fail-closed:
 *  - manage:evaluation-template  → tạo/sửa template + bộ tiêu chí (CRUD config).
 *  - score:evaluation            → chấm điểm 1 bước workflow.
 * Hyphen spelling 'evaluation-template' byte-identical với seed migration 0085 (tránh 403 vĩnh viễn).
 * companyId/userId lấy từ req.user (mirror approval-inbox.controller.ts).
 */
@Controller("evaluation")
@UsePipes(ZodValidationPipe)
export class EvaluationController {
  constructor(private readonly evaluation: EvaluationService) {}

  /** GET /evaluation/templates — danh sách template active của tenant. */
  @Get("templates")
  listTemplates(@Req() req: AuthenticatedRequest, @Query() query: ListEvaluationTemplateQueryDto) {
    return this.evaluation.listTemplates(req.user.companyId, req.user.id, {
      workflowStepCode: query.workflowStepCode,
      includeInactive: query.includeInactive,
    });
  }

  /** POST /evaluation/templates — tạo template + tiêu chí (manage:evaluation-template). */
  @Post("templates")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "evaluation-template")
  createTemplate(@Req() req: AuthenticatedRequest, @Body() dto: CreateEvaluationTemplateDto) {
    return this.evaluation.createTemplate(req.user.companyId, req.user.id, dto);
  }

  /** PUT /evaluation/templates/:id/criteria — thay bộ tiêu chí (manage:evaluation-template). */
  @Put("templates/:id/criteria")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "evaluation-template")
  updateCriteria(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateCriteriaDto,
  ) {
    return this.evaluation.updateCriteria(req.user.companyId, req.user.id, id, dto);
  }

  /** POST /evaluation/scores — chấm điểm 1 bước workflow (score:evaluation). */
  @Post("scores")
  @UseGuards(PermissionGuard)
  @RequirePermission("score", "evaluation")
  recordScores(@Req() req: AuthenticatedRequest, @Body() dto: RecordScoresDto) {
    return this.evaluation.recordScores(req.user.companyId, req.user.id, dto);
  }
}
