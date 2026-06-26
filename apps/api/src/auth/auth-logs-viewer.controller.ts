import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { paginated, toPagination } from "../common/pagination";
import { LoginLogListQueryDto, SecurityEventListQueryDto } from "./auth-logs.dto";
import { AuthLogsViewerService } from "./auth-logs-viewer.service";

/** Request đã qua JwtAuthGuard + CompanyGuard (global) — user gắn ở req.user. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-AUTH-BE-5 — Auth-log viewer (READ-ONLY): AUTH-API-401 GET /auth/login-logs + AUTH-API-402
 * GET /auth/security-events. Cùng cổng quyền @RequirePermission('view','audit-log',{isSensitive:true}) —
 * CẶP ENGINE THẬT đã seed mig 0340 (grant company-admin), KHÔNG dùng mã FE (bài học drift S1-FND-MODULE).
 *
 * isSensitive:true ⇒ wildcard '*:*' KHÔNG kế thừa (PermissionGuard fail-closed). Data-scope = Company qua
 * withTenant + RLS ở service (BẤT BIẾN #1). KHÔNG có route ghi/sửa/xoá (append-only BẤT BIẾN #2). Controller
 * KHÔNG chứa business-logic — chỉ map req→service→envelope phân trang (paginated → interceptor hoist).
 *
 * @Controller('auth') thứ hai (ngoài AuthController) — Nest gộp route cùng prefix; KHÔNG va route hiện có.
 */
@Controller("auth")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AuthLogsViewerController {
  constructor(private readonly viewer: AuthLogsViewerService) {}

  @Get("login-logs")
  @RequirePermission("view", "audit-log", { isSensitive: true })
  async listLoginLogs(@Req() req: AuthenticatedRequest, @Query() query: LoginLogListQueryDto) {
    const { data, total } = await this.viewer.listLoginLogs(req.user.companyId, query);
    return paginated(data, toPagination(total, query.page, query.per_page));
  }

  @Get("security-events")
  @RequirePermission("view", "audit-log", { isSensitive: true })
  async listSecurityEvents(
    @Req() req: AuthenticatedRequest,
    @Query() query: SecurityEventListQueryDto,
  ) {
    const { data, total } = await this.viewer.listSecurityEvents(req.user.companyId, query);
    return paginated(data, toPagination(total, query.page, query.per_page));
  }
}
