import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { TasksRepository } from "../../src/tasks/tasks.repository";
import { TasksService } from "../../src/tasks/tasks.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G9-3 — Task Board (listBoard) qua Postgres thật (RLS app role).
 *
 * Bao 3 invariant cốt lõi (rủi ro CRITICAL "rò tenant" + filter contract):
 *   1. TENANT ISOLATION: login A → board KHÔNG lộ row của B. listBoard đi qua db.withTenant(A) +
 *      eq(company_id) → RLS hàng rào thật, app-filter defense-in-depth.
 *   2. FILTER theo task_type: 7 loại seed cho A → filter 'office'/'hr'/'meeting_action'/'finance'
 *      chỉ trả đúng loại; KHÔNG kẹp ngầm.
 *   3. PAGINATION: limit/offset không mất/lặp row (ORDER BY created_at DESC ổn định theo created_at seed).
 *
 * Chạy khi LANE_DB=mediaos_g9 (DB cô lập — chống shared-DB drift, CLAUDE.md §9.6). Tự skip nếu !hasDb.
 */
describe.skipIf(!hasDb)("G9-3 task board — listBoard", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let projectA: string;
  let tasks: TasksService;

  /** 7 task_type của Task Hub (workflow_step giữ back-compat nhưng không thuộc 7 nguồn spec). */
  const SEVEN_TYPES = [
    "production",
    "review",
    "revision",
    "meeting_action",
    "office",
    "finance",
    "hr",
  ] as const;

  /** Seed 1 task thô qua direct pool (bypass RLS) — controllable created_at để test pagination ổn định. */
  async function seedTask(
    companyId: string,
    opts: {
      taskType: string;
      title: string;
      assigneeUserId?: string;
      projectId?: string;
      createdAt?: Date;
    },
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO tasks (company_id, task_type, title, assignee_user_id, project_id, status, origin, created_at)
       VALUES ($1, $2, $3, $4, $5, 'not_started', 'initial', $6) RETURNING id`,
      [
        companyId,
        opts.taskType,
        opts.title,
        opts.assigneeUserId ?? null,
        opts.projectId ?? null,
        opts.createdAt ?? new Date(),
      ],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g93a");
    B = await seedCompany(direct, "g93b");
    userA = await seedUser(direct, A.companyId, `g93-${randomUUID().slice(0, 8)}@a.test`);
    userB = await seedUser(direct, B.companyId, `g93-${randomUUID().slice(0, 8)}@b.test`);

    projectA = (
      await direct.query(
        `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [A.companyId, `g93-prjA-${randomUUID().slice(0, 8)}`],
      )
    ).rows[0].id;

    // Company A: 1 task mỗi loại (created_at tăng dần để pagination ổn định: i=0 cũ nhất).
    const base = Date.now();
    for (let i = 0; i < SEVEN_TYPES.length; i++) {
      await seedTask(A.companyId, {
        taskType: SEVEN_TYPES[i],
        title: `A-${SEVEN_TYPES[i]}`,
        assigneeUserId: userA,
        projectId: projectA,
        createdAt: new Date(base + i * 1000),
      });
    }

    // Company B: office task riêng — KHÔNG được lộ khi login A.
    await seedTask(B.companyId, {
      taskType: "office",
      title: "B-secret-office",
      assigneeUserId: userB,
    });

    const db = new DatabaseService();
    tasks = new TasksService(
      db,
      new TasksRepository(db),
      new AuditService(),
    { resolveAndAssert: async () => "Company" } as never,
    { assertTaskInScopeTx: async () => undefined } as never,
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("TENANT ISOLATION: login A → board KHÔNG lộ row của B (chỉ 7 task của A)", async () => {
    const board = await tasks.listBoard(A.companyId, {}, { limit: 100, offset: 0 });

    expect(board).toHaveLength(SEVEN_TYPES.length);
    expect(board.every((t) => t.companyId === A.companyId)).toBe(true);
    expect(board.some((t) => t.title === "B-secret-office")).toBe(false);
  });

  it("filter taskType='office' → chỉ trả office task của A", async () => {
    const board = await tasks.listBoard(A.companyId, { taskType: "office" });
    expect(board).toHaveLength(1);
    expect(board[0].taskType).toBe("office");
    expect(board[0].title).toBe("A-office");
  });

  it.each(["hr", "meeting_action", "finance"] as const)(
    "filter taskType='%s' → đúng 1 task đúng loại",
    async (type) => {
      const board = await tasks.listBoard(A.companyId, { taskType: type });
      expect(board).toHaveLength(1);
      expect(board[0].taskType).toBe(type);
    },
  );

  it("filter projectId → chỉ task gắn dự án đó (7 task của A đều gắn projectA)", async () => {
    const board = await tasks.listBoard(A.companyId, { projectId: projectA }, { limit: 100 });
    expect(board).toHaveLength(SEVEN_TYPES.length);
    expect(board.every((t) => t.projectId === projectA)).toBe(true);
  });

  it("PAGINATION: limit/offset không mất/lặp row (page1 ∪ page2 = full, disjoint)", async () => {
    const all = await tasks.listBoard(A.companyId, {}, { limit: 100, offset: 0 });
    const page1 = await tasks.listBoard(A.companyId, {}, { limit: 3, offset: 0 });
    const page2 = await tasks.listBoard(A.companyId, {}, { limit: 3, offset: 3 });
    const page3 = await tasks.listBoard(A.companyId, {}, { limit: 3, offset: 6 });

    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page3).toHaveLength(1); // 7 total

    const paged = [...page1, ...page2, ...page3].map((t) => t.id);
    const unique = new Set(paged);
    expect(unique.size).toBe(SEVEN_TYPES.length); // không lặp
    expect(new Set(all.map((t) => t.id))).toEqual(unique); // không mất
  });
});
