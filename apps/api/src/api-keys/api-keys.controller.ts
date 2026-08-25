import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { CreateApiKeyDto } from "./api-keys.dto";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ApiKeysService } from "./api-keys.service";

/** Request sau khi JwtAuthGuard + CompanyGuard set req.user. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

const ACTION = "manage";
const RESOURCE = "api-key";

/**
 * ApiKeysController (AC-5 🔒) — self-service PAT cho company-admin. Mọi route gate `manage:api-key`
 * (is_sensitive — khai ở CẢ decorator lẫn seed, chống *:* wildcard bypass cổng nhạy cảm). Chạy
 * withTenant(actor.companyId) ở service (RLS).
 *
 * BẤT BIẾN #3: POST /api-keys trả token plaintext ĐÚNG 1 LẦN; GET/list KHÔNG trả token material.
 */
@Controller("api-keys")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  /** Tạo PAT mới — trả { token, apiKey }. token chỉ hiển thị 1 lần (client tự lưu). */
  @Post()
  @RequirePermission(ACTION, RESOURCE, { isSensitive: true })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateApiKeyDto) {
    // S10-FND-BODYVALIDATE-1 (KI-068): `CreateApiKeyDto` là CLASS `createZodDto` ⇒ metatype tồn tại lúc
    // chạy ⇒ `ZodValidationPipe` chiếu được schema và chặn ở BIÊN (400). Trước đây chỗ này khai TYPE
    // `CreateApiKeyRequest` (`z.infer`) kèm comment khẳng định "ZodValidationPipe đã chạy" — SAI: pipe
    // KHÔNG có gì để chiếu, và `.parse()` thủ công ở đây ném `ZodError` THÔ mà AllExceptionsFilter
    // không hiểu ⇒ 500. Đã bỏ `.parse()`: validate giờ là việc của biên, một lớp một trách nhiệm.
    return this.apiKeys.createKey(req.user, dto);
  }

  /** Danh sách PAT của tenant (DTO an toàn — KHÔNG token material). */
  @Get()
  @RequirePermission(ACTION, RESOURCE, { isSensitive: true })
  list(@Req() req: AuthenticatedRequest) {
    return this.apiKeys.listKeys(req.user);
  }

  /** Scope actor được phép gán cho PAT (catalog ∩ grant actor) — dựng bộ chọn scope khi tạo. */
  @Get("scopes")
  @RequirePermission(ACTION, RESOURCE, { isSensitive: true })
  scopes(@Req() req: AuthenticatedRequest) {
    return this.apiKeys.listGrantableScopes(req.user);
  }

  /** Thu hồi 1 PAT (set revoked_at). 200 + DTO đã revoke. */
  @Post(":id/revoke")
  @HttpCode(200)
  @RequirePermission(ACTION, RESOURCE, { isSensitive: true })
  revoke(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.apiKeys.revokeKey(req.user, id);
  }
}
