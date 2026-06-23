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

  // ── S1-FND-AUDIT-1 L1 (write-shape): 11 cột §8.5 mới (mig 0438) + enum guard fail-closed ──
  describe("record() — 11 cột §8.5 mới (mig 0438)", () => {
    it("điền ĐỦ 11 cột §8.5 khi caller cung cấp", async () => {
      const { tx, rows } = captureTx();
      await svc.record(tx, {
        action: "X",
        objectType: "user",
        actorEmployeeId: "11111111-1111-1111-1111-111111111111",
        actionGroup: "auth",
        entityIdText: "EMP-001",
        entityCode: "EMP-001",
        permissionCode: "HR.EMPLOYEE.VIEW",
        dataScope: "Company",
        deviceInfo: { browser: "chrome", os: "win" },
        diffSummary: "name changed",
        errorCode: "AUTH-ERR-001",
        errorMessage: "denied",
        metadata: { reason: "test" },
      } as AuditEntry);
      const r = rows[0] as Record<string, unknown>;
      expect(r["actorEmployeeId"]).toBe("11111111-1111-1111-1111-111111111111");
      expect(r["actionGroup"]).toBe("auth");
      expect(r["entityIdText"]).toBe("EMP-001");
      expect(r["entityCode"]).toBe("EMP-001");
      expect(r["permissionCode"]).toBe("HR.EMPLOYEE.VIEW");
      expect(r["dataScope"]).toBe("Company");
      expect(r["deviceInfo"]).toEqual({ browser: "chrome", os: "win" });
      expect(r["diffSummary"]).toBe("name changed");
      expect(r["errorCode"]).toBe("AUTH-ERR-001");
      expect(r["errorMessage"]).toBe("denied");
      expect(r["metadata"]).toEqual({ reason: "test" });
    });

    it("caller chỉ-v1 → mọi cột §8.5 mới = null (writer cũ KHÔNG vỡ)", async () => {
      const { tx, rows } = captureTx();
      await svc.record(tx, { action: "X", objectType: "user" } as AuditEntry);
      const r = rows[0] as Record<string, unknown>;
      for (const col of [
        "actorEmployeeId",
        "actionGroup",
        "entityIdText",
        "entityCode",
        "permissionCode",
        "dataScope",
        "deviceInfo",
        "diffSummary",
        "errorCode",
        "errorMessage",
        "metadata",
      ]) {
        expect(r[col]).toBeNull();
      }
    });

    it("MASK device_info/metadata (BẤT BIẾN #3 mask-at-write)", async () => {
      const { tx, rows } = captureTx();
      await svc.record(tx, {
        action: "X",
        objectType: "user",
        deviceInfo: { token: "abc", browser: "chrome" },
        metadata: { password: "p", note: "ok" },
      } as AuditEntry);
      const r = rows[0] as {
        deviceInfo: Record<string, unknown>;
        metadata: Record<string, unknown>;
      };
      expect(r.deviceInfo["token"]).toBe("***");
      expect(r.deviceInfo["browser"]).toBe("chrome");
      expect(r.metadata["password"]).toBe("***");
      expect(r.metadata["note"]).toBe("ok");
    });
  });

  describe("enum guard fail-closed (TRƯỚC insert, tránh vỡ CHECK Postgres)", () => {
    it.each(["Own", "Team", "Department", "Company", "System"])(
      "data_scope hợp lệ '%s' → ghi nguyên",
      async (scope) => {
        const { tx, rows } = captureTx();
        await svc.record(tx, { action: "X", objectType: "user", dataScope: scope } as AuditEntry);
        expect((rows[0] as Record<string, unknown>)["dataScope"]).toBe(scope);
      },
    );

    it("data_scope ngoài enum → throw TRƯỚC insert (fail-closed)", async () => {
      const { tx, rows } = captureTx();
      await expect(
        svc.record(tx, { action: "X", objectType: "user", dataScope: "Galaxy" } as AuditEntry),
      ).rejects.toThrow(/data_scope/i);
      expect(rows).toHaveLength(0);
    });

    it("actor_type ngoài enum → throw TRƯỚC insert", async () => {
      const { tx, rows } = captureTx();
      await expect(
        svc.record(tx, { action: "X", objectType: "user", actorType: "Robot" } as AuditEntry),
      ).rejects.toThrow(/actor_type/i);
      expect(rows).toHaveLength(0);
    });

    it("sensitivity_level ngoài enum → throw TRƯỚC insert", async () => {
      const { tx, rows } = captureTx();
      await expect(
        svc.record(tx, {
          action: "X",
          objectType: "user",
          sensitivityLevel: "TopSecret",
        } as AuditEntry),
      ).rejects.toThrow(/sensitivity_level/i);
      expect(rows).toHaveLength(0);
    });

    it("result_status ngoài enum → throw TRƯỚC insert", async () => {
      const { tx, rows } = captureTx();
      await expect(
        svc.record(tx, {
          action: "X",
          objectType: "user",
          resultStatus: "Maybe",
        } as AuditEntry),
      ).rejects.toThrow(/result_status/i);
      expect(rows).toHaveLength(0);
    });

    it.each(["User", "System", "Job", "Integration"])(
      "actor_type hợp lệ '%s' → ghi nguyên",
      async (actorType) => {
        const { tx, rows } = captureTx();
        await svc.record(tx, { action: "X", objectType: "user", actorType } as AuditEntry);
        expect((rows[0] as Record<string, unknown>)["actorType"]).toBe(actorType);
      },
    );
  });
});
