/**
 * S6-SEC-MV-1 — KI-041: ranh giới tenant của 2 matview dashboard phải nằm ở TẦNG DB (mig 0534).
 *
 * VẤN ĐỀ. PostgreSQL KHÔNG hỗ trợ RLS trên materialized view. `mv_dashboard_task_status` và
 * `mv_dashboard_output` mang cột `company_id` nhưng nằm NGOÀI phép đo 153/153 bảng RLS ⇒ trước 0534
 * ranh giới DUY NHẤT là dòng `WHERE company_id = $1` viết tay trong `mv-dashboard.service.ts`.
 *
 * VẾ RED (đo trên lane 2026-07-29, TRƯỚC 0534): role `mediaos_app` chạy
 *   SELECT count(*), count(DISTINCT company_id) FROM mv_dashboard_task_status
 * KHÔNG mệnh đề lọc ⇒ **56 hàng / 38 tenant**. Một câu SELECT quên vế `company_id` là rò chéo tenant,
 * và không tầng nào bên dưới chặn.
 *
 * SAU 0534: app role MẤT quyền đọc thẳng MV; đọc qua view `security_barrier` tự lọc theo
 * `current_setting('app.current_company_id')` (biến mà `withTenant()` set). Suite này khoá cả hai vế —
 * chặn được gì VÀ còn phục vụ đúng gì (một ranh giới chặn sạch nhưng làm rỗng dashboard cũng là hỏng).
 *
 * ⚠️ SUITE TỰ SEED DỮ LIỆU CỦA MÌNH, KHÔNG dựa vào dữ liệu sẵn có trong MV. Bản đầu của file này đọc
 * "2 tenant nhiều hàng nhất" từ MV rồi mới khẳng định — chạy xanh trên lane dev (có sẵn 38 tenant rác)
 * nhưng sẽ ĐỎ trên DB CI phù du, nơi MV rỗng. Cô lập tenant phải được chứng minh bằng hai tenant DO
 * CHÍNH SPEC dựng ra, không phải bằng thứ tình cờ có mặt.
 *
 * Gate `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`): .env trỏ DB dev dùng chung làm
 * hasDb=true, nên khẳng định chạm DB chỉ chạy dưới LANE_DB cô lập.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

const MATVIEWS = ["mv_dashboard_task_status", "mv_dashboard_output"] as const;
const BARRIER_VIEWS = ["v_dashboard_task_status", "v_dashboard_output"] as const;

/** Chạy `fn`, trả về mã lỗi Postgres (SQLSTATE) nếu ném, hoặc null nếu chạy lọt. */
async function sqlstateOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err: unknown) {
    return (err as { code?: string }).code ?? "UNKNOWN";
  }
}

