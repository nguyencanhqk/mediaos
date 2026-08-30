/**
 * S11-ASSET-BE-1 — NOTI (SPEC-13 §17) + idempotency (§12 / API-14 §7.5), đường THẬT:
 *   · assign/revoke → outbox `asset.assigned`/`asset.revoked` (enqueue trong tx) → OutboxWorker → bridge
 *     (AssetNotiBridgeRegistrar) → engine.intake → `notifications` cho user của nhân viên; actor bị loại;
 *   · dedupe THẬT: phát lại cùng outbox payload ⇒ KHÔNG có notification thứ 2 (bằng chứng `dedupeKeyOf` không bị
 *     quên — catalog 0551 DedupeKey, plan §11);
 *   · job ASSET_MAINTENANCE_DUE: chạy 2 lần cùng hạn ⇒ 1 noti; đổi hạn ⇒ khoá mới; thu hồi role ⇒ 0 mới;
 *   · `@Idempotent()` trên cấp phát: cùng key ⇒ replay envelope + `Idempotency-Replayed`, 1 lượt; khác payload ⇒ 409.
 *
 * Spec lái OutboxWorker ⇒ PHẢI giữ `acquireOutboxWorkerLock` (S7-QA-OUTBOXPROBE-1). GATE `hasDb && LANE_DB`.
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
import { OutboxWorker } from "../../src/events/outbox-worker";
import { AssetMaintenanceDueJobHandler } from "../../src/notifications/asset-maintenance-due.job-handler";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
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
const LOGIN_PW = "Passw0rd!assetnoti";
/** Role hệ thống `asset-manager` (mig 0550, id cố định). */
const ASSET_MANAGER_ROLE_ID = "00000000-0000-0000-0000-000000000012";

const ASSET_ALL: Array<[string, string, "Own" | "Company"]> = [
  ["access", "asset", "Own"],
  ["view", "asset", "Company"],
  ["create", "asset", "Company"],
  ["update", "asset", "Company"],
  ["delete", "asset", "Company"],
  ["assign", "asset", "Company"],
  ["revoke", "asset", "Company"],
  ["dispose", "asset", "Company"],
  ["manage", "asset-category", "Company"],
  ["manage", "asset-maintenance", "Company"],
  ["manage", "asset-inventory", "Company"],
];

