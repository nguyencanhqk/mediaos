import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { DB_BROWSER_ALLOWLIST } from "@mediaos/contracts";
import {
  assertColumnsAllowed,
  assertTableAllowed,
  isAllowedColumn,
  isAllowedTable,
} from "./db-ops-allowlist";

/**
 * AC-9 allowlist default-DENY (NO-DB pure unit). BẤT BIẾN #3: secret/PII KHÔNG bao giờ vào allowlist.
 */
describe("AC-9 db-ops allowlist (default-deny + secret/PII exclusion)", () => {
  it("assertTableAllowed: bảng allowlist OK", () => {
    expect(assertTableAllowed("users")).toBe("users");
    expect(assertTableAllowed("tasks")).toBe("tasks");
  });

  it("assertTableAllowed: bảng ngoài allowlist → 400 (KHÔNG passthrough)", () => {
    expect(() => assertTableAllowed("payslips")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("salary_profiles")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("platform_accounts")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("encryption_keys")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("api_keys")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("user_totp")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("webhook_endpoints")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("break_glass_grants")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("db_ops_grants")).toThrow(BadRequestException);
    expect(() => assertTableAllowed("definitely_not_a_table")).toThrow(BadRequestException);
  });

  it("assertColumnsAllowed: cột allowlist OK + dedup", () => {
    expect(assertColumnsAllowed("users", ["id", "email"])).toEqual(["id", "email"]);
    expect(assertColumnsAllowed("users", ["id", "id"])).toEqual(["id"]);
  });

  it("assertColumnsAllowed: cột vắng = default projection (toàn bộ cột allowlist)", () => {
    expect(assertColumnsAllowed("users")).toEqual([...DB_BROWSER_ALLOWLIST.users]);
  });

  it("assertColumnsAllowed: cột ngoài allowlist của bảng hợp lệ → 400 (default-deny)", () => {
    expect(() => assertColumnsAllowed("users", ["password_hash"])).toThrow(BadRequestException);
    expect(() => assertColumnsAllowed("users", ["id", "rogue_col"])).toThrow(BadRequestException);
  });

  it("LOẠI TRỪ verbatim: secret/PII KHÔNG nằm trong bất kỳ allowlist nào", () => {
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
        expect(
          (cols as readonly string[]).includes(f),
          `${table}.${f} bị cấm trong allowlist`,
        ).toBe(false);
        const t = table as keyof typeof DB_BROWSER_ALLOWLIST;
        expect(isAllowedColumn(t, f), `isAllowedColumn(${table}, ${f}) phải false`).toBe(false);
      }
    }
  });

  it("LOẠI TRỪ verbatim: bảng nhạy cảm KHÔNG nằm trong allowlist", () => {
    const FORBIDDEN_TABLES = [
      "platform_accounts",
      "payslips",
      "payslip_items",
      "salary_profiles",
      "user_totp",
      "user_recovery_codes",
      "webhook_endpoints",
      "encryption_keys",
      "api_keys",
      "break_glass_grants",
      "break_glass_approvals",
      "db_ops_grants",
      "db_export_jobs",
    ];
    for (const t of FORBIDDEN_TABLES) {
      expect(isAllowedTable(t), `${t} phải bị loại khỏi allowlist`).toBe(false);
    }
  });
});
