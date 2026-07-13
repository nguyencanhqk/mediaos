/**
 * HR-PERF-1 (beBatchPermHr) — Integration (Postgres THẬT, DB CÔ LẬP LANE_DB) cho getObjectGrantsBatch +
 * PermissionService.canBatch trên ĐƯỜNG THẬT (RLS+FORCE + role mediaos_app qua DatabaseService.withTenant).
 *
 * Chứng minh BẤT BIẾN #1 (company_id mọi query) mà mock KHÔNG phủ được:
 *   (a) getObjectGrantsBatch chạy trong withTenant(companyId): actor tenant A xin batch trên [OBJ_1, OBJ_2]
 *       KHÔNG kéo object_permission của tenant B — kể cả khi B có grant trên CÙNG object_id (RLS + filter
 *       company_id). Mọi id được yêu cầu đều có entry (id ngoài scope → []).
 *   (b) batch == đọc từng-cái getObjectGrants (single) trên cùng lưới → cùng grant, không lệch.
 *   (c) canBatch end-to-end (real repo): object-DENY priority-1 THẮNG company-ALLOW; row không có object
 *       grant rơi về company-ALLOW exact-sensitive → allow — mirror can() từng-row, isolate theo tenant.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane. Colocated src/permission → vitest gom qua include `src/**\/*.spec.ts`.
 * Hand-built repo/service (KHÔNG boot Nest) — stateless singletons (mirror int-spec khác của module).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { DatabaseService } from "../db/db.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedObjectGrant,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";
import { PermissionRepository } from "./permission.repository";
import { PermissionService } from "./permission.service";
import type { CanInput } from "./permission.types";

const runDb = hasDb && Boolean(process.env.LANE_DB);

const RT = "employee";
const OBJ_1 = "aaaa1111-1111-1111-1111-111111111111";
const OBJ_2 = "bbbb2222-2222-2222-2222-222222222222";

describe.skipIf(!runDb)(
  "HR-PERF-1 getObjectGrantsBatch + canBatch (Postgres thật, LANE_DB)",
  () => {
    const direct: Pool = directPool();
    let A: SeededTenant;
    let B: SeededTenant;
    let db: DatabaseService;
    let repo: PermissionRepository;
    let svc: PermissionService;
    let actorA: string;
    let actorB: string;
    let roleA: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "hrperf-a");
      B = await seedCompany(direct, "hrperf-b");
      db = new DatabaseService();
      repo = new PermissionRepository(db);
      svc = new PermissionService(repo);

      actorA = await seedUser(direct, A.companyId, `actor-${A.slug}@t.local`);
      actorB = await seedUser(direct, B.companyId, `actor-${B.slug}@t.local`);

      // view-salary:employee is a SENSITIVE catalog pair → wildcard cannot satisfy; exact ALLOW does.
      const permId = await seedPermissionCatalog(direct, "view-salary", RT, true);
      // Company-level exact ALLOW for actorA (satisfies the sensitive gate for rows w/o an object grant).
      roleA = await seedRole(direct, A.companyId, "hrperf-role");
      await seedRolePermission(direct, roleA, permId, "ALLOW", "Company");
      await seedUserRole(direct, actorA, roleA, A.companyId);
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
    });

    // Reset the object-grant grid before each test (superuser, bypasses RLS).
    beforeEach(async () => {
      await direct.query("DELETE FROM object_permissions WHERE company_id = ANY($1)", [
        [A.companyId, B.companyId],
      ]);
    });

    it("(a) batch isolates by tenant: A's grant on OBJ_1 returns; B's grant on the SAME id does NOT leak", async () => {
      // A: user-subject ALLOW on OBJ_1.
      await seedObjectGrant(direct, A.companyId, actorA, RT, OBJ_1, "view-salary", "ALLOW");
      // B: user-subject grants on the SAME OBJ_1 (DENY) + on OBJ_2 (ALLOW) — must never surface for A.
      await seedObjectGrant(direct, B.companyId, actorB, RT, OBJ_1, "view-salary", "DENY");
      await seedObjectGrant(direct, B.companyId, actorB, RT, OBJ_2, "view-salary", "ALLOW");

      const batch = await repo.getObjectGrantsBatch(actorA, A.companyId, RT, [OBJ_1, OBJ_2]);

      // Every requested id has an entry.
      expect(batch.has(OBJ_1)).toBe(true);
      expect(batch.has(OBJ_2)).toBe(true);
      // OBJ_1: only A's ALLOW — B's DENY on the same id is invisible under tenant A.
      expect(batch.get(OBJ_1)!.some((g) => g.effect === "ALLOW")).toBe(true);
      expect(batch.get(OBJ_1)!.some((g) => g.effect === "DENY")).toBe(false);
      // OBJ_2: A has no grant → empty (B's grant does not leak).
      expect(batch.get(OBJ_2)).toEqual([]);
    });

    it("(b) batch == per-id single getObjectGrants over the same grid", async () => {
      await seedObjectGrant(direct, A.companyId, actorA, RT, OBJ_1, "view-salary", "ALLOW");

      const batch = await repo.getObjectGrantsBatch(actorA, A.companyId, RT, [OBJ_1, OBJ_2]);
      const single1 = await repo.getObjectGrants(actorA, A.companyId, RT, OBJ_1);
      const single2 = await repo.getObjectGrants(actorA, A.companyId, RT, OBJ_2);

      expect(batch.get(OBJ_1)).toEqual(single1);
      expect(batch.get(OBJ_2)).toEqual(single2);
    });

    it("(c) canBatch end-to-end: object-DENY (p1) beats company-ALLOW; no-object row → company-ALLOW allow", async () => {
      // OBJ_1: object-DENY view-salary in A → must deny despite the company-level exact ALLOW.
      await seedObjectGrant(direct, A.companyId, actorA, RT, OBJ_1, "view-salary", "DENY");
      // OBJ_2: no object grant → falls to company-level exact ALLOW (sensitive gate satisfied).
      // Cross-tenant noise: B grants ALLOW on OBJ_1 — must not rescue A's DENY.
      await seedObjectGrant(direct, B.companyId, actorB, RT, OBJ_1, "view-salary", "ALLOW");

      const decisions = await svc.canBatch(
        actorA,
        A.companyId,
        RT,
        [OBJ_1, OBJ_2],
        [{ action: "view-salary", isSensitive: true }],
      );

      const d1 = decisions.get(OBJ_1)!.get("view-salary")!;
      const d2 = decisions.get(OBJ_2)!.get("view-salary")!;
      expect(d1.allow).toBe(false);
      expect(d1.reason).toBe("deny-explicit");
      expect(d2.allow).toBe(true);
      expect(d2.reason).toBe("allow");
      expect(d2.auditRequired).toBe(true);

      // Parity: each cell equals a per-row can() over the same real repo.
      for (const id of [OBJ_1, OBJ_2]) {
        const input: CanInput = {
          userId: actorA,
          companyId: A.companyId,
          action: "view-salary",
          resourceType: RT,
          resourceId: id,
          isSensitive: true,
        };
        const single = await svc.can(input);
        expect(decisions.get(id)!.get("view-salary")).toEqual(single);
      }
    });
  },
);
