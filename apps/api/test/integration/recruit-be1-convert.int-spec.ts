/**
 * S12-RECRUIT-BE-1 — convert ứng viên → nhân viên, 3 PHA (SPEC-12 §13.5 · plan §6.1). Guard tầng 2
 * TRƯỚC cấp mã (deny = 0 side-effect) → cấp mã NGOÀI tx (Pha 2) → business tx khoá hàng, KIỂM LẠI
 * N1 fail-closed, `createEmployeeFromCandidateTx`, link `employee_id` (UNIQUE = chốt cuối race).
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!recruitconvert1";
const EMPLOYEE_CODE_SEQUENCE_KEY = "EMPLOYEE_CODE";

describe.skipIf(!hasLaneDb)("S12-RECRUIT-BE-1 convert 3 pha (SPEC-12 §13.5)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let tFull = "";
  let sharedOrgUnitId = "";

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${tFull}`);
  const get = (u: string) => auth(http().get(u));
  const post = (u: string) => auth(http().post(u));

  async function seedOrgUnit(name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedEmployeeCodeConfig(): Promise<void> {
    await direct.query(
      `INSERT INTO employee_code_configs (company_id, prefix, number_length, status)
       VALUES ($1, 'EMP', 4, 'active')`,
      [A.companyId],
    );
  }

  async function createJob(title: string, orgUnitId: string): Promise<string> {
    const res = await post("/job-openings").send({ title, orgUnitId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id;
  }

  async function createCandidate(jobOpeningId: string, fullName: string): Promise<string> {
    const res = await post("/candidates").send({
      jobOpeningId,
      fullName,
      email: `${fullName.replace(/\s+/g, ".").toLowerCase()}@example.test`,
      phone: "0909000000",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id;
  }

  async function moveStage(candidateId: string, toStage: string): Promise<void> {
    const res = await post(`/candidates/${candidateId}/move-stage`).send({
      toStage,
      reason: "convert qa fixture",
    });
    expect(res.status, `move ${candidateId}->${toStage}: ${JSON.stringify(res.body)}`).toBe(201);
  }

  /** Dựng candidate ở stage Offer + 1 offer Accepted — sẵn sàng convert. */
  async function candidateWithAcceptedOffer(
    label: string,
    orgUnitId = sharedOrgUnitId,
  ): Promise<{ candidateId: string; offerId: string; jobOpeningId: string }> {
    const jobOpeningId = await createJob(`Job ${label}`, orgUnitId);
    const candidateId = await createCandidate(jobOpeningId, `Cand ${label}`);
    await moveStage(candidateId, "Screening");
    await moveStage(candidateId, "Interview");
    await moveStage(candidateId, "Offer");
    const offer = await post("/offers").send({
      candidateId,
      startDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      salary: "3000.00",
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const offerId = offer.body.data.id;
    await post(`/offers/${offerId}/change-status`).send({ toStatus: "Sent" });
    const accept = await post(`/offers/${offerId}/change-status`).send({ toStatus: "Accepted" });
    expect(accept.status, JSON.stringify(accept.body)).toBe(201);
    return { candidateId, offerId, jobOpeningId };
  }

  async function countEmployeeProfiles(): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM employee_profiles WHERE company_id = $1`,
      [A.companyId],
    );
    return r.rows[0].n as number;
  }

  async function readCounter(): Promise<{ currentValue: bigint; status: string } | null> {
    const r = await direct.query(
      `SELECT current_value, status FROM sequence_counters WHERE company_id = $1 AND sequence_key = $2`,
      [A.companyId, EMPLOYEE_CODE_SEQUENCE_KEY],
    );
    if (r.rows.length === 0) return null;
    return { currentValue: BigInt(r.rows[0].current_value), status: r.rows[0].status as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "recruitconvert1");
    companyIds.push(A.companyId);
    await seedEmployeeCodeConfig();

    const allPairs: Array<[string, string]> = [
      ["access", "recruit"],
      ["view", "job-opening"],
      ["create", "job-opening"],
      ["update", "job-opening"],
      ["view", "candidate"],
      ["create", "candidate"],
      ["export", "candidate"],
      ["update", "candidate"],
      ["move-stage", "candidate"],
      ["comment", "candidate"],
      ["convert", "candidate"],
      ["view", "interview"],
      ["manage", "interview"],
      ["feedback", "interview"],
      ["view", "offer"],
      ["manage", "offer"],
    ];
    const fullUser = await seedUser(direct, A.companyId, `full@${A.slug}.test`, hash);
    const roleId = await seedRole(direct, A.companyId, "recruitconvert1-full");
    for (const [action, resource] of allPairs) {
      const sensitive = resource === "candidate";
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
      await seedRolePermission(
        direct,
        roleId,
        permId,
        "ALLOW",
        action === "access" ? "Own" : "Company",
      );
    }
    await seedUserRole(direct, fullUser, roleId, A.companyId);

    const loginRes = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `full@${A.slug}.test`, password: LOGIN_PW });
    expect(loginRes.status, JSON.stringify(loginRes.body)).toBe(200);
    tFull = loginRes.body.data.accessToken;

    sharedOrgUnitId = await seedOrgUnit("Convert Org");
  }, 180_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  it("offer Sent (chưa Accepted) ⇒ 409 008 offer-not-accepted", async () => {
    const job = await createJob("Job Not Accepted", sharedOrgUnitId);
    const cid = await createCandidate(job, "Cand Not Accepted");
    await moveStage(cid, "Screening");
    await moveStage(cid, "Interview");
    await moveStage(cid, "Offer");
    const offer = await post("/offers").send({
      candidateId: cid,
      startDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      salary: "1000.00",
    });
    await post(`/offers/${offer.body.data.id}/change-status`).send({ toStatus: "Sent" });

    const before = await countEmployeeProfiles();
    const res = await post(`/candidates/${cid}/convert`);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("RECRUIT-ERR-008");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "offer-not-accepted" }),
      ]),
    );
    expect(await countEmployeeProfiles()).toBe(before);
  });

  it("0 offer ⇒ 409 008 no-offer", async () => {
    const job = await createJob("Job No Offer", sharedOrgUnitId);
    const cid = await createCandidate(job, "Cand No Offer");
    await moveStage(cid, "Screening");
    await moveStage(cid, "Interview");
    await moveStage(cid, "Offer");

    const res = await post(`/candidates/${cid}/convert`);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("RECRUIT-ERR-008");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "kind", message: "no-offer" })]),
    );
  });

  it("stage != Offer ⇒ 409 007 not-in-offer-stage", async () => {
    const job = await createJob("Job Stage Wrong", sharedOrgUnitId);
    const cid = await createCandidate(job, "Cand Stage Wrong");
    await moveStage(cid, "Screening");

    const res = await post(`/candidates/${cid}/convert`);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("RECRUIT-ERR-007");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "not-in-offer-stage" }),
      ]),
    );
  });

  it("Accepted ⇒ convert OK — employee_profiles user_id NULL, employee_id set, stage Hired, stage-event convert, không map salary, audit + outbox", async () => {
    const { candidateId, jobOpeningId } = await candidateWithAcceptedOffer("Happy Path");

    const res = await post(`/candidates/${candidateId}/convert`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.stage).toBe("Hired");
    expect(res.body.data.employeeId).toBeTruthy();
    expect(typeof res.body.data.employeeCode).toBe("string");
    expect(res.body.data.employeeCode).toMatch(/^EMP\d{4}$/);

    const employeeId = res.body.data.employeeId as string;
    const empRow = await direct.query(
      `SELECT user_id, employee_code, org_unit_id, base_salary FROM employee_profiles WHERE id = $1`,
      [employeeId],
    );
    expect(empRow.rows[0].user_id).toBeNull();
    expect(empRow.rows[0].employee_code).toBe(res.body.data.employeeCode);
    expect(empRow.rows[0].base_salary).toBeNull();

    const candRow = await direct.query(`SELECT employee_id, stage FROM candidates WHERE id = $1`, [
      candidateId,
    ]);
    expect(candRow.rows[0].employee_id).toBe(employeeId);
    expect(candRow.rows[0].stage).toBe("Hired");

    const stageEvent = await direct.query(
      `SELECT action FROM candidate_stage_events
         WHERE candidate_id = $1 AND from_stage = 'Offer' AND to_stage = 'Hired'
         ORDER BY acted_at DESC LIMIT 1`,
      [candidateId],
    );
    expect(stageEvent.rows[0].action).toBe("convert");

    // Audit: candidate/convert + employee/create — payload KHÔNG PII/lương.
    const auditCandidate = await direct.query(
      `SELECT after FROM audit_logs WHERE company_id = $1 AND object_type = 'candidate' AND action = 'convert' AND object_id = $2`,
      [A.companyId, candidateId],
    );
    expect(auditCandidate.rows.length).toBeGreaterThanOrEqual(1);
    const candidateAfter = JSON.stringify(auditCandidate.rows[0].after);
    expect(candidateAfter).not.toContain("example.test");
    expect(candidateAfter).not.toContain("0909000000");
    expect(candidateAfter).not.toContain("3000.00");

    const auditEmployee = await direct.query(
      `SELECT after FROM audit_logs WHERE company_id = $1 AND object_type = 'employee' AND action = 'create' AND object_id = $2`,
      [A.companyId, employeeId],
    );
    expect(auditEmployee.rows.length).toBeGreaterThanOrEqual(1);
    const employeeAfter = JSON.stringify(auditEmployee.rows[0].after);
    expect(employeeAfter).not.toContain("example.test");
    expect(employeeAfter).not.toContain("0909000000");
    expect(employeeAfter).not.toContain("3000.00");

    // Outbox — recruit.candidate_hired.
    const outbox = await direct.query(
      `SELECT payload FROM outbox_events WHERE company_id = $1 AND event_type = 'recruit.candidate_hired'
         AND payload->>'candidateId' = $2`,
      [A.companyId, candidateId],
    );
    expect(outbox.rows.length).toBeGreaterThanOrEqual(1);
    const outboxPayload = JSON.stringify(outbox.rows[0].payload);
    expect(outboxPayload).not.toContain("example.test");
    expect(outboxPayload).not.toContain("0909000000");
    expect(outboxPayload).not.toContain("3000.00");
    void jobOpeningId;
  });

  it("convert lần 2 ⇒ 409 008 already-converted (kiểm TRƯỚC stage — thứ tự N1)", async () => {
    const { candidateId } = await candidateWithAcceptedOffer("Already Converted");
    const first = await post(`/candidates/${candidateId}/convert`);
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    // Candidate giờ đã Hired (≠ Offer) nhưng mã PHẢI là 008, KHÔNG phải 007 (kiểm employee_id TRƯỚC stage).
    const second = await post(`/candidates/${candidateId}/convert`);
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.error.code).toBe("RECRUIT-ERR-008");
    expect(second.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "already-converted" }),
      ]),
    );
  });

  it("RACE — 2 convert song song, 2 Idempotency-Key KHÁC NHAU ⇒ đúng 1 thắng (200), 1 thua (409 008), KHÔNG 500", async () => {
    const { candidateId } = await candidateWithAcceptedOffer("Race");
    const before = await countEmployeeProfiles();

    const [r1, r2] = await Promise.all([
      auth(http().post(`/candidates/${candidateId}/convert`))
        .set("Idempotency-Key", "recruit-convert-race-key-1")
        .send(),
      auth(http().post(`/candidates/${candidateId}/convert`))
        .set("Idempotency-Key", "recruit-convert-race-key-2")
        .send(),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses, `r1=${JSON.stringify(r1.body)} r2=${JSON.stringify(r2.body)}`).toEqual([
      201, 409,
    ]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe("RECRUIT-ERR-008");

    const after = await countEmployeeProfiles();
    expect(after - before).toBe(1);
  });

  it("orgUnitId của job trỏ đơn vị đã xoá mềm ⇒ 422 009 org-unit-invalid, KHÔNG 409 008, KHÔNG tạo employee_profiles mới (rollback)", async () => {
    const deadOrgUnit = await seedOrgUnit("Org Unit To Delete");
    const { candidateId } = await candidateWithAcceptedOffer("OrgUnit Invalid", deadOrgUnit);
    await direct.query(`UPDATE org_units SET deleted_at = now() WHERE id = $1`, [deadOrgUnit]);

    const before = await countEmployeeProfiles();
    const res = await post(`/candidates/${candidateId}/convert`);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("RECRUIT-ERR-009");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "org-unit-invalid" }),
      ]),
    );
    expect(await countEmployeeProfiles()).toBe(before);

    // Rollback thật — candidate KHÔNG đổi stage/employee_id.
    const candRow = await direct.query(`SELECT stage, employee_id FROM candidates WHERE id = $1`, [
      candidateId,
    ]);
    expect(candRow.rows[0].stage).toBe("Offer");
    expect(candRow.rows[0].employee_id).toBeNull();
  });

  it("employee-code TRÙNG mã sắp cấp (thủ công) ⇒ 409 008 employee-code-conflict, KHÔNG 500", async () => {
    const { candidateId } = await candidateWithAcceptedOffer("Code Conflict");
    const counter = await readCounter();
    expect(
      counter,
      "counter EMPLOYEE_CODE phải đã tồn tại (ensure-on-miss từ ca happy-path)",
    ).not.toBeNull();
    const nextValue = counter!.currentValue + 1n;
    const conflictingCode = `EMP${nextValue.toString().padStart(4, "0")}`;
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
       VALUES ($1, NULL, 'active', 'offline', $2)`,
      [A.companyId, conflictingCode],
    );

    const res = await post(`/candidates/${candidateId}/convert`);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("RECRUIT-ERR-008");
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "employee-code-conflict" }),
      ]),
    );
  });

  it("counter EMPLOYEE_CODE Inactive ⇒ 422 HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID, KHÔNG 500 (chạy CUỐI — mutate global counter)", async () => {
    const { candidateId } = await candidateWithAcceptedOffer("Counter Inactive");
    await direct.query(
      `UPDATE sequence_counters SET status = 'Inactive' WHERE company_id = $1 AND sequence_key = $2`,
      [A.companyId, EMPLOYEE_CODE_SEQUENCE_KEY],
    );

    const before = await countEmployeeProfiles();
    const res = await post(`/candidates/${candidateId}/convert`);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body.error)).toContain("HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID");
    expect(await countEmployeeProfiles()).toBe(before);
  });
});
