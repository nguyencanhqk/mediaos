/**
 * S20-NOTI-PRIORITYFILTER-1 — lọc `priority` khớp hiển thị (NULL = Normal) + mark-all-read nhận
 * `priority` + `created_before`. Cần LANE_DB (ca skipIf bị SKIP = KHÔNG đạt).
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, seedUserRole } from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** priority = null ⇒ hàng cũ (cột NULL). createdAt cho phép đặt mốc thời gian tường minh. */
async function seed(
  direct: Pool,
  companyId: string,
  userId: string,
  priority: string | null,
  createdAt: string,
  title: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO notifications
       (company_id, user_id, type, body, is_read, recipient_user_id, status, priority, title,
        notification_type, module_code, event_code, created_at)
     VALUES ($1, $2, 'general', 'noi dung', false, $2, 'Unread', $3, $4, 'Task', 'TASK',
             'TASK_ASSIGNED', $5)
     RETURNING id`,
    [companyId, userId, priority, title, createdAt],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasLaneDb)("S20-NOTI-PRIORITYFILTER-1 lọc priority + mark-all-read", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;
  const companyIds: string[] = [];
  let slugA = "";
  let emailA = "";
  let userA = "";
  let userB = "";
  let token = "";
  const ids: Record<string, string> = {};
  let bId = "";

  const OLD = "2026-01-01T00:00:00Z";
  const CUTOFF = "2026-01-02T00:00:00Z";
  const NEW = "2026-01-03T00:00:00Z";

  async function statusOf(id: string): Promise<string> {
    const r = await direct.query("SELECT status FROM notifications WHERE id = $1", [id]);
    return r.rows[0].status as string;
  }

  beforeAll(async () => {
    const hash = await new PasswordService().hash(PASSWORD);
    const A = await seedCompany(direct, "notipf1a");
    const B = await seedCompany(direct, "notipf1b");
    companyIds.push(A.companyId, B.companyId);
    slugA = A.slug;
    emailA = `a1@${A.slug}.test`;
    userA = await seedUser(direct, A.companyId, emailA, hash);
    userB = await seedUser(direct, B.companyId, `b1@${B.slug}.test`, hash);
    const role = await direct.query(
      "SELECT id FROM roles WHERE name = 'employee' AND company_id IS NULL AND deleted_at IS NULL",
    );
    await seedUserRole(direct, userA, role.rows[0].id as string, A.companyId);
    await seedUserRole(direct, userB, role.rows[0].id as string, B.companyId);

    ids.normalOld = await seed(direct, A.companyId, userA, "Normal", OLD, "normal old");
    ids.nullOld = await seed(direct, A.companyId, userA, null, OLD, "null old");
    ids.highOld = await seed(direct, A.companyId, userA, "High", OLD, "high old");
    ids.lowOld = await seed(direct, A.companyId, userA, "Low", OLD, "low old");
    ids.normalNew = await seed(direct, A.companyId, userA, "Normal", NEW, "normal new");
    ids.nullNew = await seed(direct, A.companyId, userA, null, NEW, "null new");
    bId = await seed(direct, B.companyId, userB, "Normal", OLD, "B normal");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = applyMainPipeline(moduleRef.createNestApplication());
    await nest.init();
    const res = await api(nest)
      .post("/auth/login")
      .send({ companySlug: slugA, email: emailA, password: PASSWORD });
    expect(res.status).toBe(200);
    token = res.body.data.accessToken as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.end();
    if (nest) await nest.close();
  });

  async function listIds(priority: string): Promise<string[]> {
    const res = await api(nest)
      .get("/notifications")
      .query({ priority, per_page: 100 })
      .set(bearer(token));
    expect(res.status).toBe(200);
    return (res.body.data as { notification_id: string }[]).map((i) => i.notification_id);
  }

  it("GET priority=Normal gồm hàng priority NULL (hiển thị Normal), KHÔNG gồm High/Low", async () => {
    const got = await listIds("Normal");
    expect(got).toEqual(
      expect.arrayContaining([ids.normalOld, ids.nullOld, ids.normalNew, ids.nullNew]),
    );
    expect(got).not.toContain(ids.highOld);
    expect(got).not.toContain(ids.lowOld);
    expect(got).not.toContain(bId);
  });

  it("GET priority=High / Low KHÔNG chứa hàng priority NULL", async () => {
    const high = await listIds("High");
    const low = await listIds("Low");
    expect(high).toEqual([ids.highOld]);
    expect(low).toEqual([ids.lowOld]);
  });

  it("mark-all-read {priority:Normal, created_before}: đánh dấu Normal+NULL cũ; KHÔNG đụng hàng mới / High / Low / công ty khác", async () => {
    const res = await api(nest)
      .post("/notifications/mark-all-read")
      .set(bearer(token))
      .send({ priority: "Normal", created_before: CUTOFF });
    expect(res.status).toBe(200);
    expect(res.body.data.updated_count).toBe(2);
    expect(await statusOf(ids.normalOld)).toBe("Read");
    expect(await statusOf(ids.nullOld)).toBe("Read");
    expect(await statusOf(ids.normalNew)).toBe("Unread");
    expect(await statusOf(ids.nullNew)).toBe("Unread");
    expect(await statusOf(ids.highOld)).toBe("Unread");
    expect(await statusOf(ids.lowOld)).toBe("Unread");
    expect(await statusOf(bId)).toBe("Unread");
  });

  it("mark-all-read {priority:High} không đụng hàng NULL/Normal còn lại", async () => {
    const res = await api(nest)
      .post("/notifications/mark-all-read")
      .set(bearer(token))
      .send({ priority: "High" });
    expect(res.status).toBe(200);
    expect(res.body.data.updated_count).toBe(1);
    expect(await statusOf(ids.highOld)).toBe("Read");
    expect(await statusOf(ids.nullNew)).toBe("Unread");
    expect(await statusOf(ids.lowOld)).toBe("Unread");
  });

  it("mark-all-read priority rác → 422/400 (không lặng lẽ đánh dấu hết)", async () => {
    const res = await api(nest)
      .post("/notifications/mark-all-read")
      .set(bearer(token))
      .send({ priority: "Bogus" });
    expect([400, 422]).toContain(res.status);
    expect(await statusOf(ids.lowOld)).toBe("Unread");
  });
});
