import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import { listFileAccessLogsQuerySchema, type ListFileAccessLogsQuery } from "@mediaos/contracts";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { paginated, toPagination } from "../../common/pagination";
import { FileAccessLogReadService } from "./file-access-log-read.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-FND-BE-3 (L4-file-access-log-viewer) — HTTP surface ĐỌC cho `file_access_logs` (BACKEND-11, DB-08 §8.8,
 * route API-09). Global JwtAuthGuard + CompanyGuard (app.module) đã set req.user; class-level PermissionGuard
 * opt-in (fail-closed — mọi route @RequirePermission). Resource = 'foundation-file-access-log' (seed mig 0435).
 *
 *  GET /foundation/file-access-logs (view) — list MASKED + pagination + filter fileId/actorUserId/action/from-to.
 *
 * BẤT BIẾN #2 (APPEND-ONLY): TUYỆT ĐỐI KHÔNG endpoint POST/PATCH/DELETE trên file_access_logs (REVOKE
 * UPDATE/DELETE ở mig 0433 giữ nguyên) ⇒ controller CHỈ có route GET. Envelope + pagination do
 * ResponseEnvelopeInterceptor TOÀN CỤC dựng — controller trả `paginated(...)` (KHÔNG tự bọc). Prefix 'api/v1'.
 */
@Controller("foundation/file-access-logs")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class FileAccessLogController {
  constructor(private readonly reader: FileAccessLogReadService) {}

  /** GET /foundation/file-access-logs — log truy cập file của tenant (masked, phân trang). Gate view. */
  @Get()
  @RequirePermission("view", "foundation-file-access-log")
  async list(@Req() req: AuthenticatedRequest, @Query() query: ListFileAccessLogsQuery) {
    const parsed = listFileAccessLogsQuerySchema.parse(query);
    const { data, meta } = await this.reader.list(req.user.companyId, parsed);
    return paginated(data, toPagination(meta.total, meta.page, meta.limit));
  }
}
