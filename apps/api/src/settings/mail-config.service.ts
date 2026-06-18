import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import {
  SMTP_SECRET_PURPOSE,
  type MailConfigDto,
  type MailConfigListDto,
  type MailTestResult,
  type TestMailConfigRequest,
  type UpsertMailConfigRequest,
} from "@mediaos/contracts";
import { SecretEncryptionService } from "../crypto/secret-encryption.service";
import type { CompanyMailConfig } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { MailConfigRepository, type MailConfigFields } from "./mail-config.repository";
import { MailTransportService } from "./mail-transport.service";

const DEFAULT_SCOPE = "default";

/** Map row DB → view DTO (KHÔNG password / KHÔNG cột envelope). `hasPassword` = luôn true (envelope NOT NULL). */
function toDto(row: CompanyMailConfig): MailConfigDto {
  return {
    scope: row.scope,
    host: row.host,
    port: row.port,
    username: row.username,
    secure: row.secure,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    hasPassword: true,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class MailConfigService {
  constructor(
    private readonly repo: MailConfigRepository,
    private readonly secrets: SecretEncryptionService,
    private readonly transport: MailTransportService,
    private readonly audit: AuditService,
  ) {}

  /** GET — danh sách config theo scope (KHÔNG password). Rỗng = chưa thiết lập. */
  async list(companyId: string): Promise<MailConfigListDto> {
    const rows = await this.repo.listConfigs(companyId);
    return { configs: rows.map(toDto) };
  }

  /**
   * PUT — upsert theo (company, scope). password OPTIONAL:
   *   - có → encrypt envelope mới (recordId = id app-gen TRƯỚC encrypt → AAD bind);
   *   - vắng + đã tồn tại → giữ envelope cũ (chỉ sửa non-secret);
   *   - vắng + tạo MỚI → 400 (không có password để mã hoá).
   */
  async upsert(companyId: string, dto: UpsertMailConfigRequest, actorUserId: string): Promise<MailConfigDto> {
    const scope = dto.scope ?? DEFAULT_SCOPE;
    const fields: MailConfigFields = {
      scope,
      host: dto.host,
      port: dto.port,
      username: dto.username,
      secure: dto.secure ?? true,
      fromName: dto.fromName ?? null,
      fromEmail: dto.fromEmail,
    };

    // recordId = id của hàng sẽ ghi (app-gen TRƯỚC encrypt → AAD bind đúng id). Có password → envelope mới.
    const recordId = randomUUID();
    let envelope = null as Awaited<ReturnType<SecretEncryptionService["encryptSecret"]>> | null;

    if (dto.password !== undefined) {
      envelope = await this.secrets.encryptSecret(dto.password, {
        companyId,
        recordId,
        purpose: SMTP_SECRET_PURPOSE,
      });
    } else {
      // Vắng password: chỉ hợp lệ khi config đã tồn tại (giữ envelope cũ). Tạo mới mà vắng → 400.
      const existing = await this.repo.findByScope(companyId, scope);
      if (!existing) {
        throw new BadRequestException("Cấu hình mới yêu cầu mật khẩu SMTP.");
      }
    }

    const row = await this.repo.upsert(companyId, recordId, fields, envelope, {
      audit: this.audit,
      actorUserId,
    });
    return toDto(row);
  }

  /**
   * POST test — kiểm tra kết nối SMTP. Password lấy theo thứ tự: body.password (mới) → decrypt envelope đã
   * lưu (nếu vắng). Nếu không có password nào → 400. Kết quả lỗi ĐÃ sanitize (KHÔNG credential).
   */
  async testConnection(companyId: string, dto: TestMailConfigRequest): Promise<MailTestResult> {
    const scope = dto.scope ?? DEFAULT_SCOPE;
    let password = dto.password;

    if (password === undefined) {
      const existing = await this.repo.findByScope(companyId, scope);
      if (!existing) {
        throw new BadRequestException("Chưa có cấu hình để kiểm tra — vui lòng nhập mật khẩu SMTP.");
      }
      // Decrypt JIT — plaintext chỉ trong RAM lúc test; AAD bind theo cột PERSISTED (row.companyId/row.id).
      try {
        password = await this.secrets.decryptSecret(existing, {
          companyId: existing.companyId,
          recordId: existing.id,
          purpose: SMTP_SECRET_PURPOSE,
        });
      } catch {
        // decrypt thất bại (tamper/corruption) → KHÔNG lộ chi tiết crypto.
        return { ok: false, errorMessage: "Không giải mã được mật khẩu đã lưu." };
      }
    }

    return this.transport.test({
      host: dto.host,
      port: dto.port,
      username: dto.username,
      secure: dto.secure ?? true,
      password,
    });
  }
}
