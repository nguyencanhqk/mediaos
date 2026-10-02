import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { EncryptedColumns } from "../crypto/secret-encryption.types";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { companyMailConfigs, type CompanyMailConfig } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { assertPersistedAsBound, MailPasswordRequiredError } from "./mail-destination";

/** Non-secret config fields persisted on a mail config (mirror DTO — KHÔNG password/envelope). */
export interface MailConfigFields {
  scope: string;
  host: string;
  port: number;
  username: string;
  secure: boolean;
  fromName: string | null;
  fromEmail: string;
}

export interface MailConfigAuditMeta {
  audit: AuditService;
  actorUserId: string;
}

/** Snapshot an toàn cho audit before/after — KHÔNG cột envelope/secret (BẤT BIẾN #2). */
function auditSnapshot(row: CompanyMailConfig | undefined) {
  if (!row) return null;
  return {
    scope: row.scope,
    host: row.host,
    port: row.port,
    username: row.username,
    secure: row.secure,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    hasPassword: true, // envelope cột NOT NULL → có row = có password
  };
}

@Injectable()
export class MailConfigRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Liệt kê mọi config (mọi scope) của công ty. RLS chặn cross-tenant (FORCE). */
  listConfigs(companyId: string): Promise<CompanyMailConfig[]> {
    return this.db.withTenant(companyId, (tx) =>
      tx.select().from(companyMailConfigs).where(eq(companyMailConfigs.companyId, companyId)),
    );
  }

  /** Đọc 1 config theo scope (trong tx — dùng cho test-connection decrypt). */
  findByScopeTx(
    tx: TenantTx,
    companyId: string,
    scope: string,
  ): Promise<CompanyMailConfig | undefined> {
    return tx
      .select()
      .from(companyMailConfigs)
      .where(and(eq(companyMailConfigs.companyId, companyId), eq(companyMailConfigs.scope, scope)))
      .limit(1)
      .then((rows) => rows[0]);
  }

  /** Đọc 1 config theo scope (withTenant — dùng cho service test-connection). */
  findByScope(companyId: string, scope: string): Promise<CompanyMailConfig | undefined> {
    return this.db.withTenant(companyId, (tx) => this.findByScopeTx(tx, companyId, scope));
  }

  /**
   * Upsert theo (company, scope), audit-in-tx (BẤT BIẾN #3):
   *   - row CHƯA tồn tại  → INSERT (envelope BẮT BUỘC).
   *   - row tồn tại + envelope mới → DELETE + INSERT cả hàng (id mới = recordId mới đã bind AAD ở caller;
   *     cột envelope frozen, không UPDATE được → re-INSERT là đường đổi password ĐÚNG và là đường DUY NHẤT
   *     đổi đích host/port/username/secure).
   *   - row tồn tại + KHÔNG envelope (vắng password) → UPDATE CHỈ from_name/from_email, GIỮ envelope cũ, và
   *     chỉ khi đích trong `fields` KHỚP hàng (vị từ trong WHERE). 0 hàng ⇒ `MailPasswordRequiredError`.
   *
   * S19-SEC-MAILCREDEXFIL-1 (I2): nhánh giữ-envelope về CẤU TRÚC không ghi được cột đích ⇒ đích của một hàng
   * BẤT BIẾN suốt đời hàng (chỉ DELETE+INSERT với id + envelope mới mới đổi được) — vì thế không đan xen nào gắn
   * envelope với đích khác. Vị từ đích trong WHERE biến yêu cầu "đổi đích mà giữ mật khẩu" thành LỖI thay vì 200
   * im lặng bỏ qua đích mới; đua với DELETE+INSERT đang dở ⇒ UPDATE chờ khoá, hàng cũ đã bị xoá nên bị bỏ qua
   * (hàng mới ngoài snapshot câu lệnh) ⇒ 0 hàng ⇒ lỗi. DB: `mediaos_app` hết quyền UPDATE cột đích (mig 0591 —
   * chỉ chặn đường UPDATE). Thua đua ⇒ 400 "cần mật khẩu / tải lại" dù không đổi đích — chấp nhận (fail-closed).
   *
   * S19-SEC-MAILAADBIND-1: id + đích nằm trong ngữ cảnh mã hoá của envelope (B1 — `smtpSecretContext`) ⇒ một
   * đường DELETE+INSERT tái dùng id + chép envelope sang đích khác (0591 không chặn INSERT/DELETE) chỉ cho ra
   * hàng KHÔNG giải mã được — fail-closed, không rò. CẢ HAI nhánh INSERT so `RETURNING` với bộ đã gắn —
   * companyId + id + 4 trường đích (B4 — `assertPersistedAsBound`, mail-destination.ts): lệch ⇒ ném trong tx ⇒
   * rollback (host/username ⇒ lỗi miền 400; còn lại ⇒ lỗi lập trình/hệ thống 500).
   *
   * `recordId` = id của hàng sẽ ghi (app-gen TRƯỚC encrypt ở caller → gắn vào ngữ cảnh). KHÔNG ghi secret vào
   * audit.
   */
  async upsert(
    companyId: string,
    recordId: string,
    fields: MailConfigFields,
    envelope: EncryptedColumns | null,
    auditMeta: MailConfigAuditMeta,
  ): Promise<CompanyMailConfig> {
    return this.db.withTenant(companyId, async (tx) => {
      const existing = await this.findByScopeTx(tx, companyId, fields.scope);

      // Tạo mới mà KHÔNG có envelope = không thể (cột NOT NULL). Caller đã chặn; phòng thủ thêm ở đây.
      if (!existing && !envelope) {
        throw new Error("Mail config mới yêu cầu password (envelope) — không có để INSERT.");
      }

      let afterRow: CompanyMailConfig;
      if (!existing) {
        // INSERT mới.
        const [row] = await tx
          .insert(companyMailConfigs)
          .values({
            id: recordId,
            companyId,
            scope: fields.scope,
            host: fields.host,
            port: fields.port,
            username: fields.username,
            secure: fields.secure,
            fromName: fields.fromName,
            fromEmail: fields.fromEmail,
            secretCiphertext: envelope!.secretCiphertext,
            encryptedDek: envelope!.encryptedDek,
            dekKeyVersion: envelope!.dekKeyVersion,
            kmsKeyId: envelope!.kmsKeyId,
            ivNonce: envelope!.ivNonce,
            authTag: envelope!.authTag,
            encAlgo: envelope!.encAlgo,
          })
          .returning();
        assertPersistedAsBound(row, { companyId, recordId }, fields);
        afterRow = row;
      } else if (envelope) {
        // Đổi password: DELETE + INSERT cả hàng (envelope frozen, id mới = recordId đã bind AAD).
        await tx
          .delete(companyMailConfigs)
          .where(
            and(
              eq(companyMailConfigs.companyId, companyId),
              eq(companyMailConfigs.scope, fields.scope),
            ),
          );
        const [row] = await tx
          .insert(companyMailConfigs)
          .values({
            id: recordId,
            companyId,
            scope: fields.scope,
            host: fields.host,
            port: fields.port,
            username: fields.username,
            secure: fields.secure,
            fromName: fields.fromName,
            fromEmail: fields.fromEmail,
            secretCiphertext: envelope.secretCiphertext,
            encryptedDek: envelope.encryptedDek,
            dekKeyVersion: envelope.dekKeyVersion,
            kmsKeyId: envelope.kmsKeyId,
            ivNonce: envelope.ivNonce,
            authTag: envelope.authTag,
            encAlgo: envelope.encAlgo,
          })
          .returning();
        assertPersistedAsBound(row, { companyId, recordId }, fields);
        afterRow = row;
      } else {
        // Giữ password cũ: UPDATE CHỈ from_name/from_email — KHÔNG cột đích (I2). Đích phải khớp hàng.
        const [row] = await tx
          .update(companyMailConfigs)
          .set({
            fromName: fields.fromName,
            fromEmail: fields.fromEmail,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(companyMailConfigs.companyId, companyId),
              eq(companyMailConfigs.scope, fields.scope),
              eq(companyMailConfigs.host, fields.host),
              eq(companyMailConfigs.port, fields.port),
              eq(companyMailConfigs.username, fields.username),
              eq(companyMailConfigs.secure, fields.secure),
            ),
          )
          .returning();
        if (!row) throw new MailPasswordRequiredError();
        afterRow = row;
      }

      await auditMeta.audit.record(tx, {
        action: existing ? "MailConfigUpdated" : "MailConfigCreated",
        objectType: "mail_config",
        objectId: afterRow.id,
        actorUserId: auditMeta.actorUserId,
        before: auditSnapshot(existing),
        after: auditSnapshot(afterRow),
      });

      return afterRow;
    });
  }
}
