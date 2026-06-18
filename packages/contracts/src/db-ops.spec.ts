import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DB_BROWSER_ALLOWLIST,
  DB_BROWSER_DEFAULT_ROWS,
  DB_BROWSER_MAX_ROWS,
  DB_OPS_MIN_APPROVALS,
  dbBrowserQuerySchema,
  dbExportJobDtoSchema,
  dbOpsGrantDtoSchema,
  dbOpsGrantRequestSchema,
  isAllowedColumn,
  isAllowedTable,
  migrationStatusDtoSchema,
} from "./index";

/**
 * AC-9 db-ops contract round-trip — pin allowlist default-DENY + clamp + DTO parse.
 *
 * BẤT BIẾN #3: liệt kê verbatim cột secret/PII PHẢI KHÔNG nằm trong allowlist (sai = đỏ ngay, không cần DB).
 */
describe("AC-9 db-ops contracts", () => {
  describe("dbBrowserQuerySchema", () => {
    it("reject unknown table (default-deny enum)", () => {
      const r = dbBrowserQuerySchema.safeParse({
        targetCompanyId: randomUUID(),
        table: "encryption_keys",
      });
      expect(r.success).toBe(false);
    });

    it("accept allowlist table + clamp limit default", () => {
      const r = dbBrowserQuerySchema.safeParse({
        targetCompanyId: randomUUID(),
        table: "users",
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.limit).toBe(DB_BROWSER_DEFAULT_ROWS);
        expect(r.data.offset).toBe(0);
      }
    });

    it("reject limit > MAX (row-cap)", () => {
      const r = dbBrowserQuerySchema.safeParse({
        targetCompanyId: randomUUID(),
        table: "users",
        limit: DB_BROWSER_MAX_ROWS + 1,
      });
      expect(r.success).toBe(false);
    });

    it("reject limit < 1", () => {
      const r = dbBrowserQuerySchema.safeParse({
        targetCompanyId: randomUUID(),
        table: "users",
        limit: 0,
      });
      expect(r.success).toBe(false);
    });

    it("reject unknown extra key (strict)", () => {
      const r = dbBrowserQuerySchema.safeParse({
        targetCompanyId: randomUUID(),
        table: "users",
        rogue: "x",
      });
      expect(r.success).toBe(false);
    });

    it("reject non-uuid targetCompanyId", () => {
      const r = dbBrowserQuerySchema.safeParse({ targetCompanyId: "not-a-uuid", table: "users" });
      expect(r.success).toBe(false);
    });
  });

  describe("allowlist default-DENY + secret/PII exclusion (BẤT BIẾN #3)", () => {
    it("known table/column allowed", () => {
      expect(isAllowedTable("users")).toBe(true);
      expect(isAllowedColumn("users", "email")).toBe(true);
    });

    it("unknown table denied", () => {
      expect(isAllowedTable("payslips")).toBe(false);
      expect(isAllowedTable("salary_profiles")).toBe(false);
      expect(isAllowedTable("platform_accounts")).toBe(false);
      expect(isAllowedTable("encryption_keys")).toBe(false);
      expect(isAllowedTable("api_keys")).toBe(false);
      expect(isAllowedTable("break_glass_grants")).toBe(false);
      expect(isAllowedTable("user_totp")).toBe(false);
      expect(isAllowedTable("webhook_endpoints")).toBe(false);
      expect(isAllowedTable("db_ops_grants")).toBe(false);
    });

    it("LOẠI TRỪ verbatim: NO secret/PII column anywhere in allowlist", () => {
      const FORBIDDEN = [
        "secret_ciphertext",
        "token_hash",
        "password_hash",
        "reason",
        "dek_wrapped",
        "envelope",
        "totp_secret",
        "recovery_code",
        "net_amount",
        "gross_amount",
        "base_salary",
      ];
      for (const [table, cols] of Object.entries(DB_BROWSER_ALLOWLIST)) {
        for (const f of FORBIDDEN) {
          expect((cols as readonly string[]).includes(f), `${table}.${f} bị cấm`).toBe(false);
        }
      }
    });

    it("column outside a valid table's allowlist denied", () => {
      expect(isAllowedColumn("users", "password_hash")).toBe(false);
      expect(isAllowedColumn("users", "anything_else")).toBe(false);
    });
  });

  describe("DTO parse", () => {
    it("dbOpsGrantDto round-trip", () => {
      const dto = {
        id: randomUUID(),
        requesterUserId: randomUUID(),
        targetTenantId: randomUUID(),
        reason: "incident #42",
        requiredApprovals: DB_OPS_MIN_APPROVALS,
        approvalCount: 0,
        status: "pending" as const,
        expiresAt: new Date().toISOString(),
        activatedAt: null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
      };
      expect(dbOpsGrantDtoSchema.parse(dto)).toMatchObject({ status: "pending" });
    });

    it("dbOpsGrantRequest reject ttl below min", () => {
      const r = dbOpsGrantRequestSchema.safeParse({ reason: "x", ttlSeconds: 1 });
      expect(r.success).toBe(false);
    });

    it("dbExportJobDto round-trip", () => {
      const dto = {
        id: randomUUID(),
        requesterUserId: randomUUID(),
        targetTenantId: randomUUID(),
        tableName: "tasks",
        filter: null,
        status: "queued" as const,
        rowCount: null,
        error: null,
        downloadUrl: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      expect(dbExportJobDtoSchema.parse(dto)).toMatchObject({ status: "queued" });
    });

    it("migrationStatusDto round-trip", () => {
      const dto = {
        entries: [
          { idx: 0, tag: "0000_init", when: 1, applied: true, appliedAt: new Date().toISOString() },
          { idx: 103, tag: "0345_ac9_db_ops", when: 1717500380000, applied: false, appliedAt: null },
        ],
        appliedCount: 1,
        pendingCount: 1,
      };
      expect(migrationStatusDtoSchema.parse(dto).entries).toHaveLength(2);
    });
  });
});
