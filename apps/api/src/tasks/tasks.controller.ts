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
import { TasksService } from "./tasks.service";
import { CreateCommentDto } from "./tasks.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("tasks")
@UsePipes(ZodValidationPipe)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** GET /tasks — danh sách task được giao cho user hiện tại */
  @Get()
  getMyTasks(@Req() req: AuthenticatedRequest) {
    return this.tasks.getMyTasks(req.user.companyId, req.user.id);
  }

  /** GET /tasks/:taskId/comments — thread bình luận của task */
  @Get(":taskId/comments")
  getComments(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
  ) {
    return this.tasks.getComments(req.user.companyId, taskId);
  }

  /** POST /tasks/:taskId/comments — thêm bình luận */
  @Post(":taskId/comments")
  addComment(
    @Req() req: AuthenticatedRequest,
    @Param("taskId") taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tasks.addComment(req.user.companyId, taskId, req.user.id, dto.body);
  }
}