describe.skipIf(!hasLaneDb)("S11-ASSET-BE-1 NOTI + idempotency (DB cô lập, outbox thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let outboxLock: OutboxWorkerLock | undefined;
  let tCa = "";
  let caUser = "";
  let caEmp = "";
  let e1User = "";
  let e1Emp = "";
  let amUser = "";
  let catId = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);

  const drain = () =>
    drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });
  const notisOf = async (userId: string, eventCode: string) =>
    (
      await direct.query(
        `SELECT id, dedupe_key AS "dedupeKey", source_entity_id AS "sourceEntityId", payload, title, body
           FROM notifications WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND deleted_at IS NULL
          ORDER BY created_at`,
        [A.companyId, userId, eventCode],
      )
    ).rows as Array<{
      id: string;
      dedupeKey: string | null;
      sourceEntityId: string | null;
      title: string;
      body: string;
      payload: Record<string, unknown>;
    }>;
  const outboxOf = async (eventType: string) =>
    (
      await direct.query(
        "SELECT id, payload FROM outbox_events WHERE company_id=$1 AND event_type=$2 ORDER BY created_at",
        [A.companyId, eventType],
      )
    ).rows as Array<{ id: string; payload: Record<string, unknown> }>;

  async function newAsset(name: string) {
    const res = await post(tCa, "/assets").send({ categoryId: catId, name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    outboxLock = await acquireOutboxWorkerLock("asset-be1-noti");

    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "assetnoti");
    companyIds.push(A.companyId);
    caUser = await seedUser(direct, A.companyId, `ca@${A.slug}.test`, hash);
    e1User = await seedUser(direct, A.companyId, `e1@${A.slug}.test`, hash);
    amUser = await seedUser(direct, A.companyId, `am@${A.slug}.test`, hash);
    await direct.query("UPDATE users SET full_name = 'Quản trị CA' WHERE id = $1", [caUser]);
    const empOf = async (u: string) =>
      (
        await direct.query(
          "INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id",
          [A.companyId, u],
        )
      ).rows[0].id as string;
    caEmp = await empOf(caUser);
    e1Emp = await empOf(e1User);
    await empOf(amUser);
    const roleId = await seedRole(direct, A.companyId, "asset-noti-ca");
    for (const [a, r, s] of ASSET_ALL) {
      await seedRolePermission(
        direct,
        roleId,
        await seedPermissionCatalog(direct, a, r, false),
        "ALLOW",
        s,
      );
    }
    await seedUserRole(direct, caUser, roleId, A.companyId);
    // am giữ ROLE HỆ THỐNG asset-manager (recipient của ASSET_MAINTENANCE_DUE resolve theo role — SPEC-13 §17).
    await seedUserRole(direct, amUser, ASSET_MANAGER_ROLE_ID, A.companyId);

    const login = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `ca@${A.slug}.test`, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    tCa = login.body.data.accessToken;
    const cat = await post(tCa, "/asset-categories").send({
      code: "NT",
      name: "Noti",
      codePrefix: "NT",
    });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    catId = cat.body.data.id;
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await outboxLock?.release();
    await direct?.end();
    await app?.close();
  });

  it("assign (Idempotency-Key) → 1 lượt, ASSET_ASSIGNED cho e1 với dedupe_key ổn định; replay ⇒ cùng envelope + header, không lượt mới", async () => {
    const asset = await newAsset("N1");
    const key = `asset-assign-${asset}`;
    const r1 = await post(tCa, `/assets/${asset}/assign`)
      .set("Idempotency-Key", key)
      .send({ employeeId: e1Emp });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.headers["idempotency-replayed"]).toBeUndefined();
    const ob = await outboxOf("asset.assigned");
    expect(ob).toHaveLength(1);
    expect(ob[0].payload).toMatchObject({
      assetId: asset,
      employeeId: e1Emp,
      actorUserId: caUser,
      actor_name: "Quản trị CA",
    });
    expect(ob[0].payload.purchasePrice).toBeUndefined();

    const r2 = await post(tCa, `/assets/${asset}/assign`)
      .set("Idempotency-Key", key)
      .send({ employeeId: e1Emp });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.headers["idempotency-replayed"]).toBe("true");
    expect(r2.body.data.id).toBe(r1.body.data.id);
    expect((await outboxOf("asset.assigned")).length).toBe(1);
    const active = await direct.query(
      "SELECT count(*)::int AS n FROM asset_assignments WHERE asset_id=$1",
      [asset],
    );
    expect(active.rows[0].n).toBe(1);

    const reused = await post(tCa, `/assets/${asset}/assign`)
      .set("Idempotency-Key", key)
      .send({ employeeId: caEmp });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe("REQUEST-ERR-IDEMPOTENCY-KEY-REUSED"); // mã thật của interceptor dùng chung

    await drain();
    const notis = await notisOf(e1User, "ASSET_ASSIGNED");
    expect(notis).toHaveLength(1);
    expect(typeof ob[0].payload.assignmentId, "payload outbox phải mang assignmentId").toBe(
      "string",
    );
    const assignmentId = ob[0].payload.assignmentId as string;
    // Render thật: không còn `{placeholder}` (gate silent-failure H2)
    expect(notis[0].title).not.toContain("{");
    expect(notis[0].body).toContain("N1");
    expect(notis[0].body).toContain("Quản trị CA");
    expect(notis[0].dedupeKey).toBe(`ASSET_ASSIGNED:${assignmentId}`);
    expect(notis[0].sourceEntityId).toBe(assignmentId);
    // actor (ca) không nhận
    expect(await notisOf(caUser, "ASSET_ASSIGNED")).toHaveLength(0);

    // Phát lại CÙNG payload (mô phỏng producer gửi trùng) ⇒ dedupe THẬT: vẫn 1 notification
    await direct.query(
      "INSERT INTO outbox_events (company_id, event_type, payload) VALUES ($1,'asset.assigned',$2)",
      [A.companyId, ob[0].payload],
    );
    await drain();
    expect(await notisOf(e1User, "ASSET_ASSIGNED")).toHaveLength(1);
  });

  it("revoke ⇒ ASSET_REVOKED cho e1 (kể cả Lost); actor tự cấp cho mình ⇒ 0 noti (actor-exclusion)", async () => {
    const asset = await newAsset("N2");
    await post(tCa, `/assets/${asset}/assign`).send({ employeeId: e1Emp });
    const r = await post(tCa, `/assets/${asset}/revoke`).send({
      returnCondition: "Lost",
      returnNote: "mất",
    });
    expect(r.status).toBe(201);
    await drain();
    const revoked = await notisOf(e1User, "ASSET_REVOKED");
    expect(revoked).toHaveLength(1);
    expect(revoked[0].payload).toMatchObject({ asset_name: "N2" });

    const self = await newAsset("N3");
    await post(tCa, `/assets/${self}/assign`).send({ employeeId: caEmp });
    await drain();
    expect(await notisOf(caUser, "ASSET_ASSIGNED")).toHaveLength(0);
  });

  it("job ASSET_MAINTENANCE_DUE: 1 noti/(asset,hạn) cho asset-manager; chạy lại ⇒ 0 mới; đổi hạn ⇒ mới; thu hồi role ⇒ 0", async () => {
    const handler = app.get(AssetMaintenanceDueJobHandler);
    const asset = await newAsset("N4");
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    // đặt hạn qua đường nghiệp vụ: mở/đóng bảo trì với nextDueDate
    const setDue = async (id: string, due: string) => {
      const o = await post(tCa, `/assets/${id}/maintenances`).send({ reason: "định kỳ" });
      expect(o.status, JSON.stringify(o.body)).toBe(201);
      const mid = o.body.data.openMaintenance.id as string;
      const c = await post(tCa, `/assets/${id}/maintenances/${mid}/close`).send({
        nextDueDate: due,
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
    };
    await setDue(asset, soon);
    const farAsset = await newAsset("N5-xa");
    await setDue(farAsset, far);

    const run1 = await handler.run({ companyId: A.companyId });
    expect(run1.total).toBe(1); // 1 asset trong cửa sổ × 1 recipient (am); ca KHÔNG có role hệ thống ⇒ không nhận
    let notis = await notisOf(amUser, "ASSET_MAINTENANCE_DUE");
    expect(notis).toHaveLength(1);
    expect(notis[0].dedupeKey).toBe(`ASSET_MAINTENANCE_DUE:${asset}:${soon}`);
    expect(notis[0].payload).toMatchObject({ asset_id: asset, due_date: soon, asset_name: "N4" });
    expect(await notisOf(caUser, "ASSET_MAINTENANCE_DUE")).toHaveLength(0);

    await handler.run({ companyId: A.companyId });
    expect(await notisOf(amUser, "ASSET_MAINTENANCE_DUE")).toHaveLength(1); // dedupe once-ever theo (asset, hạn)

    await setDue(asset, later);
    await handler.run({ companyId: A.companyId });
    notis = await notisOf(amUser, "ASSET_MAINTENANCE_DUE");
    expect(notis).toHaveLength(2);
    expect(notis[1].dedupeKey).toBe(`ASSET_MAINTENANCE_DUE:${asset}:${later}`);

    // Disposed ⇒ không nhắc nữa
    await post(tCa, `/assets/${asset}/dispose`).send({ kind: "Disposed", reason: "thanh lý" });
    const other = await newAsset("N6");
    await setDue(other, soon);
    // thu hồi role (tombstone) ⇒ 0 recipient ⇒ 0 noti mới
    await direct.query("UPDATE user_roles SET deleted_at = now() WHERE user_id=$1 AND role_id=$2", [
      amUser,
      ASSET_MANAGER_ROLE_ID,
    ]);
    const run3 = await handler.run({ companyId: A.companyId });
    // 0 recipient nhưng CÓ tài sản đến hạn ⇒ KÊU: failed = số tài sản, metadata.reason (gate silent-failure M2)
    expect(run3.metadata).toMatchObject({ recipients: 0, dueAssets: 1, reason: "no_recipient" });
    expect(run3.failed).toBe(1);
    expect(run3.success).toBe(0);
    expect(await notisOf(amUser, "ASSET_MAINTENANCE_DUE")).toHaveLength(2);
    // ALLOW đối chứng: gán lại role ⇒ nhận cho `other`
    await direct.query("UPDATE user_roles SET deleted_at = NULL WHERE user_id=$1 AND role_id=$2", [
      amUser,
      ASSET_MANAGER_ROLE_ID,
    ]);
    const run4 = await handler.run({ companyId: A.companyId });
    expect(run4.total).toBe(1);
    expect(await notisOf(amUser, "ASSET_MAINTENANCE_DUE")).toHaveLength(3);
    expect((await get(tCa, "/assets/summary")).body.data.maintenanceDueSoon).toBe(1);
  });
});
