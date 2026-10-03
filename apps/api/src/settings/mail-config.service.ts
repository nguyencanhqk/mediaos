import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  FOUNDATION_ERROR_CODES,
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
import {
  changedDestinationFields,
  destinationOf,
  MailPasswordRequiredError,
  type MailDestination,
} from "./mail-destination";
import { MailTransportService } from "./mail-transport.service";

const DEFAULT_SCOPE = "default";

/** Câu của 400 `MAIL_PASSWORD_REQUIRED` theo ca — client bắt theo `code`, câu chỉ để người đọc. */
const PASSWORD_REQUIRED = {
  newConfig: "Cấu hình mới yêu cầu mật khẩu SMTP.",
  noConfigToTest: "Chưa có cấu hình để kiểm tra — vui lòng nhập mật khẩu SMTP.",
  destinationChanged: "Đã đổi máy chủ, cổng, tên đăng nhập hoặc TLS — cần nhập lại mật khẩu SMTP.",
  // Repo ném khi vị từ đích của câu UPDATE ra 0 hàng: đích lệch HOẶC hàng vừa bị thay ở nơi khác (PUT kèm mật
  // khẩu chen giữa, kể cả khi KHÔNG đổi đích) — không phân biệt được ở đây nên câu phải đúng cho cả hai.
  storedRowChanged:
    "Cấu hình máy chủ thư vừa thay đổi ở nơi khác hoặc đích không khớp — tải lại trang rồi thử lại (nhập mật khẩu nếu đổi đích).",
} as const;

function passwordRequired(message: string): BadRequestException {
  return new BadRequestException({ code: FOUNDATION_ERROR_CODES.MAIL_PASSWORD_REQUIRED, message });
}

/**
 * Giá trị do CLIENT chọn trước khi vào log: `JSON.stringify` thoát CR/LF/nháy, rồi mọi ký tự ngoài ASCII in
 * được ⇒ `\uXXXX` — chặn giả dòng log bằng ký tự bidi (U+202E), U+2028/2029, NEL (FULL gate security LOW).
 */
function logSafe(value: string): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

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

/**
 * CS-8 cấu hình mail server. Mật khẩu SMTP là write-only (envelope) và GẮN với đích (host/port/username/
 * secure) của chính hàng chứa nó — S19-SEC-MAILCREDEXFIL-1: người giữ `configure-mail` không đọc được mật
 * khẩu, nên cũng không được gửi nó tới một đích do họ chọn (đó là đọc gián tiếp). Vắng password chỉ hợp lệ
 * khi đích khớp nguyên hàng đã lưu; đổi đích phải kèm mật khẩu mới.
 */
@Injectable()
export class MailConfigService {
  private readonly logger = new Logger(MailConfigService.name);

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
   *   - có → encrypt envelope mới (recordId = id app-gen TRƯỚC encrypt → AAD bind); đổi đích được;
   *   - vắng + đã tồn tại + đích KHỚP → giữ envelope cũ (chỉ sửa from_name/from_email);
   *   - vắng + đích khác hàng, hoặc tạo MỚI → 400 `MAIL_PASSWORD_REQUIRED`.
   */
  async upsert(
    companyId: string,
    dto: UpsertMailConfigRequest,
    actorUserId: string,
  ): Promise<MailConfigDto> {
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
      // Vắng password = giữ mật khẩu đã lưu ⇒ hàng phải tồn tại VÀ đích không đổi. Chặn sớm ở đây (không mở
      // tx ghi, không audit); repo vẫn tự ép bằng vị từ đích trong câu UPDATE (thắng cả khi có đua).
      const existing = await this.repo.findByScope(companyId, scope);
      if (!existing) throw passwordRequired(PASSWORD_REQUIRED.newConfig);
      this.assertStoredDestination("put", { companyId, actorUserId, scope }, existing, fields);
    }

