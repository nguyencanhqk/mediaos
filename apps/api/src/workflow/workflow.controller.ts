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
import { ApprovalService } from "./approval.service";
import { StartWorkflowDto, SubmitStepDto } from "./workflow.dto";
import { ApproveDto, RequestRevisionDto } from "./approval.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("workflow")
@UsePipes(ZodValidationPipe)
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly approval: ApprovalService,
  ) {}

  /** POST /workflow/start — tạo workflow instance cho content item */
  @Post("start")
  startWorkflow(@Req() req: AuthenticatedRequest, @Body() dto: StartWorkflowDto) {
    return this.workflow.startWorkflow(req.user.companyId, dto.contentItemId, req.user.id);
  }

  /** GET /workflow/approval-requests — hàng chờ duyệt (reviewer queue) */
  // PHẢI đặt trước @Get(":instanceId") để tránh "approval-requests" bị parse thành UUID.
  @Get("approval-requests")
  listApprovalRequests(@Req() req: AuthenticatedRequest) {
    return this.approval.listPending(req.user.companyId);
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
    @Body() dto: SubmitStepDto,
  ) {
    return this.workflow.submitStep(req.user.companyId, stepId, req.user.id, {
      submissionUrl: dto.submissionUrl,
      submissionNote: dto.submissionNote,
    });
  }

  /** POST /workflow/approval-requests/:requestId/approve — T3: phê duyệt */
  @Post("approval-requests/:requestId/approve")
  approve(
    @Req() req: AuthenticatedRequest,
    @Param("requestId") requestId: string,
    @Body() dto: ApproveDto,
  ) {
    return this.approval.approve(req.user.companyId, requestId, req.user.id, dto.comment ?? undefined);
  }

  /** POST /workflow/approval-requests/:requestId/request-revision — T4: trả về sửa */
  @Post("approval-requests/:requestId/request-revision")
  requestRevision(
    @Req() req: AuthenticatedRequest,
    @Param("requestId") requestId: string,
    @Body() dto: RequestRevisionDto,
  ) {
    return this.approval.requestRevision(
      req.user.companyId,
      requestId,
      req.user.id,
      dto.description,
      dto.comment ?? undefined,
    );
  }
}
