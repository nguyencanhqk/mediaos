/**
 * S14-SEC-CAPWILDCARD-1 — RATCHET vế `EXCLUDED` của `capabilities` (plan §4.2-(3), §9.2 #14; owner chốt
 * CW-1 23/10: luật theo TIỀN TỐ action `reveal-`, không theo danh sách cặp).
 *
 * Ratchet RỘNG hơn luật runtime để không thành tautology (plan D-v4-2): bắt token action bắt đầu `reveal`
 * (cả `reveal` trơn / `reveal_…`), nên một action reveal mới KHÔNG theo tiền tố `reveal-` làm ĐỎ — buộc
 * owner quyết. ĐỎ ở đây ⇒ owner quyết, CẤM tự nới luật runtime.
 *
 *   (a) token action = literal ĐẦU tuple trong `apps/api/migrations/*.sql` (regex đầu-tuple, KHÔNG
 *       `\breveal` — bắt chữ trong comment) ⇒ mọi token bị loại · số token PHÂN BIỆT ≥ 2;
 *   (b) catalog SỐNG ở lane — xem `test/integration/capabilities-company-tier.int-spec.ts`;
 *   (c) `REVEAL_CLASS_PAIRS.every(p => isCapabilityExcluded(p.action))` — mảng hôm nay RỖNG ⇒ vế này
 *       xanh-rỗng CÓ CHỦ ĐÍCH, KHÔNG tính vào sàn ≥ 2;
 *   (d) allowlist ∩ EXCLUDED = ∅ — đo hành vi: grant exact trên mọi cặp reveal của migration ⇒
 *       `getAllowlistedSensitiveCapabilities` không trả khoá nào bị loại (nếu trả, merge
 *       `{...allowlisted, ...caps}` ở /auth/me sẽ phục hồi khoá đã loại).
 *   (d') allowlist ∩ EXCLUDED = ∅ đo TRỰC TIẾP trên toàn bộ allowlist (gate CW-SEC-3/CW-G6) — không
 *       phụ thuộc regex migration của (a)/(d), không cần DB.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCapabilityExcluded } from "./capability-exclusion";
import { REVEAL_CLASS_PAIRS } from "./reveal-class-pairs";
import {
  __SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST,
  PermissionService,
} from "../../permission/permission.service";
import { CapabilityStubRepo, grant, pair } from "../../../test/helpers/capability-stub-repo";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "migrations");
/** Literal ĐẦU tuple: `('reveal…', 'resource'` — không khớp chữ `reveal` trong comment. */
const REVEAL_TUPLE_RE = /\(\s*'(reveal[^']*)'\s*,\s*'([^']+)'/g;

function revealTuplesInMigrations(): Array<{ action: string; resourceType: string; file: string }> {
  const out: Array<{ action: string; resourceType: string; file: string }> = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const m of sql.matchAll(REVEAL_TUPLE_RE)) {
      out.push({ action: m[1], resourceType: m[2], file });
    }
  }
  return out;
}

describe("S14-SEC-CAPWILDCARD-1 #14 — ratchet EXCLUDED (tiền tố action reveal-)", () => {
  it("(a) mọi token action reveal* đầu tuple trong migrations bị EXCLUDED; ≥ 2 token phân biệt", () => {
    const tuples = revealTuplesInMigrations();
    const tokens = [...new Set(tuples.map((t) => t.action))].sort();

    expect(tokens.length, `sàn chống xanh-rỗng; thấy: ${tokens.join(", ")}`).toBeGreaterThanOrEqual(
      2,
    );
    for (const t of tuples) {
      expect(isCapabilityExcluded(t.action), `${t.action}:${t.resourceType} (${t.file})`).toBe(
        true,
      );
    }
  });

  it("(a') đối chứng: action không tiền tố reveal- KHÔNG bị loại (luật không nuốt mọi thứ)", () => {
    for (const action of [
      "request-break-glass",
      "view",
      "view-own",
      "export",
      "revealed",
      "re-veal",
    ]) {
      expect(isCapabilityExcluded(action), action).toBe(action.startsWith("reveal-"));
    }
  });

  it("(c) REVEAL_CLASS_PAIRS ⊆ EXCLUDED (rỗng hôm nay — xanh-rỗng có chủ đích)", () => {
    expect(REVEAL_CLASS_PAIRS.every((p) => isCapabilityExcluded(p.action))).toBe(true);
  });

  it("(d) allowlist ∩ EXCLUDED = ∅ — grant exact mọi cặp reveal ⇒ allowlisted không trả khoá bị loại", async () => {
    const tuples = revealTuplesInMigrations();
    expect(tuples.length).toBeGreaterThanOrEqual(2);
    const repo = new CapabilityStubRepo()
      .withGrants(tuples.map((t) => grant(t.action, t.resourceType, { isSensitive: true })))
      .withCatalog(tuples.map((t) => pair(t.action, t.resourceType, true)));
    const allowlisted = await new PermissionService(repo).getAllowlistedSensitiveCapabilities(
      "11111111-1111-4111-8111-111111111111",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    const leaked = Object.keys(allowlisted).filter((k) => isCapabilityExcluded(k.split(":")[0]));
    expect(leaked).toEqual([]);
  });

  it("(d') allowlist ∩ EXCLUDED = ∅ — kiểm TRỰC TIẾP mọi khoá của SENSITIVE_CAPABILITY_ALLOWLIST", () => {
    const keys = [...__SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST];
    expect(keys.length, "sàn chống xanh-rỗng").toBeGreaterThan(0);
    expect(keys.filter((k) => isCapabilityExcluded(k.split(":")[0]))).toEqual([]);
  });
});
