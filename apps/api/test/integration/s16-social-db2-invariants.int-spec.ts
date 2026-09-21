import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S16-SOCIAL-DB-2 (mig 0580 · 0581 · 0582 · 0583) — CHỐT HỒI QUY cho nền dữ liệu SOCIAL Track B
 * (9 bảng: nhóm · bình chọn · sáng kiến · vinh danh — DB-17 §7/§9 · SPEC-16 §13 ·
 * plan `docs/plans/S16-SOCIAL-DB-2.md` §7).
 *
 * VÌ SAO FILE NÀY TỒN TẠI. Migration tự verify bằng khối DO/RAISE, nhưng verify đó chạy ĐÚNG MỘT LẦN
 * lúc migrate. Sau khi merge, một WO sau `GRANT DELETE ON feed_groups`, tắt `FORCE` RLS, đổi
 * `SET NULL (created_by)` thành `SET NULL` trần, bỏ predicate `WHERE single_choice` khỏi
 * `feed_poll_votes_single_uq`, hay bỏ `feed_posts_group_fk` — KHÔNG có gì đỏ: `rls-registry` không phủ
 * GRANT/partial-unique, và `xtenant-fk-ratchet` chỉ soi FK MỘT-CỘT đang tồn tại nên nó MÙ hoàn toàn với
 * cụm bảng này (không bảng nào có FK một-cột). Đây là Nhóm 12 của plan §7 — "hồi quy vĩnh viễn".
 *
 * NƠI CHẠY: gate `hasDb`, KHÔNG gate `LANE_DB` — chạy THẬT trên CI (DATABASE_URL + DIRECT_URL cấp job).
 *
 * QUY TẮC (giữ nguyên từ `s16-social-db1-invariants.int-spec.ts`): mọi ca ÂM assert `err.code` +
 * `err.constraint` ĐÍCH DANH, vi phạm ĐÚNG MỘT ràng buộc mỗi ca (`pg-reports-arbitrary-check-when-multiple-violated`
 * — PG chọn TUỲ Ý khi nhiều CHECK cùng vỡ), và CÓ ĐỐI CHỨNG DƯƠNG trên CÙNG ràng buộc
 * (`deny-cases-vacuous-without-allow-case`). Mọi mutation chạy trong tx ROLLBACK.
 *
 * ⚠️ Ở đây dùng `pg` THÔ nên mã lỗi nằm thẳng ở `err.code`. Khi viết ca tương đương qua **drizzle**
 * (BE-2), nhớ `err.cause?.code` — drizzle bọc lỗi và GIẤU mã PG xuống `cause`.
 *
 * ⚠️ `feed_poll_votes.single_choice` KHÔNG có DEFAULT (cố ý — D1 plan §2, fail-closed): MỌI INSERT phiếu
 * trong file này truyền tường minh, thiếu là `23502`. Bản thân điều đó được GHIM ở Nhóm 4 ca (c).
 *
 * KHÔNG có trong file này (có chủ ý):
 *   · Nhóm 7 (mirror Zod ↔ CHECK hai chiều) → `packages/contracts/src/social.spec.ts`.
 *   · Nhóm 8 (cổng `feed_posts.group_id` tự lên nòng) → `s16-social-db1-invariants.int-spec.ts` §7.5 —
 *     spec đó TỰ ĐỔI NHÁNH khi `feed_groups` tồn tại; chép lại ở đây là nhân bản nguồn sự thật.
 *   · Nhóm 11 (`PROTECTED_TABLES`) → `src/foundation/retention/retention.service.spec.ts` (unit, không cần DB).
 */