    try {
      const row = await this.repo.upsert(companyId, recordId, fields, envelope, {
        audit: this.audit,
        actorUserId,
      });
      return toDto(row);
    } catch (err: unknown) {
      if (!(err instanceof MailPasswordRequiredError)) throw err;
      // Vị từ đích của câu UPDATE ra 0 hàng sau khi phép so ở trên đã khớp ⇒ hàng vừa bị thay ở nơi khác (PUT kèm
      // mật khẩu chen giữa — đích có thể giữ nguyên) hoặc đích đã lệch. Không ghi gì; báo đúng cả hai khả năng.
      this.logger.warn(
        `PUT mail-config giữ mật khẩu cũ không ghi được — hàng vừa bị thay ở nơi khác hoặc đích không khớp (company=${companyId} actor=${actorUserId} scope=${scope})`,
      );
      throw passwordRequired(PASSWORD_REQUIRED.storedRowChanged);
    }
  }

  /**
   * POST test — kiểm tra kết nối SMTP. Body CÓ password → test đích trong body bằng password đó. Body VẮNG
   * password → dùng mật khẩu ĐÃ LƯU, nên chỉ cho test ĐÍCH CỦA HÀNG ĐÃ LƯU (I1); đích khác → 400 trước cả
   * khi giải mã. `errorMessage` là câu cố định theo loại lỗi (MailTransportService).
   */
  async testConnection(
    companyId: string,
    dto: TestMailConfigRequest,
    actorUserId: string,
  ): Promise<MailTestResult> {
    const scope = dto.scope ?? DEFAULT_SCOPE;
    const requested: MailDestination = {
      host: dto.host,
      port: dto.port,
      username: dto.username,
      secure: dto.secure ?? true,
    };

    if (dto.password !== undefined) {
      return this.transport.test({ ...requested, password: dto.password });
    }

    const existing = await this.repo.findByScope(companyId, scope);
    if (!existing) throw passwordRequired(PASSWORD_REQUIRED.noConfigToTest);
    this.assertStoredDestination("test", { companyId, actorUserId, scope }, existing, requested);

    let password: string;
    try {
      // Decrypt JIT — plaintext chỉ trong RAM lúc test; AAD bind theo cột PERSISTED (row.companyId/row.id).
      password = await this.secrets.decryptSecret(existing, {
        companyId: existing.companyId,
        recordId: existing.id,
        purpose: SMTP_SECRET_PURPOSE,
      });
    } catch {
      // KHÔNG lộ chi tiết crypto ra client/log; vẫn để dấu (tamper/corruption/mất KEK cần người xem).
      this.logger.warn(
        `Giải mã mật khẩu SMTP đã lưu thất bại khi kiểm tra kết nối (company=${companyId} config=${existing.id})`,
      );
      return { ok: false, errorMessage: "Không giải mã được mật khẩu đã lưu." };
    }

    // Đích lấy từ HÀNG, không từ body: bằng nhau theo phép so ở trên, nhưng đọc từ hàng thì một lỗi ở phép so
    // cũng không đưa được mật khẩu đã lưu tới nơi khác.
    return this.transport.test({ ...destinationOf(existing), password });
  }

  /**
   * Vắng password ⇒ đích yêu cầu phải KHỚP NGUYÊN hàng đã lưu. Lệch ⇒ log (actor + tên trường + đích yêu cầu
   * — để điều tra ai định gửi mật khẩu công ty đi đâu; host qua `logSafe`) rồi 400. Route test không ghi audit
   * nên dòng log này là dấu vết DUY NHẤT của một lần thử dẫn mật khẩu đi nơi khác (test ghim nội dung).
   */
  private assertStoredDestination(
    route: "put" | "test",
    ctx: { companyId: string; actorUserId: string; scope: string },
    stored: MailDestination,
    requested: MailDestination,
  ): void {
    const changed = changedDestinationFields(stored, requested);
    if (changed.length === 0) return;
    this.logger.warn(
      `Từ chối dùng mật khẩu SMTP đã lưu cho đích khác (route=${route} company=${ctx.companyId} actor=${ctx.actorUserId} scope=${ctx.scope} changed=${changed.join(",")} requestedHost=${logSafe(requested.host)} requestedPort=${requested.port})`,
    );
    throw passwordRequired(PASSWORD_REQUIRED.destinationChanged);
  }
}
