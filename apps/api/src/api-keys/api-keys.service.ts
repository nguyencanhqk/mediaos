import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  API_KEY_TOKEN_PREFIX,
  type ApiKeyDto,
  type ApiKeyScopeDto,
  type ApiKeyStatus,
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
} from "@mediaos/contracts";
import { TokenService } from "../auth/token.service";
import { PermissionService } from "../permission/permission.service";
import { AuditService } from "../events/audit.service";
import { ApiKeyRepository, type ApiKeyRow } from "./api-keys.repository";

/** Actor đã qua JwtAuthGuard + CompanyGuard + PermissionGuard (manage:api-key). */
export interface ApiKeyActor {
  id: string;
  companyId: string;
}

/**
 * ApiKeysService (AC-5 🔒) — CRUD self-service PAT cho company-admin. Mọi mutation chạy
 * withTenant(actor.companyId) qua repository (RLS scope) + audit-in-tx.
 *
 * BẤT BIẾN #3: tạo PAT sinh plaintext mok_<token> (TokenService.generateOpaqueToken), lưu HASH + prefix,
 *   trả plaintext ĐÚNG 1 LẦN. KHÔNG lưu/log/audit plaintext. List/revoke KHÔNG trả token material.
 * Fail-closed: scope của key PHẢI ⊆ catalog (tồn tại) ∩ ⊆ grant THỰC user (PAT không vượt quyền user).
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly tokens: TokenService,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async createKey(actor: ApiKeyActor, dto: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const scopeIds = [...new Set(dto.scopePermissionIds)];
    if (scopeIds.length === 0) {
      throw new BadRequestException("scopePermissionIds không được rỗng.");
    }

    // (1) Mọi scope id PHẢI tồn tại trong catalog (chống id rác/ghost).
    const existing = await this.repo.catalogPermissionIdsExisting(scopeIds);
    const existingSet = new Set(existing);
    const unknown = scopeIds.filter((id) => !existingSet.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `scopePermissionIds chứa id không có trong permission catalog: ${unknown.join(", ")}`,
      );
    }

    // (2) Scope PHẢI ⊆ grant THỰC của user (PAT KHÔNG vượt quyền user). Hiệu lực kép: scope∩grant ép lại
    //     mỗi request ở PermissionGuard, NHƯNG chặn ngay lúc tạo cũng để key không mang scope user không có.
    const granted = await this.permission.userGrantsPermissionIds(
      actor.id,
      actor.companyId,
      scopeIds,
    );
    const grantedSet = new Set(granted);
    const exceeds = scopeIds.filter((id) => !grantedSet.has(id));
    if (exceeds.length > 0) {
      throw new BadRequestException(
        "scopePermissionIds vượt quyền hiện có của bạn — PAT không được cấp quyền bạn không có.",
      );
    }

    // Sinh plaintext mok_<token>. token entropy cao (32 byte) → SHA-256 hash đủ (TokenService.hashToken).
    const plaintext = `${API_KEY_TOKEN_PREFIX}${this.tokens.generateOpaqueToken()}`;
    const tokenHash = this.tokens.hashToken(plaintext);
    const tokenPrefix = plaintext.slice(0, 12);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    // Audit-in-tx (KHÔNG ghi token material — chỉ id/prefix/scope/expiry).
    const row = await this.repo.insertKey(
      actor.companyId,
      {
        userId: actor.id,
        name: dto.name,
        tokenPrefix,
        tokenHash,
        scopePermissionIds: scopeIds,
        expiresAt,
      },
      { audit: this.audit, actorUserId: actor.id, action: "ApiKeyCreated" },
    );

    return { token: plaintext, apiKey: this.toDto(row) };
  }

  async listKeys(actor: ApiKeyActor): Promise<ApiKeyDto[]> {
    const rows = await this.repo.listKeys(actor.companyId);
    return rows.map((r) => this.toDto(r));
  }

  /** Scope mà actor được phép gán cho PAT (= catalog ∩ grant THỰC actor) — dựng bộ chọn scope FE. */
  async listGrantableScopes(actor: ApiKeyActor): Promise<ApiKeyScopeDto[]> {
    return this.permission.listGrantableScopes(actor.id, actor.companyId);
  }

  async revokeKey(actor: ApiKeyActor, id: string): Promise<ApiKeyDto> {
    const row = await this.repo.revokeKey(actor.companyId, id, {
      audit: this.audit,
      actorUserId: actor.id,
      action: "ApiKeyRevoked",
    });
    if (!row) {
      // null = vắng HOẶC chéo tenant (RLS) → 404 (không lộ tồn tại chéo tenant).
      throw new NotFoundException("API key không tồn tại.");
    }
    return this.toDto(row);
  }

  /** Map row → DTO an toàn (KHÔNG token_hash/plaintext). status dẫn xuất. */
  private toDto(row: ApiKeyRow): ApiKeyDto {
    return {
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      scopePermissionIds: row.scopePermissionIds,
      status: deriveStatus(row),
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** Trạng thái dẫn xuất: revoked > expired > active. */
function deriveStatus(row: ApiKeyRow): ApiKeyStatus {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}