describe.skipIf(!hasDb)(
  "S16-SOCIAL-DB-2 · bất biến nền dữ liệu SOCIAL Track B (mig 0580–0583)",
  () => {
    const direct = directPool();
    const app = appPool(3);
    const worker = workerPool(1);

    let A: SeededTenant;
    let B: SeededTenant;
    /** Tenant RIÊNG cho Nhóm 13 — công ty THẬT để chứng minh thân SQL seed của `0582` có tác dụng. */
    let C: SeededTenant;
    let uA: string;
    let uA2: string;
    let uB: string;
    let empA: string;
    let empA2: string;
    let empB: string;
    let groupA: string;
    let groupAName: string;
    let groupB: string;
    let pollA: string; // multiple_choice = false
    let optA1: string;
    let optA2: string;
    let pollMultiA: string; // multiple_choice = true
    let optM1: string;
    let optM2: string;
    let ideaA: string;
    let kudosA: string;
    let badgeACode: string;
    let badgeBId: string;
    let postSparePollA: string; // bài 'poll' CHƯA có feed_polls — đối chứng DƯƠNG cho unique 1-1
    let postSpareIdeaA: string;
    let postSpareKudosA: string;

    type Outcome = { code: string | null; constraint?: string; message?: string };

    async function withRole<T>(
      pool: Pool,
      companyId: string | null,
      fn: (c: PoolClient) => Promise<T>,
    ): Promise<T> {
      const c = await pool.connect();
      let restored = true;
      try {
        await c.query("BEGIN");
        if (companyId) {
          await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        }
        return await fn(c);
      } finally {
        try {
          await c.query("ROLLBACK");
        } catch {
          restored = false;
        }
        c.release(restored ? undefined : true);
      }
    }

    /** Chạy MỘT chuỗi câu lệnh dưới role trong tx (rollback); trả mã lỗi PG của câu ĐẦU TIÊN hỏng. */
    async function attemptSeq(
      companyId: string | null,
      steps: Array<[string, unknown[]?]>,
      pool: Pool = app,
    ): Promise<Outcome> {
      return withRole(pool, companyId, async (c) => {
        try {
          for (const [sql, params] of steps) await c.query(sql, params ?? []);
          return { code: null };
        } catch (e) {
          const err = e as { code?: string; constraint?: string; message?: string };
          return { code: err.code ?? "UNKNOWN", constraint: err.constraint, message: err.message };
        }
      });
    }
    const attempt = (
      companyId: string | null,
      sql: string,
      params: unknown[] = [],
      pool: Pool = app,
    ) => attemptSeq(companyId, [[sql, params]], pool);

    /** 9 bảng Track B — thứ tự khai báo = CHA → CON (teardown đi ngược, xem `cleanupTenants`). */
    const TRACK_B_TABLES = [
      "feed_groups",
      "feed_group_members",
      "feed_kudos_badges",
      "feed_polls",
      "feed_poll_options",
      "feed_poll_votes",
      "feed_ideas",
      "feed_kudos",
      "feed_kudos_recipients",
    ] as const;

    /** DB-17 §4.9 / plan §4 — ACL cấp bảng của `mediaos_app`, sắp theo tên privilege. */
    const APP_ACL: Record<string, string[]> = {
      feed_groups: ["INSERT", "SELECT", "UPDATE"],
      feed_group_members: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      feed_kudos_badges: ["INSERT", "SELECT", "UPDATE"],
      feed_polls: ["INSERT", "SELECT", "UPDATE"],
      feed_poll_options: ["INSERT", "SELECT", "UPDATE"],
      feed_poll_votes: ["DELETE", "INSERT", "SELECT"],
      feed_ideas: ["INSERT", "SELECT", "UPDATE"],
      feed_kudos: ["INSERT", "SELECT", "UPDATE"],
      feed_kudos_recipients: ["DELETE", "INSERT", "SELECT"],
    };

    /** 5 mã huy hiệu hệ thống — DB-17 §7.9, chốt D3 (plan §2). Chép TAY, KHÔNG đọc từ migration. */
    const SYSTEM_BADGES = [
      "teamwork",
      "innovation",
      "customer-first",
      "mentor",
      "above-beyond",
    ] as const;

    const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");

    /** Phát lại nguyên văn một file migration (tách theo statement-breakpoint) — khuôn DB-1. */
    async function runMigrationFile(c: PoolClient, file: string): Promise<void> {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      for (const stmt of sql.split("--> statement-breakpoint")) {
        if (
          stmt
            .trim()
            .replace(/^--.*$/gm, "")
            .trim().length === 0
        )
          continue;
        await c.query(stmt);
      }
    }

    const mkPost = async (companyId: string, userId: string, type: string): Promise<string> =>
      (
        await direct.query(
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, $3, 'company', 'bài nền Track B') RETURNING id`,
          [companyId, userId, type],
        )
      ).rows[0].id as string;

    beforeAll(async () => {
      A = await seedCompany(direct, "socbA");
      B = await seedCompany(direct, "socbB");
      C = await seedCompany(direct, "socbBadge");
      uA = await seedUser(direct, A.companyId, `socb-u1-${A.slug}@x.test`);
      uA2 = await seedUser(direct, A.companyId, `socb-u2-${A.slug}@x.test`);
      uB = await seedUser(direct, B.companyId, `socb-u1-${B.slug}@x.test`);

      const mkEmp = async (companyId: string, userId: string) =>
        (
          await direct.query(
            `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
            [companyId, userId],
          )
        ).rows[0].id as string;
      empA = await mkEmp(A.companyId, uA);
      empA2 = await mkEmp(A.companyId, uA2);
      empB = await mkEmp(B.companyId, uB);

      groupAName = `Nhóm nền ${randomUUID().slice(0, 8)}`;
      groupA = (
        await direct.query(
          `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'private') RETURNING id`,
          [A.companyId, groupAName],
        )
      ).rows[0].id as string;
      groupB = (
        await direct.query(
          `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'public') RETURNING id`,
          [B.companyId, `Nhóm của B ${randomUUID().slice(0, 8)}`],
        )
      ).rows[0].id as string;

      // Thành viên nền (uA, owner) — ca trùng PK tổ hợp đo ngược vào hàng NÀY.
      await direct.query(
        `INSERT INTO feed_group_members (company_id, group_id, user_id, employee_id, role, status, joined_at)
         VALUES ($1, $2, $3, $4, 'owner', 'active', now())`,
        [A.companyId, groupA, uA, empA],
      );

      const postPollA = await mkPost(A.companyId, uA, "poll");
      const postPollMultiA = await mkPost(A.companyId, uA, "poll");
      const postIdeaA = await mkPost(A.companyId, uA, "idea");
      const postKudosA = await mkPost(A.companyId, uA, "kudos");
      postSparePollA = await mkPost(A.companyId, uA, "poll");
      postSpareIdeaA = await mkPost(A.companyId, uA, "idea");
      postSpareKudosA = await mkPost(A.companyId, uA, "kudos");

      const mkPoll = async (postId: string, multiple: boolean) =>
        (
          await direct.query(
            `INSERT INTO feed_polls (company_id, post_id, question, multiple_choice)
           VALUES ($1, $2, 'Chọn phương án?', $3) RETURNING id`,
            [A.companyId, postId, multiple],
          )
        ).rows[0].id as string;
      const mkOption = async (pollId: string, position: number) =>
        (
          await direct.query(
            `INSERT INTO feed_poll_options (company_id, poll_id, label, position)
           VALUES ($1, $2, $3, $4) RETURNING id`,
            [A.companyId, pollId, `Phương án ${position}`, position],
          )
        ).rows[0].id as string;

      pollA = await mkPoll(postPollA, false);
      optA1 = await mkOption(pollA, 1);
      optA2 = await mkOption(pollA, 2);
      pollMultiA = await mkPoll(postPollMultiA, true);
      optM1 = await mkOption(pollMultiA, 1);
      optM2 = await mkOption(pollMultiA, 2);

      ideaA = (
        await direct.query(
          `INSERT INTO feed_ideas (company_id, post_id, status) VALUES ($1, $2, 'submitted') RETURNING id`,
          [A.companyId, postIdeaA],
        )
      ).rows[0].id as string;
      kudosA = (
        await direct.query(
          `INSERT INTO feed_kudos (company_id, post_id, message) VALUES ($1, $2, 'cảm ơn đồng đội') RETURNING id`,
          [A.companyId, postKudosA],
        )
      ).rows[0].id as string;
      await direct.query(
        `INSERT INTO feed_kudos_recipients (company_id, kudos_id, employee_id) VALUES ($1, $2, $3)`,
        [A.companyId, kudosA, empA],
      );

      badgeACode = `nen-${randomUUID().slice(0, 8)}`;
      await direct.query(
        `INSERT INTO feed_kudos_badges (company_id, code, name, position) VALUES ($1, $2, 'Huy hiệu nền', 1)`,
        [A.companyId, badgeACode],
      );
      badgeBId = (
        await direct.query(
          `INSERT INTO feed_kudos_badges (company_id, code, name, position)
         VALUES ($1, $2, 'Huy hiệu của B', 1) RETURNING id`,
          [B.companyId, `nen-${randomUUID().slice(0, 8)}`],
        )
      ).rows[0].id as string;
    }, 60_000);

    afterAll(async () => {
      await cleanupTenants(
        direct,
        [A?.companyId, B?.companyId, C?.companyId].filter(Boolean) as string[],
      );
      await direct.end();
      await app.end();
      await worker.end();
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 1 — RLS cô lập 2 tenant: CẢ vế ĐỌC lẫn vế GHI (`WITH CHECK`). Vế ghi không có ca nào khác
    //          chứng minh: mọi ca FK chéo tenant đi qua `direct` (owner) = bypass RLS.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 1 · RLS đọc + ghi trên 9 bảng Track B", () => {
      it("KHÔNG có GUC ⇒ 0 hàng trên CẢ 9 bảng (app role, FORCE RLS)", async () => {
        await withRole(app, null, async (c) => {
          for (const t of TRACK_B_TABLES) {
            const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
            expect({ table: t, n: r.rows[0].n }).toEqual({ table: t, n: 0 });
          }
        });
      });

      it("GUC = A ⇒ thấy nhóm/huy hiệu của A, KHÔNG thấy của B (vế ĐỌC, 2 tenant)", async () => {
        await withRole(app, A.companyId, async (c) => {
          const mine = await c.query(`SELECT count(*)::int AS n FROM feed_groups WHERE id = $1`, [
            groupA,
          ]);
          const theirs = await c.query(`SELECT count(*)::int AS n FROM feed_groups WHERE id = $1`, [
            groupB,
          ]);
          expect({ mine: mine.rows[0].n, theirs: theirs.rows[0].n }).toEqual({
            mine: 1,
            theirs: 0,
          });

          // Huy hiệu là CATALOG per-company (không global) — hàng của B phải vô hình với A.
          const badge = await c.query(
            `SELECT count(*)::int AS n FROM feed_kudos_badges WHERE id = $1`,
            [badgeBId],
          );
          expect(badge.rows[0].n).toBe(0);
        });
      });

      it("GUC = B ⇒ KHÔNG thấy phiếu/thành viên/kudos của A (cô lập chiều ngược lại)", async () => {
        await withRole(app, B.companyId, async (c) => {
          for (const [table, sql, param] of [
            [
              "feed_group_members",
              `SELECT count(*)::int AS n FROM feed_group_members WHERE group_id = $1`,
              groupA,
            ],
            ["feed_polls", `SELECT count(*)::int AS n FROM feed_polls WHERE id = $1`, pollA],
            ["feed_kudos", `SELECT count(*)::int AS n FROM feed_kudos WHERE id = $1`, kudosA],
          ] as const) {
            const r = await c.query(sql, [param]);
            expect({ table, n: r.rows[0].n }).toEqual({ table, n: 0 });
          }
        });
      });

      it("GUC = A mà INSERT company_id = B ⇒ 42501 row-level security (vế GHI `WITH CHECK`)", async () => {
        const r = await attempt(
          A.companyId,
          `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'public')`,
          [B.companyId, `ghi xuyên tenant ${randomUUID().slice(0, 8)}`],
        );
        expect(r.code).toBe("42501");
        expect(r.message ?? "").toMatch(/row-level security/i);
      });

      it("company_id để DB tự điền từ GUC ⇒ rơi đúng tenant A (DEFAULT literal-GUC còn sống)", async () => {
        await withRole(app, A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO feed_groups (name, visibility) VALUES ($1, 'public') RETURNING company_id`,
            [`không truyền company_id ${randomUUID().slice(0, 8)}`],
          );
          expect(r.rows[0].company_id).toBe(A.companyId);
        });
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 2 — CHECK từng giá trị + ĐỐI CHỨNG. Mỗi ca DENY dựng sao cho vi phạm ĐÚNG MỘT CHECK
    //          (điền sẵn các cột của CHECK khác) — PG chọn TUỲ Ý khi nhiều CHECK cùng vỡ.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 2 · CHECK (mỗi DENY kèm ALLOW đối chứng)", () => {
      it("feed_groups.visibility lạ ⇒ 23514 chk_feed_groups_visibility; 'public'/'private' ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'secret')`,
          [A.companyId, `nhóm bí mật ${randomUUID().slice(0, 8)}`],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_groups_visibility");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'public')`,
          [A.companyId, `nhóm công khai ${randomUUID().slice(0, 8)}`],
        );
        expect(allow.code).toBeNull();
      });

      it("member_count âm ⇒ 23514 chk_feed_groups_member_count; 0 ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_groups (company_id, name, visibility, member_count) VALUES ($1, $2, 'public', -1)`,
          [A.companyId, `nhóm âm ${randomUUID().slice(0, 8)}`],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_groups_member_count");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_groups (company_id, name, visibility, member_count) VALUES ($1, $2, 'public', 0)`,
          [A.companyId, `nhóm rỗng ${randomUUID().slice(0, 8)}`],
        );
        expect(allow.code).toBeNull();
      });

      it("vai trò lạ ⇒ 23514 chk_feed_group_members_role; 'admin' + active ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'guest', 'active')`,
          [A.companyId, groupA, uA2],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_group_members_role");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'admin', 'active')`,
          [A.companyId, groupA, uA2],
        );
        expect(allow.code).toBeNull();
      });

      it("trạng thái 'removed' ⇒ 23514 chk_feed_group_members_status (rời nhóm là DELETE cứng, SOC-DEC-006)", async () => {
        // `role='member'` để `chk_feed_group_members_pending_role` KHÔNG cùng vỡ ⇒ ghim đúng tên CHECK.
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'member', 'removed')`,
          [A.companyId, groupA, uA2],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_group_members_status");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'member', 'pending')`,
          [A.companyId, groupA, uA2],
        );
        expect(allow.code).toBeNull();
      });

      it("pending + admin ⇒ 23514 chk_feed_group_members_pending_role; pending + member ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'admin', 'pending')`,
          [A.companyId, groupA, uA2],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_group_members_pending_role");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'member', 'pending')`,
          [A.companyId, groupA, uA2],
        );
        expect(allow.code).toBeNull();
      });

      it("poll status lạ ⇒ 23514 chk_feed_polls_status; 'open' ⇒ OK", async () => {
        // `closed_at` điền sẵn để `chk_feed_polls_closed_pair` không cùng vỡ.
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_polls (company_id, post_id, question, status, closed_at)
         VALUES ($1, $2, 'nháp?', 'draft', now())`,
          [A.companyId, postSparePollA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_polls_status");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_polls (company_id, post_id, question, status) VALUES ($1, $2, 'mở?', 'open')`,
          [A.companyId, postSparePollA],
        );
        expect(allow.code).toBeNull();
      });

      it("closed mà thiếu closed_at ⇒ 23514 chk_feed_polls_closed_pair; đủ cặp ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_polls (company_id, post_id, question, status) VALUES ($1, $2, 'đã đóng?', 'closed')`,
          [A.companyId, postSparePollA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_polls_closed_pair");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_polls (company_id, post_id, question, status, closed_at)
         VALUES ($1, $2, 'đã đóng?', 'closed', now())`,
          [A.companyId, postSparePollA],
        );
        expect(allow.code).toBeNull();
      });

      it("closes_at TRƯỚC created_at ⇒ 23514 chk_feed_polls_closes_future; NULL và tương lai ⇒ OK", async () => {
        // Lưới cuối chống ghi tay/lỗi giờ máy chủ. Zod KHÔNG mirror được (created_at do DB sinh trong
        // cùng câu INSERT) — ngoại lệ mirror thứ hai, ghim ở `contracts/social.spec.ts`.
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_polls (company_id, post_id, question, closes_at)
         VALUES ($1, $2, 'hạn quá khứ?', now() - interval '1 day')`,
          [A.companyId, postSparePollA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_polls_closes_future");

        // ĐỐI CHỨNG DƯƠNG cho CẢ HAI nhánh của CHECK — nhánh `IS NULL OR` là nhánh hợp lệ thật
        // (bình chọn không hạn), KHÔNG phải vế thoát làm CHECK rỗng nghĩa.
        const allowNull = await attempt(
          A.companyId,
          `INSERT INTO feed_polls (company_id, post_id, question) VALUES ($1, $2, 'không hạn?')`,
          [A.companyId, postSparePollA],
        );
        expect(allowNull.code).toBeNull();

        const allowFuture = await attempt(
          A.companyId,
          `INSERT INTO feed_polls (company_id, post_id, question, closes_at)
         VALUES ($1, $2, 'hạn tương lai?', now() + interval '1 day')`,
          [A.companyId, postSparePollA],
        );
        expect(allowFuture.code).toBeNull();
      });

      it("vote_count âm ⇒ 23514 chk_feed_poll_options_vote_count; 0 ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_poll_options (company_id, poll_id, label, position, vote_count)
         VALUES ($1, $2, 'âm', 9, -1)`,
          [A.companyId, pollA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_poll_options_vote_count");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_poll_options (company_id, poll_id, label, position, vote_count)
         VALUES ($1, $2, 'không', 9, 0)`,
          [A.companyId, pollA],
        );
        expect(allow.code).toBeNull();
      });

      it("idea status lạ ⇒ 23514 chk_feed_ideas_status; 'submitted' ⇒ OK", async () => {
        // reviewed_by/at điền sẵn ⇒ `chk_feed_ideas_reviewed_pair` không cùng vỡ.
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_ideas (company_id, post_id, status, reviewed_by, reviewed_at)
         VALUES ($1, $2, 'draft', $3, now())`,
          [A.companyId, postSpareIdeaA, uA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_ideas_status");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_ideas (company_id, post_id, status) VALUES ($1, $2, 'submitted')`,
          [A.companyId, postSpareIdeaA],
        );
        expect(allow.code).toBeNull();
      });

      it("accepted mà thiếu người/mốc duyệt ⇒ 23514 chk_feed_ideas_reviewed_pair; đủ cặp ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_ideas (company_id, post_id, status) VALUES ($1, $2, 'accepted')`,
          [A.companyId, postSpareIdeaA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_ideas_reviewed_pair");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_ideas (company_id, post_id, status, reviewed_by, reviewed_at)
         VALUES ($1, $2, 'accepted', $3, now())`,
          [A.companyId, postSpareIdeaA, uA],
        );
        expect(allow.code).toBeNull();
      });

      it("rejected KHÔNG có review_note (kể cả khoảng trắng) ⇒ 23514 chk_feed_ideas_reject_note; có lý do ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_ideas (company_id, post_id, status, reviewed_by, reviewed_at)
         VALUES ($1, $2, 'rejected', $3, now())`,
          [A.companyId, postSpareIdeaA, uA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_ideas_reject_note");

        // Vế `length(btrim(review_note)) > 0` không phải trang trí.
        const denyBlank = await attempt(
          A.companyId,
          `INSERT INTO feed_ideas (company_id, post_id, status, reviewed_by, reviewed_at, review_note)
         VALUES ($1, $2, 'rejected', $3, now(), '    ')`,
          [A.companyId, postSpareIdeaA, uA],
        );
        expect(denyBlank.code).toBe("23514");
        expect(denyBlank.constraint).toBe("chk_feed_ideas_reject_note");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_ideas (company_id, post_id, status, reviewed_by, reviewed_at, review_note)
         VALUES ($1, $2, 'rejected', $3, now(), 'trùng sáng kiến đã triển khai')`,
          [A.companyId, postSpareIdeaA, uA],
        );
        expect(allow.code).toBeNull();
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 3 — RÀNG BUỘC CHỐNG TRÙNG. Phân biệt ĐÚNG `contype`: viết `'u'` trơn sẽ hoặc đỏ oan với PK
    //          tổ hợp, hoặc đẻ một UNIQUE trùng PK (bẫy đã gặp ở DB-1 §7.6).
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 3 · UNIQUE / PRIMARY KEY (catalog đúng contype + vi phạm THẬT)", () => {
      it("catalog: đúng tập ràng buộc nhiều-cột, PK tổ hợp là contype='p' — KHÔNG phải UNIQUE", async () => {
        // So theo BẢN ĐỒ (key = conname) chứ không theo mảng có thứ tự: thứ tự `ORDER BY` phụ thuộc
        // collation của DB (dấu `_` được bỏ qua ở một số collation) ⇒ mảng có thứ tự là ca đỏ-giả.
        // Lọc `>= 2 cột` để KHÔNG phải đoán tên PK một-cột (`id`) do PG tự đặt.
        const r = await direct.query(
          `SELECT c.conname::text AS name, c.conrelid::regclass::text AS tbl, c.contype::text AS t,
                (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) AS cols
           FROM pg_constraint c
          WHERE c.contype IN ('p', 'u') AND c.conrelid::regclass::text = ANY ($1::text[])
            AND array_length(c.conkey, 1) >= 2`,
          [[...TRACK_B_TABLES]],
        );
        const actual = Object.fromEntries(
          r.rows.map((row) => [row.name, { tbl: row.tbl, t: row.t, cols: row.cols }]),
        );
        expect(actual).toEqual({
          feed_group_members_pk: {
            tbl: "feed_group_members",
            t: "p",
            cols: ["company_id", "group_id", "user_id"],
          },
          feed_poll_votes_pk: {
            tbl: "feed_poll_votes",
            t: "p",
            cols: ["company_id", "option_id", "poll_id", "user_id"],
          },
          feed_kudos_recipients_pk: {
            tbl: "feed_kudos_recipients",
            t: "p",
            cols: ["company_id", "employee_id", "kudos_id"],
          },
          feed_groups_company_id_id_uq: {
            tbl: "feed_groups",
            t: "u",
            cols: ["company_id", "id"],
          },
          feed_polls_company_id_id_uq: { tbl: "feed_polls", t: "u", cols: ["company_id", "id"] },
          feed_polls_company_post_uq: {
            tbl: "feed_polls",
            t: "u",
            cols: ["company_id", "post_id"],
          },
          feed_poll_options_company_id_id_uq: {
            tbl: "feed_poll_options",
            t: "u",
            cols: ["company_id", "id"],
          },
          feed_poll_options_position_uq: {
            tbl: "feed_poll_options",
            t: "u",
            cols: ["company_id", "poll_id", "position"],
          },
          feed_ideas_company_id_id_uq: { tbl: "feed_ideas", t: "u", cols: ["company_id", "id"] },
          feed_ideas_company_post_uq: {
            tbl: "feed_ideas",
            t: "u",
            cols: ["company_id", "post_id"],
          },
          feed_kudos_company_id_id_uq: { tbl: "feed_kudos", t: "u", cols: ["company_id", "id"] },
          feed_kudos_company_post_uq: {
            tbl: "feed_kudos",
            t: "u",
            cols: ["company_id", "post_id"],
          },
          feed_kudos_badges_company_id_id_uq: {
            tbl: "feed_kudos_badges",
            t: "u",
            cols: ["company_id", "id"],
          },
          feed_kudos_badges_company_code_uq: {
            tbl: "feed_kudos_badges",
            t: "u",
            cols: ["code", "company_id"],
          },
        });
      });

      it("3 bảng PK tổ hợp KHÔNG có UNIQUE trùng PK (index thừa = ghi chậm không lý do)", async () => {
        const r = await direct.query(
          `SELECT count(*)::int AS n FROM pg_constraint c
          WHERE c.contype = 'u' AND c.conrelid::regclass::text = ANY ($1::text[])`,
          [["feed_group_members", "feed_poll_votes", "feed_kudos_recipients"]],
        );
        expect(r.rows[0].n).toBe(0);
      });

      it("thành viên ĐÔI cùng (group,user) ⇒ 23505 feed_group_members_pk; user KHÁC ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'member', 'active')`,
          [A.companyId, groupA, uA],
        );
        expect(deny.code).toBe("23505");
        expect(deny.constraint).toBe("feed_group_members_pk");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'member', 'active')`,
          [A.companyId, groupA, uA2],
        );
        expect(allow.code).toBeNull();
      });

      it("1-1 bài↔poll/idea/kudos: bài đã có ⇒ 23505 đúng *_company_post_uq; bài khác ⇒ OK", async () => {
        const cases = [
          [
            "feed_polls_company_post_uq",
            `INSERT INTO feed_polls (company_id, post_id, question) VALUES ($1, $2, 'poll thứ hai?')`,
            (await direct.query(`SELECT post_id FROM feed_polls WHERE id = $1`, [pollA])).rows[0]
              .post_id as string,
            postSparePollA,
          ],
          [
            "feed_ideas_company_post_uq",
            `INSERT INTO feed_ideas (company_id, post_id, status) VALUES ($1, $2, 'submitted')`,
            (await direct.query(`SELECT post_id FROM feed_ideas WHERE id = $1`, [ideaA])).rows[0]
              .post_id as string,
            postSpareIdeaA,
          ],
          [
            "feed_kudos_company_post_uq",
            `INSERT INTO feed_kudos (company_id, post_id, message) VALUES ($1, $2, 'kudos thứ hai')`,
            (await direct.query(`SELECT post_id FROM feed_kudos WHERE id = $1`, [kudosA])).rows[0]
              .post_id as string,
            postSpareKudosA,
          ],
        ] as const;

        for (const [conname, sql, takenPost, freePost] of cases) {
          const deny = await attempt(A.companyId, sql, [A.companyId, takenPost]);
          expect({ conname, code: deny.code, constraint: deny.constraint }).toEqual({
            conname,
            code: "23505",
            constraint: conname,
          });

          const allow = await attempt(A.companyId, sql, [A.companyId, freePost]);
          expect({ conname, code: allow.code }).toEqual({ conname, code: null });
        }
      });

      it("hai lựa chọn cùng position ⇒ 23505 feed_poll_options_position_uq; position khác ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_poll_options (company_id, poll_id, label, position) VALUES ($1, $2, 'trùng', 1)`,
          [A.companyId, pollA],
        );
        expect(deny.code).toBe("23505");
        expect(deny.constraint).toBe("feed_poll_options_position_uq");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_poll_options (company_id, poll_id, label, position) VALUES ($1, $2, 'mới', 7)`,
          [A.companyId, pollA],
        );
        expect(allow.code).toBeNull();
      });

      it("phiếu ĐÔI cùng (poll,option,user) ⇒ 23505 feed_poll_votes_pk; option khác ⇒ OK", async () => {
        const dupVote: [string, unknown[]] = [
          `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
         VALUES ($1, $2, $3, $4, false)`,
          [A.companyId, pollMultiA, optM1, uA],
        ];
        const deny = await attemptSeq(A.companyId, [dupVote, dupVote]);
        expect(deny.code).toBe("23505");
        expect(deny.constraint).toBe("feed_poll_votes_pk");

        // ĐỐI CHỨNG DƯƠNG: `single_choice=false` ⇒ partial unique KHÔNG áp, hai lựa chọn khác nhau lọt.
        const allow = await attemptSeq(A.companyId, [
          dupVote,
          [
            `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
           VALUES ($1, $2, $3, $4, false)`,
            [A.companyId, pollMultiA, optM2, uA],
          ],
        ]);
        expect(allow.code).toBeNull();
      });

      it("người nhận kudos ĐÔI ⇒ 23505 feed_kudos_recipients_pk; nhân viên khác ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_kudos_recipients (company_id, kudos_id, employee_id) VALUES ($1, $2, $3)`,
          [A.companyId, kudosA, empA],
        );
        expect(deny.code).toBe("23505");
        expect(deny.constraint).toBe("feed_kudos_recipients_pk");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_kudos_recipients (company_id, kudos_id, employee_id) VALUES ($1, $2, $3)`,
          [A.companyId, kudosA, empA2],
        );
        expect(allow.code).toBeNull();
      });

      it("mã huy hiệu trùng trong CÙNG công ty ⇒ 23505 feed_kudos_badges_company_code_uq; mã khác ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_kudos_badges (company_id, code, name, position) VALUES ($1, $2, 'trùng mã', 2)`,
          [A.companyId, badgeACode],
        );
        expect(deny.code).toBe("23505");
        expect(deny.constraint).toBe("feed_kudos_badges_company_code_uq");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_kudos_badges (company_id, code, name, position) VALUES ($1, $2, 'mã khác', 2)`,
          [A.companyId, `khac-${randomUUID().slice(0, 8)}`],
        );
        expect(allow.code).toBeNull();
      });

      it("`feed_groups_company_name_uq` là partial unique INDEX (KHÔNG ở pg_constraint) + predicate ĐÚNG CHUỖI", async () => {
        const con = await direct.query(
          `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'feed_groups_company_name_uq'`,
        );
        expect(con.rows[0].n).toBe(0);

        const idx = await direct.query(
          `SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid) AS pred,
                pg_get_expr(i.indexprs, i.indrelid) AS exprs
           FROM pg_index i WHERE i.indexrelid = 'feed_groups_company_name_uq'::regclass`,
        );
        expect(idx.rows[0].indisunique).toBe(true);
        // So ĐÚNG CHUỖI, KHÔNG `ILIKE '%WHERE%'`: một predicate khác vẫn chứa chữ WHERE.
        expect(idx.rows[0].pred).toBe("(deleted_at IS NULL)");
        // Khoá theo `lower(name)` — trùng tên khác hoa/thường PHẢI chặn (vế đo THẬT ở ca dưới).
        expect(idx.rows[0].exprs).toBe("lower((name)::text)");
      });

      it("trùng tên nhóm khác HOA/thường ⇒ 23505 feed_groups_company_name_uq; nhóm cũ đã xoá mềm ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'public')`,
          [A.companyId, groupAName.toUpperCase()],
        );
        expect(deny.code).toBe("23505");
        expect(deny.constraint).toBe("feed_groups_company_name_uq");

        // ĐỐI CHỨNG DƯƠNG cho PREDICATE: nhóm cũ xoá mềm ⇒ tên được dùng lại. Bỏ `WHERE deleted_at IS
        // NULL` khỏi index thì ca này ĐỎ — đó là điều ta muốn.
        const allow = await attemptSeq(A.companyId, [
          [`UPDATE feed_groups SET deleted_at = now() WHERE id = $1`, [groupA]],
          [
            `INSERT INTO feed_groups (company_id, name, visibility) VALUES ($1, $2, 'public')`,
            [A.companyId, groupAName],
          ],
        ]);
        expect(allow.code).toBeNull();
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 4 — Partial unique một-phiếu (D1 phương án A). Đây là lớp phòng thủ DB DUY NHẤT chống phiếu
    //          đôi ở bình chọn một-lựa-chọn; phương án B phó thác 100% cho row-lock của service.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 4 · feed_poll_votes_single_uq (chống phiếu đôi)", () => {
      it("single_choice=true: 2 lựa chọn khác nhau cùng (poll,user) ⇒ 23505 feed_poll_votes_single_uq", async () => {
        const r = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
           VALUES ($1, $2, $3, $4, true)`,
            [A.companyId, pollA, optA1, uA],
          ],
          [
            `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
           VALUES ($1, $2, $3, $4, true)`,
            [A.companyId, pollA, optA2, uA],
          ],
        ]);
        expect(r.code).toBe("23505");
        expect(r.constraint).toBe("feed_poll_votes_single_uq");
      });

      it("ĐỐI CHỨNG DƯƠNG: single_choice=false (poll multiple_choice) ⇒ 2 lựa chọn LỌT", async () => {
        // Nếu ai đó bỏ predicate `WHERE single_choice` khỏi index thì ca này ĐỎ — đó là điều ta muốn.
        const r = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
           VALUES ($1, $2, $3, $4, false)`,
            [A.companyId, pollMultiA, optM1, uA],
          ],
          [
            `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
           VALUES ($1, $2, $3, $4, false)`,
            [A.companyId, pollMultiA, optM2, uA],
          ],
        ]);
        expect(r.code).toBeNull();
      });

      it("single_choice KHÔNG có DEFAULT: quên truyền ⇒ 23502 (fail-closed CÓ CHỦ Ý, plan §6.1)", async () => {
        // `DEFAULT false` sẽ biến một lần quên ghi của BE-2 thành VÔ HIỆU HOÁ chốt chống-phiếu-đôi IM
        // LẶNG. Không DEFAULT ⇒ hỏng thì hỏng ỒN ÀO. Ca này ghim quyết định đó.
        const r = await attempt(
          A.companyId,
          `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id)
         VALUES ($1, $2, $3, $4)`,
          [A.companyId, pollA, optA1, uA],
        );
        expect(r.code).toBe("23502");
        expect(r.message ?? "").toMatch(/single_choice/);
      });

      it("hai NGƯỜI khác nhau cùng bình chọn một-lựa-chọn ⇒ OK (index khoá theo user, không theo poll)", async () => {
        const r = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
           VALUES ($1, $2, $3, $4, true)`,
            [A.companyId, pollA, optA1, uA],
          ],
          [
            `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
           VALUES ($1, $2, $3, $4, true)`,
            [A.companyId, pollA, optA1, uA2],
          ],
        ]);
        expect(r.code).toBeNull();
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 5 — GRANT đo bằng LỆNH THẬT, không chỉ đọc catalog: ACL đúng mà ai đó cấp qua role khác thì
    //          catalog-check vẫn xanh (`measuring-a-gate-needs-a-real-violation`).
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 5 · GRANT: thiếu DELETE / thiếu UPDATE (lệnh THẬT dưới app role)", () => {
      const NO_DELETE: Array<[string, string]> = [
        ["feed_groups", "name = name"],
        ["feed_polls", "question = question"],
        ["feed_poll_options", "label = label"],
        ["feed_ideas", "status = status"],
        ["feed_kudos", "message = message"],
        ["feed_kudos_badges", "name = name"],
      ];

      it("6 bảng soft-delete/catalog: DELETE ⇒ 42501, nhưng UPDATE ⇒ OK (không phải read-only)", async () => {
        for (const [table, setExpr] of NO_DELETE) {
          const del = await attempt(A.companyId, `DELETE FROM ${table}`);
          expect({ table, code: del.code }).toEqual({ table, code: "42501" });

          const upd = await attempt(A.companyId, `UPDATE ${table} SET ${setExpr}`);
          expect({ table, code: upd.code }).toEqual({ table, code: null });
        }
      });

      it("feed_group_members: DELETE THÀNH CÔNG (rời/mời-ra-nhóm là xoá cứng — SOC-DEC-006)", async () => {
        const del = await attempt(
          A.companyId,
          `DELETE FROM feed_group_members WHERE group_id = $1`,
          [groupA],
        );
        expect(del.code).toBeNull();
      });

      it("feed_poll_votes & feed_kudos_recipients: DELETE OK nhưng UPDATE ⇒ 42501 (KHÔNG có GRANT UPDATE)", async () => {
        for (const [table, setExpr] of [
          ["feed_poll_votes", "created_at = now()"],
          ["feed_kudos_recipients", "employee_id = employee_id"],
        ] as const) {
          const del = await attempt(A.companyId, `DELETE FROM ${table}`);
          expect({ table, code: del.code }).toEqual({ table, code: null });

          const upd = await attempt(A.companyId, `UPDATE ${table} SET ${setExpr}`);
          expect({ table, code: upd.code }).toEqual({ table, code: "42501" });
        }
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 6 — Composite FK chặn chéo tenant. Đi qua `direct` (owner, rolbypassrls) CÓ CHỦ Ý: qua app
    //          pool thì RLS chặn TRƯỚC và ca sẽ chứng minh RLS chứ không chứng minh FK.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 6 · composite tenant-FK chặn tham chiếu chéo tenant", () => {
      it("thành viên của A trỏ user của B ⇒ 23503 feed_group_members_user_tenant_fk; cùng tenant ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'member', 'active')`,
          [A.companyId, groupA, uB],
          direct,
        );
        expect(deny.code).toBe("23503");
        expect(deny.constraint).toBe("feed_group_members_user_tenant_fk");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'member', 'active')`,
          [A.companyId, groupA, uA2],
          direct,
        );
        expect(allow.code).toBeNull();
      });

      it("thành viên của A trỏ NHÓM của B ⇒ 23503 feed_group_members_group_tenant_fk", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_group_members (company_id, group_id, user_id, role, status)
         VALUES ($1, $2, $3, 'member', 'active')`,
          [A.companyId, groupB, uA2],
          direct,
        );
        expect(deny.code).toBe("23503");
        expect(deny.constraint).toBe("feed_group_members_group_tenant_fk");
      });

      it("phiếu của A trỏ user của B ⇒ 23503 feed_poll_votes_user_tenant_fk; cùng tenant ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
         VALUES ($1, $2, $3, $4, true)`,
          [A.companyId, pollA, optA1, uB],
          direct,
        );
        expect(deny.code).toBe("23503");
        expect(deny.constraint).toBe("feed_poll_votes_user_tenant_fk");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
         VALUES ($1, $2, $3, $4, true)`,
          [A.companyId, pollA, optA1, uA2],
          direct,
        );
        expect(allow.code).toBeNull();
      });

      it("người nhận kudos của A là nhân viên của B ⇒ 23503 feed_kudos_recipients_employee_tenant_fk; cùng tenant ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_kudos_recipients (company_id, kudos_id, employee_id) VALUES ($1, $2, $3)`,
          [A.companyId, kudosA, empB],
          direct,
        );
        expect(deny.code).toBe("23503");
        expect(deny.constraint).toBe("feed_kudos_recipients_employee_tenant_fk");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_kudos_recipients (company_id, kudos_id, employee_id) VALUES ($1, $2, $3)`,
          [A.companyId, kudosA, empA2],
          direct,
        );
        expect(allow.code).toBeNull();
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 9 — ACL của `mediaos_worker`: ĐÚNG {SELECT} trên 3 bảng bình chọn (job đóng bình chọn theo
    //          hạn — DB-17 §4.3), 0 ACL trên 6 bảng còn lại.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 9 · ACL worker", () => {
      it("mediaos_worker: ĐÚNG {SELECT} trên feed_polls/_poll_options/_poll_votes, 0 ACL trên 6 bảng còn lại", async () => {
        const r = await direct.query(
          `SELECT c.relname::text AS tbl,
                array_agg(x.privilege_type ORDER BY x.privilege_type) AS privs
           FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE c.relname = ANY ($1::text[]) AND x.grantee = 'mediaos_worker'::regrole
          GROUP BY c.relname`,
          [[...TRACK_B_TABLES]],
        );
        const actual = Object.fromEntries(r.rows.map((row) => [row.tbl, row.privs]));
        expect(actual).toEqual({
          feed_polls: ["SELECT"],
          feed_poll_options: ["SELECT"],
          feed_poll_votes: ["SELECT"],
        });
      });

      it("ĐO THẬT: worker ĐỌC được bình chọn của A, nhưng GHI ⇒ 42501 và bảng nhóm ⇒ 42501", async () => {
        await withRole(worker, A.companyId, async (c) => {
          const q = await c.query(`SELECT count(*)::int AS n FROM feed_polls WHERE id = $1`, [
            pollA,
          ]);
          expect(q.rows[0].n).toBe(1);
        });

        const write = await attempt(
          A.companyId,
          `UPDATE feed_polls SET status = 'closed', closed_at = now() WHERE id = $1`,
          [pollA],
          worker,
        );
        expect(write.code).toBe("42501");

        const other = await attempt(A.companyId, `SELECT count(*) FROM feed_groups`, [], worker);
        expect(other.code).toBe("42501");
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 10 — Idempotency. CHẠY TRONG TX REPEATABLE READ RỒI ROLLBACK, CÓ CHỦ Ý:
    //   · `0582` là NO-OP lúc migrate (0 company trên mọi lane DB/CI — plan §3) nên lần phát lại ĐẦU
    //     TIÊN thật sự CHÈN. So "trước lần 1" với "sau lần 1" sẽ là ĐỎ OAN; phép đo đúng của tính
    //     idempotent là "sau lần 1" == "sau lần 2".
    //   · REPEATABLE READ giữ MỘT ảnh chụp cho cả khối: một spec chạy song song tạo company mới giữa
    //     chừng sẽ không làm đẳng thức `5 × count(companies)` trong verify của `0582` vỡ (đỏ-giả).
    //   · ROLLBACK ⇒ KHÔNG rác sang tenant của spec khác (`fresh-lane-db-exposes-teardown-ri-race`).
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 10 · idempotency migration", () => {
      it("0581 + 0582 phát lại 2 lần ⇒ 0 exception; NOTI KHÔNG đổi, huy hiệu ổn định từ lần 2", async () => {
        const NOTI_COUNTS = `
        SELECT
          (SELECT count(*)::int FROM notification_events WHERE module_code = 'SOCIAL')            AS ev,
          (SELECT count(*)::int FROM notification_templates t
             JOIN notification_events e ON e.id = t.event_id
            WHERE e.module_code = 'SOCIAL')                                                       AS tpl,
          (SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), '|' ORDER BY conname)
             FROM pg_constraint
            WHERE conname IN ('chk_notification_events_module_code', 'chk_notification_events_type',
                              'chk_notifications_module_code', 'chk_notifications_notification_type')) AS defs`;
        const BADGE_COUNT = `
        SELECT count(*)::int AS n
          FROM feed_kudos_badges b
          JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
         WHERE b.code = ANY ($1::text[])`;

        await withRole(direct, null, async (c) => {
          await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
          const noti0 = (await c.query(NOTI_COUNTS)).rows[0];

          await runMigrationFile(c, "0581_s16socialdb2_noti_track_b.sql");
          await runMigrationFile(c, "0582_s16socialdb2_seed_kudos_badges.sql");
          const noti1 = (await c.query(NOTI_COUNTS)).rows[0];
          const badges1 = (await c.query(BADGE_COUNT, [[...SYSTEM_BADGES]])).rows[0].n as number;

          await runMigrationFile(c, "0581_s16socialdb2_noti_track_b.sql");
          await runMigrationFile(c, "0582_s16socialdb2_seed_kudos_badges.sql");
          const noti2 = (await c.query(NOTI_COUNTS)).rows[0];
          const badges2 = (await c.query(BADGE_COUNT, [[...SYSTEM_BADGES]])).rows[0].n as number;

          // `0581` đã áp lúc migrate ⇒ phát lại KHÔNG được đổi gì, kể cả định nghĩa 4 CHECK.
          expect(noti1).toEqual(noti0);
          expect(noti2).toEqual(noti0);
          // Chống ca RỖNG NGHĨA (`empty-success-is-the-fail-open-shape`): 0 == 0 không chứng minh gì.
          expect(noti0.ev).toBeGreaterThan(0);
          expect(badges1).toBeGreaterThan(0);
          expect(badges2).toBe(badges1);
        });
      }, 120_000);

      it("0580 phát lại PHẢI RAISE (tiền-kiểm to_regclass fail-loud) — tính năng, KHÔNG phải lỗi", async () => {
        // DDL KHÔNG idempotent, và CỐ Ý như vậy: đụng tên = một lane khác đang dựng song song ⇒ DỪNG.
        // Chỉ chạy khối tiền-kiểm (đoạn đầu file), trong tx rollback — khuôn DB-1 cho `0577`.
        const sql = readFileSync(
          path.join(MIGRATIONS_DIR, "0580_s16socialdb2_feed_track_b_ddl.sql"),
          "utf8",
        );
        const precheck = sql.split("--> statement-breakpoint")[0];
        const r = await withRole(direct, null, async (c) => {
          try {
            await c.query(precheck);
            return { code: null as string | null, message: "" };
          } catch (e) {
            const err = e as { code?: string; message?: string };
            return { code: err.code ?? "UNKNOWN", message: err.message ?? "" };
          }
        });
        expect(r.code).toBe("P0001");
        expect(r.message).toMatch(/DA TON TAI/);
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 12 — HỒI QUY VĨNH VIỄN (5 ca). Không có nhóm này, một WO sau `GRANT DELETE ON feed_groups`,
    //           tắt FORCE, đổi `SET NULL (col)` thành `SET NULL` trần, hay bỏ một composite FK sẽ
    //           KHÔNG có gì đỏ — verify của migration chỉ chạy MỘT lần, spec này chạy MÃI.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 12 · hồi quy vĩnh viễn (RLS · FK · ACL · DEFAULT · ACL cột)", () => {
      it("(a) RLS ENABLE + FORCE + policy tenant_isolation (USING và WITH CHECK) trên cả 9 bảng", async () => {
        const r = await direct.query(
          `SELECT c.relname::text AS tbl, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*)::int FROM pg_policy p
                  WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
                    AND pg_get_expr(p.polqual, p.polrelid)      LIKE '%app.current_company_id%'
                    AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%app.current_company_id%') AS pol
           FROM pg_class c WHERE c.relname = ANY ($1::text[])
          ORDER BY tbl`,
          [[...TRACK_B_TABLES]],
        );
        expect(r.rowCount).toBe(9);
        for (const row of r.rows) {
          expect({
            tbl: row.tbl,
            rls: row.relrowsecurity,
            force: row.relforcerowsecurity,
            pol: row.pol,
          }).toEqual({ tbl: row.tbl, rls: true, force: true, pol: 1 });
        }
      });

      it("(b) ĐÚNG 21 composite tenant-FK, tuple khớp từng dòng (20 Track B + feed_posts_group_fk)", async () => {
        // ⚠️ PHẠM VI THU HẸP theo quyền SỞ HỮU của `0580` (plan §4.10): `feed_posts` đã có sẵn 6
        // composite FK từ `0577` — lấy nguyên `feed_posts` vào tập sẽ ra 27 và báo THỪA 6 dòng.
        // Tập `actual` = 9 bảng Track B + ĐÚNG MỘT dòng của Track A (`feed_posts_group_fk`).
        // ⚠️ `array_length(conkey,1) >= 2` KHÔNG thể bỏ: mỗi bảng còn một FK MỘT-CỘT
        // `company_id → companies` (9 dòng) — đếm cả chúng ra 30, không phải 21. FK một-cột tới bảng
        // KHÁC `companies` được canh riêng ở ca (b') ngay dưới.
        // Giả định thứ tự cột của FK: `(company_id, <cột>)` ⇒ `conkey[2]` là cột nghiệp vụ (khuôn 0559/0577).
        const r = await direct.query(
          `SELECT c.conname::text AS name, c.conrelid::regclass::text AS tbl,
                (SELECT a.attname::text FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[2])         AS col,
                c.confrelid::regclass::text AS tgt, c.confdeltype::text AS del,
                (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.confdelsetcols)) AS setcols,
                array_length(c.conkey, 1) AS ncols
           FROM pg_constraint c
          WHERE c.contype = 'f' AND array_length(c.conkey, 1) >= 2
            AND (c.conrelid::regclass::text = ANY ($1::text[]) OR c.conname = 'feed_posts_group_fk')`,
          [[...TRACK_B_TABLES]],
        );
        expect(r.rowCount).toBe(21);
        for (const row of r.rows) {
          expect({ name: row.name, ncols: row.ncols }).toEqual({ name: row.name, ncols: 2 });
        }

        const actual = Object.fromEntries(
          r.rows.map((row) => [
            row.name,
            { tbl: row.tbl, col: row.col, tgt: row.tgt, del: row.del, setcols: row.setcols },
          ]),
        );
        const noAction = (tbl: string, col: string, tgt: string) => ({
          tbl,
          col,
          tgt,
          del: "a",
          setcols: null,
        });
        // ⚠️ `del: 'n'` PHẢI đi kèm `setcols` liệt kê ĐÚNG cột: `SET NULL` TRẦN null CẢ company_id ⇒
        // hàng rơi khỏi tenant. Đây là điểm DUY NHẤT phân biệt hai bản, và census FK không soi được.
        const setNull = (tbl: string, col: string) => ({
          tbl,
          col,
          tgt: "users",
          del: "n",
          setcols: [col],
        });
        expect(actual).toEqual({
          feed_groups_avatar_file_tenant_fk: noAction("feed_groups", "avatar_file_id", "files"),
          feed_groups_created_by_tenant_fk: setNull("feed_groups", "created_by"),
          feed_groups_updated_by_tenant_fk: setNull("feed_groups", "updated_by"),
          feed_groups_deleted_by_tenant_fk: setNull("feed_groups", "deleted_by"),
          feed_group_members_group_tenant_fk: noAction(
            "feed_group_members",
            "group_id",
            "feed_groups",
          ),
          feed_group_members_user_tenant_fk: noAction("feed_group_members", "user_id", "users"),
          feed_group_members_employee_tenant_fk: noAction(
            "feed_group_members",
            "employee_id",
            "employee_profiles",
          ),
          feed_polls_post_tenant_fk: noAction("feed_polls", "post_id", "feed_posts"),
          feed_poll_options_poll_tenant_fk: noAction("feed_poll_options", "poll_id", "feed_polls"),
          feed_poll_votes_poll_tenant_fk: noAction("feed_poll_votes", "poll_id", "feed_polls"),
          feed_poll_votes_option_tenant_fk: noAction(
            "feed_poll_votes",
            "option_id",
            "feed_poll_options",
          ),
          feed_poll_votes_user_tenant_fk: noAction("feed_poll_votes", "user_id", "users"),
          feed_ideas_post_tenant_fk: noAction("feed_ideas", "post_id", "feed_posts"),
          feed_ideas_reviewed_by_tenant_fk: setNull("feed_ideas", "reviewed_by"),
          feed_kudos_post_tenant_fk: noAction("feed_kudos", "post_id", "feed_posts"),
          feed_kudos_badge_tenant_fk: noAction("feed_kudos", "badge_id", "feed_kudos_badges"),
          feed_kudos_recipients_kudos_tenant_fk: noAction(
            "feed_kudos_recipients",
            "kudos_id",
            "feed_kudos",
          ),
          feed_kudos_recipients_employee_tenant_fk: noAction(
            "feed_kudos_recipients",
            "employee_id",
            "employee_profiles",
          ),
          feed_kudos_badges_created_by_tenant_fk: setNull("feed_kudos_badges", "created_by"),
          feed_kudos_badges_updated_by_tenant_fk: setNull("feed_kudos_badges", "updated_by"),
          feed_posts_group_fk: noAction("feed_posts", "group_id", "feed_groups"),
        });
      });

      it("(b') 0 FK một-cột tới bảng ≠ companies trên 9 bảng Track B", async () => {
        const single = await direct.query(
          `SELECT count(*)::int AS n FROM pg_constraint c
          WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY ($1::text[])
            AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass`,
          [[...TRACK_B_TABLES]],
        );
        expect(single.rows[0].n).toBe(0);
      });

      it("(c) ACL cấp bảng của mediaos_app ĐÚNG-BẰNG DB-17 §4.9 trên cả 9 bảng", async () => {
        const r = await direct.query(
          `SELECT c.relname::text AS tbl,
                array_agg(x.privilege_type ORDER BY x.privilege_type) AS privs
           FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE c.relname = ANY ($1::text[]) AND x.grantee = 'mediaos_app'::regrole
          GROUP BY c.relname`,
          [[...TRACK_B_TABLES]],
        );
        const actual = Object.fromEntries(r.rows.map((row) => [row.tbl, row.privs]));
        expect(actual).toEqual(APP_ACL);
      });

      it("(d) company_id: NOT NULL + DEFAULT literal-GUC ĐÚNG CHUỖI trên cả 9 bảng", async () => {
        const r = await direct.query(
          `SELECT a.attrelid::regclass::text AS tbl, a.attnotnull,
                pg_get_expr(d.adbin, d.adrelid) AS def
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid::regclass::text = ANY ($1::text[]) AND a.attname = 'company_id'
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY tbl`,
          [[...TRACK_B_TABLES]],
        );
        expect(r.rowCount).toBe(9);
        for (const row of r.rows) {
          expect({ tbl: row.tbl, notnull: row.attnotnull }).toEqual({
            tbl: row.tbl,
            notnull: true,
          });
          expect({ tbl: row.tbl, def: row.def }).toEqual({
            tbl: row.tbl,
            def: "(NULLIF(current_setting('app.current_company_id'::text, true), ''::text))::uuid",
          });
        }
      });

      it("(e) KHÔNG bảng nào có ACL cấp CỘT cho app (Track B grant ở CẤP BẢNG)", async () => {
        const r = await direct.query(
          `SELECT count(*)::int AS n
           FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
          WHERE a.attrelid::regclass::text = ANY ($1::text[]) AND a.attnum > 0 AND NOT a.attisdropped
            AND x.grantee = 'mediaos_app'::regrole`,
          [[...TRACK_B_TABLES]],
        );
        expect(r.rows[0].n).toBe(0);
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // NHÓM 13 — Seed catalog huy hiệu. ĐÂY LÀ BẰNG CHỨNG DUY NHẤT cho `done_when` #3: `0582` là NO-OP
    //           có bảo đảm trên mọi lane DB/CI (0 company lúc migrate — plan §3), nên nếu không có ca
    //           này thì done_when "xanh RỖNG". Chạy CHÍNH file `0582` (không chép lại thân SQL — chống
    //           trôi) trên một company THẬT, trong tx REPEATABLE READ rồi ROLLBACK.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("Nhóm 13 · seed 5 huy hiệu hệ thống trên company THẬT", () => {
      it("thân SQL của 0582 trên company thật ⇒ ĐÚNG 5 mã, is_active, position 1..5; chạy lại ⇒ không đổi", async () => {
        await withRole(direct, null, async (c) => {
          await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");

          const before = await c.query(
            `SELECT count(*)::int AS n FROM feed_kudos_badges WHERE company_id = $1`,
            [C.companyId],
          );
          expect(before.rows[0].n).toBe(0); // company vừa tạo ⇒ chưa có huy hiệu nào

          await runMigrationFile(c, "0582_s16socialdb2_seed_kudos_badges.sql");

          const seeded = await c.query(
            `SELECT code::text, is_active, position FROM feed_kudos_badges
            WHERE company_id = $1 ORDER BY position`,
            [C.companyId],
          );
          expect(seeded.rows.map((row) => row.code)).toEqual([...SYSTEM_BADGES]);
          expect(seeded.rows.map((row) => row.position)).toEqual([1, 2, 3, 4, 5]);
          expect(seeded.rows.map((row) => row.is_active)).toEqual([true, true, true, true, true]);

          // Idempotent: `ON CONFLICT (company_id, code) DO NOTHING` ⇒ lần hai không đẻ thêm hàng.
          await runMigrationFile(c, "0582_s16socialdb2_seed_kudos_badges.sql");
          const again = await c.query(
            `SELECT count(*)::int AS n FROM feed_kudos_badges WHERE company_id = $1`,
            [C.companyId],
          );
          expect(again.rows[0].n).toBe(5);
        });
      }, 120_000);

      it("catalog huy hiệu là PER-COMPANY: hàng của B vô hình với A (2 tenant, qua app role)", async () => {
        // Huy hiệu KHÔNG phải catalog global (`company_id` NOT NULL + UNIQUE (company_id, code)) —
        // một `company_id IS NULL` lọt vào đây sẽ lộ catalog của tenant này sang tenant khác.
        await withRole(app, A.companyId, async (c) => {
          const mine = await c.query(
            `SELECT count(*)::int AS n FROM feed_kudos_badges WHERE code = $1`,
            [badgeACode],
          );
          const theirs = await c.query(
            `SELECT count(*)::int AS n FROM feed_kudos_badges WHERE id = $1`,
            [badgeBId],
          );
          expect({ mine: mine.rows[0].n, theirs: theirs.rows[0].n }).toEqual({
            mine: 1,
            theirs: 0,
          });
        });

        const global = await direct.query(
          `SELECT count(*)::int AS n FROM feed_kudos_badges WHERE company_id IS NULL`,
        );
        expect(global.rows[0].n).toBe(0);
      });
    });
  },
);
