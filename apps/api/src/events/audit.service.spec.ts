import { describe, expect, it } from "vitest";
import type { TenantTx } from "../db/db.service";
import { AuditService, type AuditEntry } from "./audit.service";

/**
 * RED #2 (BE-3) — AuditService v2 (BẤT BIẾN #2 append-only ghi-trong-tx · #3 không secret):
 *   - computeChangedFields(old,new) → mảng TÊN field đổi (KHÔNG value).
 *   - record() MASK before/after/oldValues/newValues TRƯỚC insert (mask-at-write).
 *   - ghi cặp v1 (objectType/before/after) + v2 (entityType/oldValues/newValues) đồng thời (additive).
 *   - changed_fields chỉ tính khi caller cung cấp cặp v2; tính TỪ giá trị ĐÃ MASK ⇒ không lộ secret.
 *
 * Unit test KHÔNG cần DB: bắt đối số `.values()` qua fake TenantTx (capture-insert).
 */
function captureTx(): { tx: TenantTx; rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        rows.push(v);
      },
    }),
  } as unknown as TenantTx;
  return { tx, rows };
}

describe("AuditService v2 (BE-3)", () => {
  const svc = new AuditService();

  describe("computeChangedFields", () => {
    it("trả TÊN field đổi (union 2 vế), KHÔNG value", () => {
      const changed = svc.computeChangedFields({ a: 1, b: 2, c: 3 }, { a: 1, b: 99, d: 4 });
      expect([...changed].sort()).toEqual(["b", "c", "d"]);
    });

    it("không đổi → mảng rỗng", () => {
      expect(svc.computeChangedFields({ a: 1 }, { a: 1 })).toEqual([]);
    });

    it("bắt thay đổi object lồng nhau", () => {
      expect(svc.computeChangedFields({ a: { x: 1 } }, { a: { x: 2 } })).toEqual(["a"]);
    });

    it("non-object (null) → rỗng (an toàn)", () => {
      expect(svc.computeChangedFields(null, null)).toEqual([]);
    });
  });

  describe("record() mask + v1/v2", () => {
    it("MASK before/after (v1) TRƯỚC insert; giữ field thường", async () => {
      const { tx, rows } = captureTx();
      await svc.record(tx, {
        action: "X",
        objectType: "user",
        before: { password: "PLACEHOLDER", email: "a@b.c" },
        after: { token: "PLACEHOLDER", email: "a@b.d" },
      } as AuditEntry);
      const r = rows[0] as { before: Record<string, unknown>; after: Record<string, unknown> };
      expect(r.before["password"]).toBe("***");
      expect(r.before["email"]).toBe("a@b.c");
      expect(r.after["token"]).toBe("***");
      expect(r.after["email"]).toBe("a@b.d");
    });

    it("MASK oldValues/newValues (v2); changedFields chỉ TÊN field (secret mask 2 vế ⇒ không tính là đổi)", async () => {
      const { tx, rows } = captureTx();
      await svc.record(tx, {
        action: "X",
        objectType: "user",
        entityType: "user",
        oldValues: { token: "OLD", name: "a" },
        newValues: { token: "NEW", name: "b" },
      } as AuditEntry);
      const r = rows[0] as {
        oldValues: Record<string, unknown>;
        newValues: Record<string, unknown>;
        changedFields: string[];
      };
      expect(r.oldValues["token"]).toBe("***");
      expect(r.newValues["token"]).toBe("***");
      expect(r.changedFields).toEqual(["name"]);
    });

    it("caller chỉ-v1 → cột v2 = null, changedFields = null (writer cũ KHÔNG vỡ)", async () => {
      const { tx, rows } = captureTx();
      await svc.record(tx, {
        action: "X",
        objectType: "user",
        before: { a: 1 },
      } as AuditEntry);
      const r = rows[0] as Record<string, unknown>;
      expect(r["oldValues"]).toBeNull();
      expect(r["newValues"]).toBeNull();
      expect(r["changedFields"]).toBeNull();
    });
  });
});
