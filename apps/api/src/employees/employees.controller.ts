import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { employeeListQuerySchema, type EmployeeListQuery } from "@mediaos/contracts";
import type { Request } from "express";
import { paginated, toPagination } from "../common/pagination";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { RequirePermission } from "../permission/require-permission.decorator";
import { EmployeesService } from "./employees.service";
import { CreateEmployeeProfileDto, UpdateEmployeeProfileDto } from "./employees.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("employees")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  /**
   * GET /employees — danh sách nhân sự CÓ PHÂN TRANG (AUTH-scoped, `read:employee`).
   *
   * ⟲ S10-HR-EMPPAGE-1 (KI-010). Trước WO này handler nhận **4 `@Query("...")` RỜI** và không đi qua
   * một schema Zod nào, còn repo `.limit(2000)` là một **CẮT CÂM**: client nhận 2000 hàng mà không có
   * cách nào biết còn hàng phía sau. Nay `per_page` kẹp ở BIÊN, `LIMIT/OFFSET` ở SQL, và envelope
   * mang `pagination.total` — cắt CÓ BÁO thay cho cắt CÂM. Trần 2000 GIỮ NGUYÊN, không nới.
   *
   * ⚠️ `@UsePipes(new ZodValidationPipe(schema))` CẤP METHOD, không dựa vào `@UsePipes(ZodValidationPipe)`
   * cấp class ở trên: pipe cấp class lấy schema từ **metatype** của tham số, mà `EmployeeListQuery` là
   * `z.infer` — một TYPE bị xoá lúc chạy ⇒ metatype là `Object` ⇒ không có gì để chiếu. Đúng bẫy đã
   * trả giá ở KI-068 ([[nestjs-zod-class-level-pipe-does-nothing]]). Khuôn đúng: `hr-read.controller.ts`.
   *
   * ⚠️ ĐỔI HỢP ĐỒNG API: thân trả về từ MẢNG TRẦN → envelope `{data, pagination}`. Census hộ tiêu thụ
   * (25/08): `apps/console/src/lib/employees-api.ts` là hộ DUY NHẤT ngoài test — `apps/app` dùng đường
   * `/hr/employees` (đã có phân trang từ trước). Cả hai đã cập nhật trong cùng PR.
   */
  @Get()
  @RequirePermission("read", "employee")
  @UsePipes(new ZodValidationPipe(employeeListQuerySchema))
  async listEmployees(@Req() req: AuthenticatedRequest, @Query() query: EmployeeListQuery) {
    const { data, meta } = await this.employees.listEmployees(req.user, query);
    return paginated(data, toPagination(meta.total, meta.page, meta.limit));
  }

  @Post()
  @Idempotent() // S5-BE-CONTRACT-1: chống tạo trùng hồ sơ nhân sự khi retry (IMPL-08 §13.2).
  @RequirePermission("create", "employee")
  createEmployee(@Req() req: AuthenticatedRequest, @Body() dto: CreateEmployeeProfileDto) {
    return this.employees.createEmployee(req.user, dto);
  }

  @Get(":id")
  @RequirePermission("read", "employee")
  getEmployee(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.employees.getEmployee(req.user, id);
  }

  @Patch(":id")
  @RequirePermission("update", "employee")
  updateEmployee(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateEmployeeProfileDto,
  ) {
    return this.employees.updateEmployee(req.user, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("delete", "employee")
  deleteEmployee(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    // S7-CHAT-BE-5 (W14): truyền actor để dòng audit "rời phòng vì hồ sơ bị xoá" nói được AI đã xoá.
    return this.employees.deleteEmployee(req.user.companyId, id, req.user.id);
  }
}
