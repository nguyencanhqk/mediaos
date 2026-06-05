import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { WorkflowService } from "./workflow.service";
import { StartWorkflowDto, SubmitStepDto } from "./workflow.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("workflow")
@UsePipes(ZodValidationPipe)
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  /** POST /workflow/start — tạo workflow instance cho content item */
  @Post("start")
  startWorkflow(@Req() req: AuthenticatedRequest, @Body() dto: StartWorkflowDto) {
    return this.workflow.startWorkflow(req.user.companyId, dto.contentItemId, req.user.id);
  }

  /** GET /workflow/:instanceId — lấy workflow + steps */
  @Get(":instanceId")
  getWorkflow(@Req() req: AuthenticatedRequest, @Param("instanceId") instanceId: string) {
    return this.workflow.getWorkflow(req.user.companyId, instanceId);
  }

  /** POST /workflow/steps/:stepId/start — bắt đầu làm step (T1 / T5) */
  @Post("steps/:stepId/start")
  startStep(@Req() req: AuthenticatedRequest, @Param("stepId") stepId: string) {
    return this.workflow.startStep(req.user.companyId, stepId, req.user.id);
  }

  /** POST /workflow/steps/:stepId/submit — nộp work → waiting_review (T2) */
  @Post("steps/:stepId/submit")
  submitStep(
    @Req() req: AuthenticatedRequest,
    @Param("stepId") stepId: string,
    @Body() _dto: SubmitStepDto,
  ) {
    return this.workflow.submitStep(req.user.companyId, stepId, req.user.id);
  }
}
