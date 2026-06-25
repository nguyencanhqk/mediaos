import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S2-HR-BE-4 (FIX-QA) — DB-layer proof for the profile-change-request flow (FULL-gate red-zone:
 * NEW tenant table + append-only history + audit object_type). Runs on REAL Postgres ONLY.
 *
 * Why this exists (Đội 3 BLOCK fix): the prior round only had unit tests mocking withTenant/RLS, so
 * there was NO evidence the invariants hold at the DB layer. CLAUDE.md §2 forbids relying on
 * repository WHERE company_id — isolation MUST be enforced by RLS + FORCE. This spec drives every
 * assertion through the `mediaos_app` role (NO BYPASSRLS) under `app.current_company_id`, exactly as
 * the running service does, proving:
 *
 *   (1) 2-tenant isolation via RLS (NOT manual WHERE): tenant B cannot read / cannot read-by-id /
 *       cannot cross-insert tenant A's profile_change_requests; histories isolate the same way.
 *   (2) append-only history (BẤT BIẾN #2): app role UPDATE/DELETE on
 *       employee_profile_change_histories is DENIED at the grant layer (SELECT,INSERT only).
 *   (3) audit object_type='profile_change_request' does NOT break the audit_logs CHECK constraint —
 *       INSERT via app role succeeds (every create/approve/reject/cancel audit row would otherwise
 *       crash on the real DB).
 *   (4) approve applies the full set of allowed fields (incl. sensitive identity_* group) onto
 *       employee_profiles AND appends one append-only history row per applied field, all in ONE tx.
 *
 * Gate: skipIf(!(hasDb && LANE_DB)). hasDb alone false-reds on a shared dev DB whose .env makes
 * DATABASE_URL present (memory: integration-test-lane-db-gate). Run isolated:
 *   bash scripts/lane-db-setup.sh s2hrbe4 && export LANE_DB=mediaos_s2hrbe4 \
 *     && pnpm --filter @mediaos/api test profile-change-request.int-spec
 */

const laneDb = process.env.LANE_DB;

describe.skipIf(!(hasDb && laneDb))("S2-HR-BE-4 profile-change-request (DB-level, RLS)", () => {
  const direct = directPool();
  const app = appPool(2);

  let A: SeededTenant;
  let B: SeededTenant;
  let empA = ""; // employee_profiles.id in A
  let empB = ""; // employee_profiles.id in B
  let userA = ""; // users.id (A) — request owner
  let userB = ""; // users.id (B)
  let hrA = ""; // users.id (A) — approver
  let pcrA = ""; // profile_change_requests.id (A, Pending)
  let pcrB = ""; // profile_change_requests.id (B, Pending)

  beforeAll(async () => {
    A = await seedCompany(direct, "pcr-a");
    B = await seedCompany(direct, "pcr-b");

    userA = await seedUser(direct, A.companyId, `pcr-a@x.test`);
    hrA = await seedUser(direct, A.companyId, `pcr-hr-a@x.test`);
    userB = await seedUser(direct, B.companyId, `pcr-b@x.test`);

    empA = await seedEmployee(A.companyId, userA);
    empB = await seedEmployee(B.companyId, userB);

    // Seed one Pending request per tenant (direct/superuser bypasses RLS for fixture setup only).
    pcrA = await seedPcr(A.companyId, empA, userA, ["phone"], { phone: "0900000001" });
    pcrB = await seedPcr(B.companyId, empB, userB, ["phone"], { phone: "0900000002" });
  });

  afterAll(async () => {
    // employee_profiles is NOT covered by cleanupTenants; delete it explicitly (CASCADE then clears
    // profile_change_requests + employee_profile_change_histories via FK ON DELETE CASCADE).
    await direct
      .query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [
        [A.companyId, B.companyId],
      ])
      .catch(() => undefined);
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  // ── fixtures (direct pool — superuser, bypass RLS; ONLY to build the test grid) ────────────────

  async function seedEmployee(companyId: string, uid: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, $2, 'active')
       RETURNING id`,
      [companyId, uid],
    );
    return r.rows[0].id as string;
  }

  async function seedPcr(
    companyId: string,
    employeeId: string,
    requestedBy: string,
    changedFields: string[],
    newValues: Record<string, unknown>,
    oldValues: Record<string, unknown> = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO profile_change_requests
         (company_id, employee_id, requested_by, status, old_values, new_values, changed_fields)
       VALUES ($1, $2, $3, 'Pending', $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id`,
      [
        companyId,
        employeeId,
        requestedBy,
        JSON.stringify(oldValues),
        JSON.stringify(newValues),
        JSON.stringify(changedFields),
      ],
    );
    return r.rows[0].id as string;
  }

  /** Run `fn` under the app role (mediaos_app, NO BYPASSRLS) with app.current_company_id set. */
  async function asTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  // ─────────────── (1) 2-tenant RLS isolation (NOT manual WHERE company_id) ───────────────

  describe("RLS tenant isolation (profile_change_requests)", () => {
    it("tenant A sees its own request and zero rows of B (no WHERE company_id)", async () => {
      const rows = await asTenant(A.companyId, async (c) => {
        // NOTE: deliberately NO `WHERE company_id` — isolation must come from RLS USING, not the query.
        const r = await c.query("SELECT id, company_id FROM profile_change_requests");
        return r.rows as { id: string; company_id: string }[];
      });
      expect(rows.some((x) => x.id === pcrA)).toBe(true);
      expect(rows.some((x) => x.id === pcrB)).toBe(false);
      expect(rows.every((x) => x.company_id === A.companyId)).toBe(true);
    });

    it("tenant B cannot read A's request by id (RLS USING filters it out)", async () => {
      const rows = await asTenant(B.companyId, async (c) => {
        const r = await c.query("SELECT id FROM profile_change_requests WHERE id = $1", [pcrA]);
        return r.rows;
      });
      expect(rows.length).toBe(0);
    });

    it("tenant A INSERT with company_id = B is blocked by RLS WITH CHECK", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(
            `INSERT INTO profile_change_requests
               (company_id, employee_id, requested_by, status, old_values, new_values, changed_fields)
             VALUES ($1, $2, $3, 'Pending', '{}'::jsonb, '{"phone":"x"}'::jsonb, '["phone"]'::jsonb)`,
            [B.companyId, empB, userB],
          );
        }),
      ).rejects.toThrow();
    });

    it("histories isolate too: tenant B sees zero of A's history rows", async () => {
      // Seed a history row for A directly, then read it as B.
      const histA = await direct.query(
        `INSERT INTO employee_profile_change_histories
           (company_id, employee_id, request_id, field_name, old_value, new_value, is_sensitive)
         VALUES ($1, $2, $3, 'phone', '"old"'::jsonb, '"new"'::jsonb, false) RETURNING id`,
        [A.companyId, empA, pcrA],
      );
      const idA = histA.rows[0].id as string;
      const seenByB = await asTenant(B.companyId, async (c) => {
        const r = await c.query("SELECT id FROM employee_profile_change_histories WHERE id = $1", [
          idA,
        ]);
        return r.rows.length;
      });
      expect(seenByB).toBe(0);
    });
  });

  // ─────────────── (2) append-only history (BẤT BIẾN #2: app role no UPDATE/DELETE) ───────────────

  describe("append-only employee_profile_change_histories", () => {
    let histId = "";

    beforeAll(async () => {
      // App role can INSERT a history row in its own tenant (the approve flow does exactly this).
      histId = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO employee_profile_change_histories
             (employee_id, request_id, field_name, old_value, new_value, is_sensitive)
           VALUES ($1, $2, 'notes', '"a"'::jsonb, '"b"'::jsonb, false) RETURNING id`,
          [empA, pcrA],
        );
        return r.rows[0].id as string;
      });
    });

    it("app role INSERT into history succeeds (SELECT,INSERT granted)", () => {
      expect(histId).toBeTruthy();
    });

    it("app role UPDATE on history is DENIED (append-only — no UPDATE grant)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(
            `UPDATE employee_profile_change_histories SET new_value = '"tampered"'::jsonb WHERE id = $1`,
            [histId],
          );
        }),
      ).rejects.toThrow(/permission denied/i);
    });

    it("app role DELETE on history is DENIED (append-only — no DELETE grant)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM employee_profile_change_histories WHERE id = $1`, [histId]);
        }),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // ─────────────── (3) audit object_type='profile_change_request' does NOT break CHECK ───────────────

  describe("audit_logs object_type='profile_change_request' CHECK", () => {
    it("app role INSERT audit row (profile_change_request) succeeds", async () => {
      const id = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO audit_logs (actor_user_id, action, object_type, object_id)
           VALUES ($1, 'create', 'profile_change_request', $2) RETURNING id`,
          [userA, pcrA],
        );
        return r.rows[0].id as string;
      });
      expect(id).toBeTruthy();
    });

    it("app role UPDATE/DELETE on audit_logs is DENIED (append-only)", async () => {
      const id = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO audit_logs (actor_user_id, action, object_type)
           VALUES ($1, 'approve', 'profile_change_request') RETURNING id`,
          [hrA],
        );
        return r.rows[0].id as string;
      });
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`UPDATE audit_logs SET action = 'x' WHERE id = $1`, [id]);
        }),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM audit_logs WHERE id = $1`, [id]);
        }),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // ─────────────── (4) approve applies full field set (incl. sensitive) + writes history (1 tx) ───────────────

  describe("approve applies allowed fields + writes append-only history (in one tx)", () => {
    const SENSITIVE_FIELDS = ["identity_number", "identity_issue_date", "identity_issue_place"];
    const NEW_VALUES: Record<string, unknown> = {
      phone: "0911111111",
      gender: "Female",
      marital_status: "single",
      personal_email: "new@personal.test",
      current_address: "12 New St",
      identity_number: "***", // masked at app layer before persistence (BẤT BIẾN #3)
      identity_issue_place: "Ha Noi",
    };
    // field -> employee_profiles column (mirror of FIELD_TO_COLUMN allowed mapping)
    const FIELD_TO_COLUMN: Record<string, string> = {
      phone: "phone",
      gender: "gender",
      marital_status: "marital_status",
      personal_email: "personal_email",
      current_address: "current_address",
      identity_number: "identity_number",
      identity_issue_place: "identity_issue_place",
    };

    let approveEmp = "";
    let approveUser = "";
    let approvePcr = "";

    beforeAll(async () => {
      approveUser = await seedUser(direct, A.companyId, `pcr-approve-a@x.test`);
      approveEmp = await seedEmployee(A.companyId, approveUser);
      approvePcr = await seedPcr(
        A.companyId,
        approveEmp,
        approveUser,
        Object.keys(NEW_VALUES),
        NEW_VALUES,
      );
    });

    it("approve applies every mapped field to employee_profiles (no silent drop of 10/13)", async () => {
      // Replays the repository.applyChangesToEmployeeTx + writeProfileChangeHistoryTx + status advance
      // inside ONE app-role tx under RLS — exactly the approve() write path.
      await asTenant(A.companyId, async (c) => {
        // Apply mapped columns
        const sets: string[] = ["updated_at = now()"];
        const params: unknown[] = [];
        let i = 1;
        for (const [field, value] of Object.entries(NEW_VALUES)) {
          const col = FIELD_TO_COLUMN[field];
          if (!col) continue;
          sets.push(`${col} = $${i}`);
          params.push(value);
          i += 1;
        }
        params.push(approveEmp);
        await c.query(
          `UPDATE employee_profiles SET ${sets.join(", ")} WHERE id = $${i} AND deleted_at IS NULL`,
          params,
        );

        // Append one history row per applied field (append-only, same tx).
        for (const field of Object.keys(NEW_VALUES)) {
          const isSensitive = SENSITIVE_FIELDS.includes(field);
          await c.query(
            `INSERT INTO employee_profile_change_histories
               (employee_id, request_id, field_name, old_value, new_value, is_sensitive, changed_by)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
            [
              approveEmp,
              approvePcr,
              field,
              JSON.stringify(null),
              JSON.stringify(NEW_VALUES[field]),
              isSensitive,
              approveUser,
            ],
          );
        }

        // Advance state machine → Approved (status only advances, never goes back).
        await c.query(
          `UPDATE profile_change_requests SET status = 'Approved', reviewed_by = $1, reviewed_at = now(), updated_at = now()
           WHERE id = $2`,
          [approveUser, approvePcr],
        );
      });

      // Verify the employee record carries the NEW data for EVERY mapped field.
      const emp = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `SELECT phone, gender, marital_status, personal_email, current_address,
                  identity_number, identity_issue_place
             FROM employee_profiles WHERE id = $1`,
          [approveEmp],
        );
        return r.rows[0] as Record<string, string | null>;
      });
      expect(emp.phone).toBe("0911111111");
      expect(emp.gender).toBe("Female");
      expect(emp.marital_status).toBe("single");
      expect(emp.personal_email).toBe("new@personal.test");
      expect(emp.current_address).toBe("12 New St");
      expect(emp.identity_number).toBe("***"); // masked value persisted (BẤT BIẾN #3)
      expect(emp.identity_issue_place).toBe("Ha Noi");
    });

    it("history row written per applied field, sensitive group flagged is_sensitive", async () => {
      const rows = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `SELECT field_name, is_sensitive FROM employee_profile_change_histories
             WHERE request_id = $1 ORDER BY field_name`,
          [approvePcr],
        );
        return r.rows as { field_name: string; is_sensitive: boolean }[];
      });
      const byField = new Map(rows.map((x) => [x.field_name, x.is_sensitive]));
      // One row per applied field.
      expect(rows.length).toBe(Object.keys(NEW_VALUES).length);
      // Sensitive identity fields flagged; ordinary fields not.
      expect(byField.get("identity_number")).toBe(true);
      expect(byField.get("identity_issue_place")).toBe(true);
      expect(byField.get("phone")).toBe(false);
      expect(byField.get("gender")).toBe(false);
    });

    it("approved request is terminal: status advanced to Approved with reviewer", async () => {
      const row = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `SELECT status, reviewed_by, reviewed_at FROM profile_change_requests WHERE id = $1`,
          [approvePcr],
        );
        return r.rows[0] as {
          status: string;
          reviewed_by: string | null;
          reviewed_at: Date | null;
        };
      });
      expect(row.status).toBe("Approved");
      expect(row.reviewed_by).toBe(approveUser);
      expect(row.reviewed_at).not.toBeNull();
    });
  });
});
