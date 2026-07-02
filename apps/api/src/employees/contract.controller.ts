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
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { paginated, toPagination } from "../common/pagination";
import {
  createContractSchema,
  linkContractFileSchema,
  listContractsQuerySchema,
  updateContractSchema,
} from "@mediaos/contracts";
import { ContractService } from "./contract.service";

class ListContractsQueryDto extends createZodDto(listContractsQuerySchema) {}
class CreateContractDto extends createZodDto(createContractSchema) {}
class UpdateContractDto extends createZodDto(updateContractSchema) {}
class LinkContractFileDto extends createZodDto(linkContractFileSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-HR-BE-6 — Employee contracts CRUD (hợp đồng lao động). DB-03 §7.7 / API-03 / UI-02 §9.5.
 * Permission pair (CHỐT 2026-07-02): ('view','contract') VIEW · ('manage','contract') create/update/
 * delete/link-file. SCOPE: view:contract CHỈ data_scope=Company cho hr/company-admin (seed mig 0462) —
 * employee/manager KHÔNG có grant ⇒ PermissionGuard 403 (fail-closed), KHÔNG lọc rỗng.
 */
@Controller("hr")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ContractController {
  constructor(private readonly svc: ContractService) {}

  @Get("contracts")
  @RequirePermission("view", "contract")
  async list(@Req() req: AuthenticatedRequest, @Query() query: ListContractsQueryDto) {
    const { data, meta } = await this.svc.list(req.user, query);
    return paginated(data, toPagination(meta.total, meta.page, meta.limit));
  }

  @Get("employees/:id/contracts")
  @RequirePermission("view", "contract")
  async listForEmployee(
    @Req() req: AuthenticatedRequest,
    @Param("id") employeeId: string,
    @Query() query: ListContractsQueryDto,
  ) {
    const { data, meta } = await this.svc.listForEmployee(req.user, employeeId, query);
    return paginated(data, toPagination(meta.total, meta.page, meta.limit));
  }

  @Get("contracts/:id")
  @RequirePermission("view", "contract")
  getById(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.getById(req.user, id);
  }

  @Post("contracts")
  @RequirePermission("manage", "contract")
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateContractDto) {
    return this.svc.create(req.user, dto);
  }

  @Patch("contracts/:id")
  @RequirePermission("manage", "contract")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.svc.update(req.user, id, dto);
  }

  @Post("contracts/:id/file")
  @RequirePermission("manage", "contract")
  linkFile(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: LinkContractFileDto,
  ) {
    return this.svc.linkFile(req.user, id, dto.fileId);
  }

  @Delete("contracts/:id")
  @HttpCode(204)
  @RequirePermission("manage", "contract")
  delete(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.delete(req.user, id);
  }
}