describe.skipIf(!hasLaneDb)("S6-SEC-MV-1 — ranh giới tenant của matview dashboard (KI-041)", () => {
  const direct = directPool();
  let app: Pool;
  let worker: Pool;

  let A: SeededTenant;
  let B: SeededTenant;
  /** Số hàng MV mà mỗi tenant do spec dựng ra PHẢI có (đếm bằng owner sau REFRESH). */
  const expected = new Map<string, number>();

  beforeAll(async () => {
    app = appPool();
    worker = workerPool();

    A = await seedCompany(direct, "mvbarA");
    B = await seedCompany(direct, "mvbarB");

    // Trồng task với trạng thái KHÁC NHAU giữa hai tenant ⇒ nếu view rò, số hàng/nội dung sẽ lệch
    // rõ chứ không trùng khớp ngẫu nhiên.
    const plant = (companyId: string, status: string, n: number) =>
      Promise.all(
        Array.from({ length: n }, (_, i) =>
          direct.query(
            "INSERT INTO tasks (company_id, task_type, title, status) VALUES ($1,'office',$2,$3)",
            [companyId, `mvbar-${status}-${i}`, status],
          ),
        ),
      );
    await plant(A.companyId, "not_started", 2); // → Todo
    await plant(A.companyId, "completed", 3); // → Done
    await plant(B.companyId, "completed", 1); // → Done

    // Populate MV bằng OWNER (mô phỏng refresh-job). 0102 tạo WITH NO DATA nên lane mới phải nạp.
    await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_task_status");
    await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_output");

    for (const t of [A, B]) {
      const r = await direct.query<{ n: string }>(
        "SELECT count(*)::int AS n FROM mv_dashboard_task_status WHERE company_id = $1",
        [t.companyId],
      );
      expected.set(t.companyId, Number(r.rows[0].n));
    }
  }, 180_000);

  afterAll(async () => {
    await direct
      .query("DELETE FROM tasks WHERE company_id = ANY($1::uuid[])", [
        [A?.companyId, B?.companyId].filter(Boolean),
      ])
      .catch(() => undefined);
    await cleanupTenants(direct, [A?.companyId, B?.companyId].filter(Boolean) as string[]);
    // Dọn xong mới refresh lại để MV không giữ dòng ma của chính spec này.
    await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_task_status").catch(() => undefined);
    await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_output").catch(() => undefined);
    await app?.end();
    await worker?.end();
    await direct.end();
  });

  it("tiền đề: spec đã dựng được 2 tenant CÓ dữ liệu trong MV", () => {
    // Không có ca này thì mọi khẳng định "chỉ thấy tenant mình" bên dưới có thể thoả mãn một cách
    // tầm thường bởi một MV rỗng.
    expect(expected.get(A.companyId), "tenant A không có hàng nào trong MV").toBeGreaterThan(0);
    expect(expected.get(B.companyId), "tenant B không có hàng nào trong MV").toBeGreaterThan(0);
  });

  // ── 1. App role KHÔNG còn cửa đọc thẳng ────────────────────────────────────────────────────────

  it.each(MATVIEWS)("app role KHÔNG đọc thẳng được %s (42501)", async (mv) => {
    // Đây là ca đảo ngược trực tiếp vế RED: trước 0534 câu này trả 56 hàng / 38 tenant.
    const code = await sqlstateOf(() => app.query(`SELECT count(*) FROM ${mv}`));
    expect(
      code,
      `app role còn SELECT thẳng trên ${mv} ⇒ ranh giới tenant lại chỉ là WHERE viết tay (KI-041)`,
    ).toBe("42501"); // insufficient_privilege
  });

  it("worker role cũng KHÔNG đọc thẳng / KHÔNG REFRESH thẳng được MV", async () => {
    // Worker chỉ được EXECUTE hàm refresh. Nếu nó còn quyền thẳng thì đường vòng vẫn mở.
    expect(await sqlstateOf(() => worker.query("SELECT 1 FROM mv_dashboard_task_status"))).toBe(
      "42501",
    );
    expect(
      await sqlstateOf(() => worker.query("REFRESH MATERIALIZED VIEW mv_dashboard_task_status")),
    ).toBe("42501");
  });

  // ── 2. View chắn tenant: fail-closed NGOÀI ngữ cảnh ────────────────────────────────────────────

  it.each(BARRIER_VIEWS)("%s trả 0 hàng khi KHÔNG có app.current_company_id", async (v) => {
    // Fail-closed: ngoài withTenant biến không tồn tại ⇒ current_setting(...,true) = NULL ⇒ 0 hàng.
    // KHÔNG được ném lỗi (missing_ok=true) — ném thì mọi câu ngoài ngữ cảnh thành 500 khó chẩn.
    const r = await app.query<{ n: string }>(`SELECT count(*)::int AS n FROM ${v}`);
    expect(Number(r.rows[0].n), `${v} rò hàng khi chưa set tenant context`).toBe(0);
  });

  it.each(BARRIER_VIEWS)("%s trả 0 hàng với tenant KHÔNG tồn tại", async (v) => {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [
        "00000000-0000-0000-0000-000000000000",
      ]);
      const r = await c.query<{ n: string }>(`SELECT count(*)::int AS n FROM ${v}`);
      expect(Number(r.rows[0].n)).toBe(0);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  it("chuỗi rỗng KHÔNG làm vỡ view (NULLIF chặn 22P02)", async () => {
    // `set_config(..., '')` trả '' chứ không NULL; thiếu NULLIF thì `''::uuid` ném 22P02 ⇒ 500.
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', '', true)");
      const r = await c.query<{ n: string }>(
        "SELECT count(*)::int AS n FROM v_dashboard_task_status",
      );
      expect(Number(r.rows[0].n)).toBe(0);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  // ── 3. Cô lập tenant THẬT (BẤT BIẾN #1) ────────────────────────────────────────────────────────

  it("trong ngữ cảnh tenant, view CHỈ trả hàng của tenant đó — và trả ĐỦ", async () => {
    for (const t of [A, B]) {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [t.companyId]);
        const r = await c.query<{ n: string; d: string }>(
          "SELECT count(*)::int AS n, count(DISTINCT company_id)::int AS d FROM v_dashboard_task_status",
        );
        // ĐỦ: đúng số hàng owner đếm được cho tenant đó — chống hồi quy "chặn sạch nhưng rỗng luôn".
        expect(Number(r.rows[0].n), `tenant ${t.slug} mất hàng qua view`).toBe(
          expected.get(t.companyId),
        );
        // CHỈ: đúng 1 tenant xuất hiện.
        expect(Number(r.rows[0].d), `view rò tenant khác cho ${t.slug}`).toBe(1);
      } finally {
        await c.query("ROLLBACK").catch(() => undefined);
        c.release();
      }
    }
  });

  it("đứng trong tenant A KHÔNG thấy một hàng nào của tenant B (khẳng định danh tính dương)", async () => {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      const r = await c.query<{ company_id: string }>(
        "SELECT DISTINCT company_id FROM v_dashboard_task_status",
      );
      const seen = r.rows.map((x) => x.company_id);
      expect(seen).toEqual([A.companyId]);
      expect(seen).not.toContain(B.companyId);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  // ── 4. Đường REFRESH sống lại (nợ G14 — done_when #5) ──────────────────────────────────────────

  it("worker gọi được refresh_dashboard_mvs() VÀ matview KHÔNG bị làm rỗng", async () => {
    // Bẫy đã ghi trong 0534: nếu ai đó "sửa nhanh" bằng ALTER ... OWNER TO mediaos_worker thì REFRESH
    // chạy dưới quyền worker (KHÔNG BYPASSRLS) trên `tasks` FORCE RLS ⇒ MV RỖNG LẶNG LẼ. Vế "không
    // rỗng" bên dưới chính là ca bắt cái bẫy đó — đừng gỡ nó cho gọn.
    const r = await worker.query<{ ts: string }>("SELECT refresh_dashboard_mvs() AS ts");
    expect(r.rows[0].ts, "hàm refresh không trả timestamp").toBeTruthy();

    // Dữ liệu của CHÍNH spec này phải còn nguyên sau khi worker refresh — phép đo cụ thể, không phải
    // "count(*) > 0" chung chung (vốn có thể xanh nhờ dữ liệu của tenant khác).
    for (const t of [A, B]) {
      const after = await direct.query<{ n: string }>(
        "SELECT count(*)::int AS n FROM mv_dashboard_task_status WHERE company_id = $1",
        [t.companyId],
      );
      expect(
        Number(after.rows[0].n),
        `REFRESH qua hàm làm MẤT hàng của ${t.slug} — nhiều khả năng hàm chạy dưới role thiếu BYPASSRLS (xem 0534)`,
      ).toBe(expected.get(t.companyId));
    }
  });

  it("hàm refresh KHÔNG mở cho PUBLIC (chỉ worker được EXECUTE)", async () => {
    const acl = await direct.query<{ has: boolean }>(
      "SELECT has_function_privilege('public', 'refresh_dashboard_mvs()', 'EXECUTE') AS has",
    );
    expect(acl.rows[0].has, "PUBLIC còn EXECUTE trên hàm SECURITY DEFINER").toBe(false);
  });

  // ── 5. Chốt cấu hình: view phải THỰC SỰ là security_barrier ────────────────────────────────────

  it.each(BARRIER_VIEWS)("%s được đánh dấu security_barrier", async (v) => {
    // Không có cờ này, planner được đẩy hàm do người dùng cung cấp xuống DƯỚI vế lọc tenant
    // (leaky view) ⇒ quan sát được hàng của tenant khác trước khi chúng bị loại.
    const r = await direct.query<{ opts: string[] | null }>(
      "SELECT c.reloptions AS opts FROM pg_class c WHERE c.relname = $1 AND c.relkind = 'v'",
      [v],
    );
    expect(r.rows[0]?.opts ?? [], `${v} thiếu security_barrier`).toContain("security_barrier=true");
  });
});
