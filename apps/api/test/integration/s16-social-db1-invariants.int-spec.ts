import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { feedReactionCoreSchema } from "@mediaos/contracts";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S16-SOCIAL-DB-1 (mig 0577 · 0578 · 0579) — CHỐT HỒI QUY cho nền dữ liệu SOCIAL Track A
 * (DB-17 §4/§6/§9 · SPEC-16 §11 · permission-matrix §9h · plan `docs/plans/S16-SOCIAL-DB-1.md` §7).
 *
 * VÌ SAO FILE NÀY TỒN TẠI. Migration tự verify bằng khối DO/RAISE EXCEPTION, nhưng verify đó chỉ chạy
 * ĐÚNG MỘT LẦN lúc migrate. Sau khi merge, một WO sau `GRANT UPDATE ON feed_post_acks`,
 * `GRANT DELETE ON feed_posts`, bỏ predicate `status='open'` khỏi `feed_reports_open_uq`, đổi
 * `SET NULL (created_by)` thành `SET NULL` trần, hay grant `manage:feed-report` cho employee — KHÔNG có
 * gì đỏ: tenant-isolation/rls-registry không phủ GRANT/partial-unique, và `xtenant-fk-ratchet` chỉ soi
 * FK MỘT-CỘT ĐANG TỒN TẠI nên nó MÙ hoàn toàn với cụm bảng này (không bảng nào có FK một-cột).
 * (mirror `s12-recruit-db1-invariants.int-spec.ts`; memory `reviewers-pass-real-bugs` +
 * `tests-can-pin-a-hole-open`.)
 *
 * NƠI CHẠY: gate `hasDb`, KHÔNG gate `LANE_DB` — chạy THẬT trên CI (DATABASE_URL + DIRECT_URL ở cấp job).
 *
 * QUY TẮC: mọi ca ÂM assert `err.code` + `err.constraint` ĐÍCH DANH, vi phạm ĐÚNG MỘT constraint mỗi ca
 * (`pg-reports-arbitrary-check-when-multiple-violated` — PG chọn TUỲ Ý khi nhiều CHECK cùng vỡ nên ghim
 * TÊN chứ không chỉ mã), và có ĐỐI CHỨNG DƯƠNG trên CÙNG constraint
 * (`deny-cases-vacuous-without-allow-case`). Mọi mutation chạy trong tx ROLLBACK.
 *
 * ⚠️ Ở đây dùng `pg` THÔ nên mã lỗi nằm thẳng ở `err.code`. Khi viết ca tương đương qua **drizzle**
 * (BE-1), nhớ `err.cause?.code` — drizzle bọc lỗi và GIẤU mã PG xuống `cause`.
 */
describe.skipIf(!hasDb)(
  "S16-SOCIAL-DB-1 · bất biến nền dữ liệu SOCIAL Track A (mig 0577–0579)",
  () => {
    const direct = directPool();
    const app = appPool(3);
    const worker = workerPool(1);

    let A: SeededTenant;
    let B: SeededTenant;
    let uA: string; // tác giả/actor A
    let uA2: string; // người thứ hai của A (reaction/ack/report đối chứng)
    let uAudit: string; // user CHỈ dùng cho ca SET NULL (§7.4) — sẽ bị xoá trong ca đó
    let empA: string;
    let orgUnitA: string;
    let postA: string; // share, audience=company
    let newsA: string; // news, pinned + requires_ack
    let commentA: string;
    let tagA: string;
    let uB: string;
    let orgUnitB: string;
    let postB: string;

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

    /** 10 bảng Track A — thứ tự khai báo = thứ tự phụ thuộc CHA → CON (teardown đi ngược). */
    const FEED_TABLES = [
      "feed_posts",
      "feed_comments",
      "feed_tags",
      "feed_post_tags",
      "feed_reactions",
      "feed_mentions",
      "feed_saved_posts",
      "feed_post_views",
      "feed_post_acks",
      "feed_reports",
    ] as const;

    /** DB-17 §4.9 — ACL cấp bảng của `mediaos_app`, sắp xếp theo tên privilege (khớp verify của 0577). */
    const APP_ACL: Record<string, string[]> = {
      feed_posts: ["INSERT", "SELECT", "UPDATE"],
      feed_comments: ["INSERT", "SELECT", "UPDATE"],
      feed_tags: ["INSERT", "SELECT", "UPDATE"],
      feed_post_tags: ["DELETE", "INSERT", "SELECT"],
      feed_reactions: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      feed_mentions: ["DELETE", "INSERT", "SELECT"],
      feed_saved_posts: ["DELETE", "INSERT", "SELECT"],
      feed_post_views: ["INSERT", "SELECT"],
      feed_post_acks: ["INSERT", "SELECT"],
      feed_reports: ["INSERT", "SELECT", "UPDATE"],
    };

    beforeAll(async () => {
      A = await seedCompany(direct, "socA");
      B = await seedCompany(direct, "socB");
      uA = await seedUser(direct, A.companyId, `soc-u1-${A.slug}@x.test`);
      uA2 = await seedUser(direct, A.companyId, `soc-u2-${A.slug}@x.test`);
      uAudit = await seedUser(direct, A.companyId, `soc-audit-${A.slug}@x.test`);
      uB = await seedUser(direct, B.companyId, `soc-u1-${B.slug}@x.test`);

      empA = (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [A.companyId, uA],
        )
      ).rows[0].id as string;

      const mkOrg = async (companyId: string, name: string) =>
        (
          await direct.query(
            `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
            [companyId, name],
          )
        ).rows[0].id as string;
      orgUnitA = await mkOrg(A.companyId, `soc-org-${A.slug}`);
      orgUnitB = await mkOrg(B.companyId, `soc-org-${B.slug}`);

      // Bài nền của A — `created_by = uAudit` để ca §7.4 có hàng để chứng minh SET NULL (col).
      postA = (
        await direct.query(
          `INSERT INTO feed_posts (company_id, author_user_id, author_employee_id, type, audience, body, created_by)
         VALUES ($1, $2, $3, 'share', 'company', 'Bài chia sẻ nền của SOCIAL int-spec', $4) RETURNING id`,
          [A.companyId, uA, empA, uAudit],
        )
      ).rows[0].id as string;
      newsA = (
        await direct.query(
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body, pinned, requires_ack)
         VALUES ($1, $2, 'news', 'company', 'Tin nội bộ cần xác nhận đọc', true, true) RETURNING id`,
          [A.companyId, uA],
        )
      ).rows[0].id as string;
      commentA = (
        await direct.query(
          `INSERT INTO feed_comments (company_id, post_id, author_user_id, body)
         VALUES ($1, $2, $3, 'bình luận nền') RETURNING id`,
          [A.companyId, postA, uA],
        )
      ).rows[0].id as string;
      tagA = (
        await direct.query(`INSERT INTO feed_tags (company_id, tag) VALUES ($1, $2) RETURNING id`, [
          A.companyId,
          `soc-tag-${randomUUID().slice(0, 8)}`,
        ])
      ).rows[0].id as string;

      postB = (
        await direct.query(
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'share', 'company', 'Bài của tenant B') RETURNING id`,
          [B.companyId, uB],
        )
      ).rows[0].id as string;
    }, 60_000);

    afterAll(async () => {
      await cleanupTenants(direct, [A?.companyId, B?.companyId].filter(Boolean) as string[]);
      await direct.end();
      await app.end();
      await worker.end();
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // §7.1 — BỐN LƯỚI BẮT BUỘC: 3 lưới PG + 1 lưới Zod.
    // ⚠️ Ca (b) PG **CỐ Ý PASS**. Đọc nhãn này là "thiếu CHECK emoji" là hiểu nhầm mà DB-17 §6.3 dựng ra
    //    để chặn — nguồn sự thật của bộ emoji là hằng dùng chung với CHAT, CHECK ở DB = nguồn thứ hai.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("§7.1 · bốn lưới bắt buộc", () => {
      it("(a) audience='org_unit' mà org_unit_id NULL ⇒ 23514 chk_feed_posts_audience_org", async () => {
        const r = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'share', 'org_unit', 'thiếu org_unit_id')`,
          [A.companyId, uA],
        );
        expect(r.code).toBe("23514");
        expect(r.constraint).toBe("chk_feed_posts_audience_org");
      });

      it("(a') đối chứng ÂM chiều ngược: audience='company' mà mang group_id ⇒ 23514 _audience_company", async () => {
        const r = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, group_id, body)
         VALUES ($1, $2, 'share', 'company', $3, 'company không được mang group_id')`,
          [A.companyId, uA, randomUUID()],
        );
        expect(r.code).toBe("23514");
        expect(r.constraint).toBe("chk_feed_posts_audience_company");
      });

      it("(a'') ĐỐI CHỨNG DƯƠNG: audience='org_unit' KÈM org_unit_id ⇒ OK (ca DENY rỗng là ca xanh giả)", async () => {
        const r = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, org_unit_id, body)
         VALUES ($1, $2, 'share', 'org_unit', $3, 'đúng cặp')`,
          [A.companyId, uA, orgUnitA],
        );
        expect(r.code).toBeNull();
      });

      it("(b) emoji lạ: PG **PASS** (đúng thiết kế §6.3) nhưng Zod CHẶN — lưới nằm ở contracts", async () => {
        // Vế PG: không có CHECK nào trên `emoji` ⇒ INSERT phải THÀNH CÔNG. Đây là assert có chủ ý, KHÔNG
        // phải chỗ thiếu sót: CHECK ở đây sẽ là nguồn sự thật thứ hai của bộ emoji CHAT (DB-17 §6.3).
        const pg = await attempt(
          A.companyId,
          `INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
         VALUES ($1, 'post', $2, $3, 'clown')`,
          [A.companyId, postA, uA],
        );
        expect(pg.code).toBeNull();

        // Vế Zod: lớp phòng thủ DUY NHẤT của cột này.
        const zod = feedReactionCoreSchema.safeParse({
          targetType: "post",
          targetId: postA,
          emoji: "clown",
        });
        expect(zod.success).toBe(false);

        // ĐỐI CHỨNG DƯƠNG cho vế Zod — emoji thuộc bộ CHAT phải qua.
        expect(
          feedReactionCoreSchema.safeParse({ targetType: "post", targetId: postA, emoji: "like" })
            .success,
        ).toBe(true);
      });

      it("(c) thích ĐÔI cùng (target_type,target_id,user) ⇒ 23505 feed_reactions_target_user_uq", async () => {
        const r = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
           VALUES ($1, 'post', $2, $3, 'like')`,
            [A.companyId, postA, uA],
          ],
          [
            `INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
           VALUES ($1, 'post', $2, $3, 'love')`,
            [A.companyId, postA, uA],
          ],
        ]);
        expect(r.code).toBe("23505");
        expect(r.constraint).toBe("feed_reactions_target_user_uq");
      });

      it("(c') ĐỐI CHỨNG DƯƠNG: cùng bài + NGƯỜI KHÁC ⇒ OK; cùng người + BÌNH LUẬN ⇒ OK", async () => {
        const r = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
           VALUES ($1, 'post', $2, $3, 'like')`,
            [A.companyId, postA, uA],
          ],
          [
            `INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
           VALUES ($1, 'post', $2, $3, 'like')`,
            [A.companyId, postA, uA2],
          ],
          [
            `INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
           VALUES ($1, 'comment', $2, $3, 'haha')`,
            [A.companyId, commentA, uA],
          ],
        ]);
        expect(r.code).toBeNull();
      });

      it("(d) cross-tenant FK: post của A trỏ user của B ⇒ 23503 composite FK (chạy qua DIRECT = bypass RLS)", async () => {
        // Đi qua `direct` (owner, rolbypassrls) CÓ CHỦ Ý: nếu đi qua app pool thì RLS chặn trước và ca này
        // chứng minh RLS chứ không chứng minh FK. Vế RLS ghi được chứng minh riêng ở §7.3.
        const r = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'share', 'company', 'tác giả thuộc tenant khác')`,
          [A.companyId, uB],
          direct,
        );
        expect(r.code).toBe("23503");
        expect(r.constraint).toBe("feed_posts_author_user_tenant_fk");
      });

      it("(d') ĐỐI CHỨNG DƯƠNG: cùng tenant ⇒ OK (chứng minh ca (d) đỏ vì TENANT, không vì cú pháp)", async () => {
        const r = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'share', 'company', 'tác giả cùng tenant')`,
          [A.companyId, uA],
          direct,
        );
        expect(r.code).toBeNull();
      });

      it("(d'') cross-tenant org_unit ⇒ 23503 feed_posts_org_unit_tenant_fk (không chỉ `users` bị chặn)", async () => {
        // `users` không phải đích duy nhất ngoài module — org_units là đích thứ hai, và một FK thiếu ở
        // đó cũng đủ để bài của tenant A neo vào phòng ban của tenant B.
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, org_unit_id, body)
         VALUES ($1, $2, 'share', 'org_unit', $3, 'phòng ban của tenant khác')`,
          [A.companyId, uA, orgUnitB],
          direct,
        );
        expect(deny.code).toBe("23503");
        expect(deny.constraint).toBe("feed_posts_org_unit_tenant_fk");

        // ĐỐI CHỨNG DƯƠNG: org_unit CÙNG tenant ⇒ OK.
        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, org_unit_id, body)
         VALUES ($1, $2, 'share', 'org_unit', $3, 'phòng ban cùng tenant')`,
          [A.companyId, uA, orgUnitA],
          direct,
        );
        expect(allow.code).toBeNull();
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // §7.2 — CHECK KÉO THEO còn lại. Đây đúng hình dạng "vế IS NULL OR rỗng" mà DB-17 §6.1 cảnh báo:
    //        CHECK đúng cú pháp mà đúng VĨNH VIỄN — không ca nào chứng minh nó chặn được gì.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("§7.2 · CHECK kéo theo (mỗi ca DENY kèm 1 ALLOW đối chứng)", () => {
      it("pinned=true trên bài KHÔNG phải news ⇒ 23514 chk_feed_posts_pinned_news; news ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body, pinned)
         VALUES ($1, $2, 'share', 'company', 'ghim bài share', true)`,
          [A.companyId, uA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_posts_pinned_news");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body, pinned)
         VALUES ($1, $2, 'news', 'company', 'ghim tin tức', true)`,
          [A.companyId, uA],
        );
        expect(allow.code).toBeNull();
      });

      it("requires_ack=true trên bài KHÔNG phải news ⇒ 23514 chk_feed_posts_ack_news; news ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body, requires_ack)
         VALUES ($1, $2, 'idea', 'company', 'ý tưởng đòi ack', true)`,
          [A.companyId, uA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_posts_ack_news");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body, requires_ack)
         VALUES ($1, $2, 'news', 'company', 'tin đòi ack', true)`,
          [A.companyId, uA],
        );
        expect(allow.code).toBeNull();
      });

      it("type='share' mà body NULL ⇒ 23514 chk_feed_posts_body_required; type='poll' body NULL ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'share', 'company', NULL)`,
          [A.companyId, uA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_posts_body_required");

        // poll/kudos mang nội dung ở bảng con Track B ⇒ body NULL là HỢP LỆ.
        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'poll', 'company', NULL)`,
          [A.companyId, uA],
        );
        expect(allow.code).toBeNull();
      });

      it("body TOÀN KHOẢNG TRẮNG cũng bị chặn (btrim) — vế `length(btrim(body)) > 0` không phải trang trí", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'share', 'company', '     ')`,
          [A.companyId, uA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_posts_body_required");
      });

      it("báo cáo status='resolved' mà thiếu resolved_by/at ⇒ 23514 chk_feed_reports_resolved_pair; đủ cặp ⇒ OK", async () => {
        const deny = await attempt(
          A.companyId,
          `INSERT INTO feed_reports (company_id, target_type, target_id, reporter_user_id, reason, status)
         VALUES ($1, 'post', $2, $3, 'spam', 'resolved')`,
          [A.companyId, postA, uA],
        );
        expect(deny.code).toBe("23514");
        expect(deny.constraint).toBe("chk_feed_reports_resolved_pair");

        const allow = await attempt(
          A.companyId,
          `INSERT INTO feed_reports
           (company_id, target_type, target_id, reporter_user_id, reason, status, resolved_by, resolved_at)
         VALUES ($1, 'post', $2, $3, 'spam', 'resolved', $4, now())`,
          [A.companyId, postA, uA, uA2],
        );
        expect(allow.code).toBeNull();
      });

      it("partial unique `feed_reports_open_uq`: báo cáo ĐÔI khi còn 'open' ⇒ 23505; sau khi resolved ⇒ OK", async () => {
        const deny = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_reports (company_id, target_type, target_id, reporter_user_id, reason)
           VALUES ($1, 'post', $2, $3, 'spam')`,
            [A.companyId, postA, uA],
          ],
          [
            `INSERT INTO feed_reports (company_id, target_type, target_id, reporter_user_id, reason)
           VALUES ($1, 'post', $2, $3, 'harassment')`,
            [A.companyId, postA, uA],
          ],
        ]);
        expect(deny.code).toBe("23505");
        expect(deny.constraint).toBe("feed_reports_open_uq");

        // ĐỐI CHỨNG DƯƠNG cho PREDICATE: báo cáo cũ đã đóng ⇒ báo cáo mới lọt. Nếu ai đó bỏ
        // `WHERE status='open'` khỏi index thì ca này ĐỎ — đó là điều ta muốn.
        const allow = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_reports
             (company_id, target_type, target_id, reporter_user_id, reason, status, resolved_by, resolved_at)
           VALUES ($1, 'post', $2, $3, 'spam', 'dismissed', $4, now())`,
            [A.companyId, postA, uA, uA2],
          ],
          [
            `INSERT INTO feed_reports (company_id, target_type, target_id, reporter_user_id, reason)
           VALUES ($1, 'post', $2, $3, 'harassment')`,
            [A.companyId, postA, uA],
          ],
        ]);
        expect(allow.code).toBeNull();
      });

      it("gán thẻ ĐÔI cùng (post,tag) ⇒ 23505 feed_post_tags_pk; thẻ KHÁC trên cùng bài ⇒ OK", async () => {
        const deny = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_post_tags (company_id, post_id, tag_id) VALUES ($1, $2, $3)`,
            [A.companyId, postA, tagA],
          ],
          [
            `INSERT INTO feed_post_tags (company_id, post_id, tag_id) VALUES ($1, $2, $3)`,
            [A.companyId, postA, tagA],
          ],
        ]);
        expect(deny.code).toBe("23505");
        expect(deny.constraint).toBe("feed_post_tags_pk");

        const allow = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_tags (company_id, tag) VALUES ($1, 'soc-tag-khac') RETURNING id`,
            [A.companyId],
          ],
          [
            `INSERT INTO feed_post_tags (company_id, post_id, tag_id)
           SELECT $1, $2, id FROM feed_tags WHERE company_id = $1 AND tag = 'soc-tag-khac'`,
            [A.companyId, postA],
          ],
        ]);
        expect(allow.code).toBeNull();
      });

      it("PK tổ hợp chặn ack/view/lưu ĐÔI ⇒ 23505 đúng TÊN pk (contype='p', không phải UNIQUE)", async () => {
        const ack = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_post_acks (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
            [A.companyId, newsA, uA],
          ],
          [
            `INSERT INTO feed_post_acks (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
            [A.companyId, newsA, uA],
          ],
        ]);
        expect(ack.code).toBe("23505");
        expect(ack.constraint).toBe("feed_post_acks_pk");

        const view = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_post_views (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
            [A.companyId, postA, uA],
          ],
          [
            `INSERT INTO feed_post_views (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
            [A.companyId, postA, uA],
          ],
        ]);
        expect(view.code).toBe("23505");
        expect(view.constraint).toBe("feed_post_views_pk");

        // ĐỐI CHỨNG DƯƠNG: người KHÁC ack cùng bài ⇒ OK.
        const allow = await attemptSeq(A.companyId, [
          [
            `INSERT INTO feed_post_acks (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
            [A.companyId, newsA, uA],
          ],
          [
            `INSERT INTO feed_post_acks (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
            [A.companyId, newsA, uA2],
          ],
        ]);
        expect(allow.code).toBeNull();
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // §7.3 — RLS: CẢ vế ĐỌC lẫn vế GHI. Vế ghi (`WITH CHECK`) không có ca nào khác chứng minh:
    //        ca (d) ở trên đi qua `direct` = bypass RLS, nó chỉ chứng minh FK.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("§7.3 · RLS đọc + ghi", () => {
      it("KHÔNG có GUC ⇒ 0 hàng trên CẢ 10 bảng (app role, FORCE RLS)", async () => {
        await withRole(app, null, async (c) => {
          for (const t of FEED_TABLES) {
            const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
            expect({ table: t, n: r.rows[0].n }).toEqual({ table: t, n: 0 });
          }
        });
      });

      it("GUC = A ⇒ thấy bài của A, KHÔNG thấy bài của B (cô lập chéo tenant, vế ĐỌC)", async () => {
        await withRole(app, A.companyId, async (c) => {
          const mine = await c.query(`SELECT count(*)::int AS n FROM feed_posts WHERE id = $1`, [
            postA,
          ]);
          const theirs = await c.query(`SELECT count(*)::int AS n FROM feed_posts WHERE id = $1`, [
            postB,
          ]);
          expect(mine.rows[0].n).toBe(1);
          expect(theirs.rows[0].n).toBe(0);
        });
      });

      it("GUC = A mà INSERT company_id = B ⇒ 42501 row-level security (vế GHI `WITH CHECK`)", async () => {
        const r = await attempt(
          A.companyId,
          `INSERT INTO feed_posts (company_id, author_user_id, type, audience, body)
         VALUES ($1, $2, 'share', 'company', 'ghi xuyên tenant')`,
          [B.companyId, uB],
        );
        expect(r.code).toBe("42501");
        expect(r.message ?? "").toMatch(/row-level security/i);
      });

      it("company_id để DB tự điền từ GUC ⇒ rơi đúng tenant A (DEFAULT literal-GUC còn sống)", async () => {
        await withRole(app, A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO feed_posts (author_user_id, type, audience, body)
           VALUES ($1, 'share', 'company', 'không truyền company_id') RETURNING company_id`,
            [uA],
          );
          expect(r.rows[0].company_id).toBe(A.companyId);
        });
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // §7.4 — `SET NULL (col)` viết ĐÚNG: xoá user là `created_by` ⇒ bài CÒN, created_by = NULL, và
    //        **company_id KHÔNG đổi**. Bản `SET NULL` TRẦN sẽ null CẢ company_id — đó là thứ DUY NHẤT
    //        phân biệt hai bản, và `xtenant-fk-ratchet` (chỉ soi FK một-cột đã có) KHÔNG soi được.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("§7.4 · hành vi SET NULL (col) của 7 FK vết-kiểm-toán", () => {
      it("xoá user đang là created_by ⇒ bài CÒN, created_by NULL, company_id NGUYÊN VẸN", async () => {
        await withRole(direct, null, async (c) => {
          const before = await c.query(
            `SELECT created_by, company_id FROM feed_posts WHERE id = $1`,
            [postA],
          );
          expect(before.rows[0].created_by).toBe(uAudit);

          await c.query(`DELETE FROM users WHERE id = $1`, [uAudit]);

          const after = await c.query(
            `SELECT id, created_by, company_id FROM feed_posts WHERE id = $1`,
            [postA],
          );
          expect(after.rowCount).toBe(1); // bài KHÔNG bị xoá theo
          expect(after.rows[0].created_by).toBeNull();
          expect(after.rows[0].company_id).toBe(A.companyId); // ⚠️ vế phân biệt SET NULL (col) ↔ SET NULL trần
        });
      });

      it("pg_constraint: ĐÚNG 7 FK có confdeltype='n', và mỗi cái liệt kê ĐÚNG cột của nó", async () => {
        const r = await direct.query(
          `SELECT c.conrelid::regclass::text AS tbl,
                (SELECT a.attname::text FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[2]) AS col,
                (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.confdelsetcols)) AS setcols
           FROM pg_constraint c
          WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY ($1::text[])
            AND c.confdeltype = 'n'
          ORDER BY tbl, col`,
          [[...FEED_TABLES]],
        );
        expect(r.rows).toEqual([
          { tbl: "feed_comments", col: "created_by", setcols: ["created_by"] },
          { tbl: "feed_comments", col: "deleted_by", setcols: ["deleted_by"] },
          { tbl: "feed_comments", col: "updated_by", setcols: ["updated_by"] },
          { tbl: "feed_posts", col: "created_by", setcols: ["created_by"] },
          { tbl: "feed_posts", col: "deleted_by", setcols: ["deleted_by"] },
          { tbl: "feed_posts", col: "updated_by", setcols: ["updated_by"] },
          { tbl: "feed_reports", col: "resolved_by", setcols: ["resolved_by"] },
        ]);
      });

      it("mọi cột NOT NULL trỏ users đều NO ACTION — SET NULL ở đó sẽ nổ lúc teardown", async () => {
        const r = await direct.query(
          `SELECT count(*)::int AS n
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[2]
          WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY ($1::text[])
            AND a.attnotnull AND c.confdeltype <> 'a'`,
          [[...FEED_TABLES]],
        );
        expect(r.rows[0].n).toBe(0);
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // §7.5 — `feed_posts.group_id`: assert TỰ LÊN NÒNG. "Ghi chú cho DB-2" không phải cơ chế; cột KHÔNG
    //        có FK thì census MÙ hoàn toàn. Spec này sống vĩnh viễn trong CI và TỰ ĐỔI VẾ khi Track B land.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("§7.5 · nợ group_id → DB-2 (cổng tự lên nòng)", () => {
      it("feed_groups CHƯA có ⇒ group_id không FK; feed_groups ĐÃ có ⇒ BẮT BUỘC composite FK", async () => {
        const exists = (await direct.query(`SELECT to_regclass('feed_groups') IS NOT NULL AS ok`))
          .rows[0].ok as boolean;

        const fk = await direct.query(
          `SELECT c.conname, c.confrelid::regclass::text AS tgt, c.confdeltype::text AS del,
                array_length(c.conkey, 1) AS ncols
           FROM pg_constraint c
          WHERE c.contype = 'f' AND c.conrelid = 'feed_posts'::regclass
            AND EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                           AND a.attname = 'group_id')`,
        );

        if (!exists) {
          // Nợ ĐÃ ĐĂNG KÝ, còn hạn — DB-1 cố ý không tạo FK vì bảng đích chưa tồn tại (plan §0.2).
          expect(fk.rowCount).toBe(0);
        } else {
          // Track B đã land ⇒ DB-2 PHẢI đã thêm `feed_posts_group_fk`. Quên = spec này ĐỎ, không phụ
          // thuộc vào việc ai đọc `notes` của Work Order.
          expect(fk.rowCount).toBe(1);
          expect(fk.rows[0].tgt).toBe("feed_groups");
          expect(fk.rows[0].del).toBe("a"); // NO ACTION
          expect(fk.rows[0].ncols).toBe(2); // composite (company_id, group_id)
        }
      });

      it("0 hàng audience='group' mồ côi — bắt TRƯỚC khi ALTER của DB-2 nổ, và VẪN đo được sau đó", async () => {
        // ⚠️ KHÔNG `return` sớm khi Track B đã land: `return` biến ca này thành XANH 0-ASSERTION
        // VĨNH VIỄN — không gì phân biệt "bỏ qua có chủ đích" với "quên mất assertion"
        // (`empty-success-is-the-fail-open-shape`). Phép đo dưới đây ĐÚNG ở CẢ HAI trạng thái:
        //   · chưa có FK → nó là lưới DUY NHẤT bắt hàng mồ côi (ALTER của DB-2 sẽ 23503 trên PROD);
        //   · đã có FK   → nó thành đối chứng rẻ rằng FK thật sự đang giữ (0 mồ côi lọt qua).
        const hasGroups = (
          await direct.query(`SELECT to_regclass('feed_groups') IS NOT NULL AS ok`)
        ).rows[0].ok as boolean;

        const orphan = await direct.query(
          hasGroups
            ? `SELECT count(*)::int AS n FROM feed_posts fp
                WHERE fp.audience = 'group' AND fp.group_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM feed_groups g
                                   WHERE g.company_id = fp.company_id AND g.id = fp.group_id)`
            : `SELECT count(*)::int AS n FROM feed_posts
                WHERE audience = 'group' AND group_id IS NOT NULL`,
        );
        expect(orphan.rows[0].n).toBe(0);
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // §7.6 — RÀNG BUỘC: phân biệt ĐÚNG `contype`. "4 UNIQUE" của done_when KHÔNG cùng loại — viết
    //        `contype='u'` trơn sẽ hoặc đỏ oan, hoặc đẻ một UNIQUE trùng PK.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("§7.6 · phân loại ràng buộc chống-trùng", () => {
      it("3 sổ + bảng nối dùng PRIMARY KEY tổ hợp (contype='p'), KHÔNG phải UNIQUE", async () => {
        const r = await direct.query(
          `SELECT c.conrelid::regclass::text AS tbl,
                (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) AS cols
           FROM pg_constraint c
          WHERE c.contype = 'p' AND c.conrelid::regclass::text = ANY ($1::text[])
          ORDER BY tbl`,
          [["feed_post_tags", "feed_saved_posts", "feed_post_views", "feed_post_acks"]],
        );
        expect(r.rows).toEqual([
          { tbl: "feed_post_acks", cols: ["company_id", "post_id", "user_id"] },
          { tbl: "feed_post_tags", cols: ["company_id", "post_id", "tag_id"] },
          { tbl: "feed_post_views", cols: ["company_id", "post_id", "user_id"] },
          { tbl: "feed_saved_posts", cols: ["company_id", "post_id", "user_id"] },
        ]);
      });

      it("4 bảng PK tổ hợp KHÔNG có UNIQUE trùng PK (đẻ thêm = index thừa, ghi chậm không lý do)", async () => {
        const r = await direct.query(
          `SELECT count(*)::int AS n FROM pg_constraint c
          WHERE c.contype = 'u' AND c.conrelid::regclass::text = ANY ($1::text[])`,
          [["feed_post_tags", "feed_saved_posts", "feed_post_views", "feed_post_acks"]],
        );
        expect(r.rows[0].n).toBe(0);
      });

      it("`feed_reports_open_uq` là partial unique INDEX (KHÔNG có trong pg_constraint) + predicate ĐÚNG CHUỖI", async () => {
        const con = await direct.query(
          `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'feed_reports_open_uq'`,
        );
        expect(con.rows[0].n).toBe(0);

        const idx = await direct.query(
          `SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid) AS pred
           FROM pg_index i WHERE i.indexrelid = 'feed_reports_open_uq'::regclass`,
        );
        expect(idx.rows[0].indisunique).toBe(true);
        // So ĐÚNG CHUỖI, KHÔNG `ILIKE '%WHERE%'`: một predicate khác vẫn chứa chữ WHERE.
        expect(idx.rows[0].pred).toBe("((status)::text = 'open'::text)");
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // §7.7 — ACL · quyền · audit · DEFAULT · idempotency.
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    describe("§7.7 · ACL, quyền, audit, DEFAULT", () => {
      it("ACL cấp bảng của mediaos_app ĐÚNG-BẰNG DB-17 §4.9 trên cả 10 bảng", async () => {
        const r = await direct.query(
          `SELECT c.relname::text AS tbl,
                array_agg(x.privilege_type ORDER BY x.privilege_type) AS privs
           FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE c.relname = ANY ($1::text[]) AND x.grantee = 'mediaos_app'::regrole
          GROUP BY c.relname`,
          [[...FEED_TABLES]],
        );
        const actual = Object.fromEntries(r.rows.map((row) => [row.tbl, row.privs]));
        expect(actual).toEqual(APP_ACL);
      });

      it("KHÔNG bảng nào có ACL cấp CỘT cho app (Track A grant ở CẤP BẢNG)", async () => {
        const r = await direct.query(
          `SELECT count(*)::int AS n
           FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
          WHERE a.attrelid::regclass::text = ANY ($1::text[]) AND a.attnum > 0 AND NOT a.attisdropped
            AND x.grantee = 'mediaos_app'::regrole`,
          [[...FEED_TABLES]],
        );
        expect(r.rows[0].n).toBe(0);
      });

      it("APPEND-ONLY THẬT: UPDATE/DELETE trên feed_post_views & feed_post_acks dưới app ⇒ 42501", async () => {
        // Đo bằng lệnh THẬT, không chỉ đọc catalog: ACL đúng mà ai đó cấp qua role khác thì catalog-check
        // vẫn xanh (`measuring-a-gate-needs-a-real-violation`).
        for (const [table, col] of [
          ["feed_post_views", "viewed_at"],
          ["feed_post_acks", "acked_at"],
        ] as const) {
          const upd = await attempt(A.companyId, `UPDATE ${table} SET ${col} = now()`);
          expect({ table, code: upd.code }).toEqual({ table, code: "42501" });

          const del = await attempt(A.companyId, `DELETE FROM ${table}`);
          expect({ table, code: del.code }).toEqual({ table, code: "42501" });
        }

        // ĐỐI CHỨNG DƯƠNG: INSERT vẫn đi được (append-only ≠ read-only).
        const ins = await attempt(
          A.companyId,
          `INSERT INTO feed_post_views (company_id, post_id, user_id) VALUES ($1, $2, $3)`,
          [A.companyId, postA, uA2],
        );
        expect(ins.code).toBeNull();
      });

      it("soft-delete THẬT: DELETE trên feed_posts/feed_comments/feed_tags/feed_reports dưới app ⇒ 42501", async () => {
        for (const t of ["feed_posts", "feed_comments", "feed_tags", "feed_reports"] as const) {
          const del = await attempt(A.companyId, `DELETE FROM ${t}`);
          expect({ table: t, code: del.code }).toEqual({ table: t, code: "42501" });
        }
      });

      it("mediaos_worker: ĐÚNG {SELECT} trên feed_posts, 0 ACL trên 9 bảng còn lại (DB-17 §4.3)", async () => {
        const r = await direct.query(
          `SELECT c.relname::text AS tbl,
                array_agg(x.privilege_type ORDER BY x.privilege_type) AS privs
           FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE c.relname = ANY ($1::text[]) AND x.grantee = 'mediaos_worker'::regrole
          GROUP BY c.relname`,
          [[...FEED_TABLES]],
        );
        expect(r.rows).toEqual([{ tbl: "feed_posts", privs: ["SELECT"] }]);

        // ĐỐI CHỨNG DƯƠNG bằng lệnh THẬT: worker đọc được feed_posts của tenant A.
        await withRole(worker, A.companyId, async (c) => {
          const q = await c.query(`SELECT count(*)::int AS n FROM feed_posts WHERE id = $1`, [
            postA,
          ]);
          expect(q.rows[0].n).toBe(1);
        });
      });

      it("company_id: NOT NULL + DEFAULT literal-GUC ĐÚNG CHUỖI trên cả 10 bảng", async () => {
        const r = await direct.query(
          `SELECT a.attrelid::regclass::text AS tbl, a.attnotnull,
                pg_get_expr(d.adbin, d.adrelid) AS def
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid::regclass::text = ANY ($1::text[]) AND a.attname = 'company_id'
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY tbl`,
          [[...FEED_TABLES]],
        );
        expect(r.rowCount).toBe(10);
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

      it("27 composite tenant-FK, 0 FK một-cột tới bảng ≠ companies", async () => {
        // ⚠️ RATCHET bump CÓ CHỦ Ý (S16-SOCIAL-DB-2, plan §0): 26 (0577, 10 bảng Track A)
        // + feed_posts_group_fk (mig 0580 — `feed_posts` ∈ FEED_TABLES nên nó rơi vào phép đếm này) = 27.
        // Nới thành `toBeGreaterThanOrEqual` là GIẾT ratchet — đúng lớp lỗi nó sinh ra để chặn.
        const multi = await direct.query(
          `SELECT count(*)::int AS n FROM pg_constraint c
          WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY ($1::text[])
            AND array_length(c.conkey, 1) >= 2`,
          [[...FEED_TABLES]],
        );
        expect(multi.rows[0].n).toBe(27);

        const single = await direct.query(
          `SELECT count(*)::int AS n FROM pg_constraint c
          WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY ($1::text[])
            AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass`,
          [[...FEED_TABLES]],
        );
        expect(single.rows[0].n).toBe(0);
      });

      it("RLS ENABLE + FORCE + policy tenant_isolation (USING và WITH CHECK) trên cả 10 bảng", async () => {
        const r = await direct.query(
          `SELECT c.relname::text AS tbl, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*)::int FROM pg_policy p
                  WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
                    AND pg_get_expr(p.polqual, p.polrelid)      LIKE '%app.current_company_id%'
                    AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%app.current_company_id%') AS pol
           FROM pg_class c WHERE c.relname = ANY ($1::text[])
          ORDER BY tbl`,
          [[...FEED_TABLES]],
        );
        expect(r.rowCount).toBe(10);
        for (const row of r.rows) {
          expect({
            tbl: row.tbl,
            rls: row.relrowsecurity,
            force: row.relforcerowsecurity,
            pol: row.pol,
          }).toEqual({ tbl: row.tbl, rls: true, force: true, pol: 1 });
        }
      });

      it("feed_reactions.emoji KHÔNG có CHECK — ngoại lệ mirror phải được GHIM, không để ai 'bổ sung' sau", async () => {
        const r = await direct.query(
          `SELECT count(*)::int AS n FROM pg_constraint
          WHERE conrelid = 'feed_reactions'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%emoji%'`,
        );
        expect(r.rows[0].n).toBe(0);
      });

      it("seed quyền: 14 cặp (0 sensitive) · 43 grant · breakdown 7/8/14/14 · manager view:feed-report=Department", async () => {
        const perms = await direct.query(
          `SELECT count(*)::int AS n, count(*) FILTER (WHERE is_sensitive)::int AS sensitive
           FROM permissions WHERE resource_type = 'feed' OR resource_type LIKE 'feed-%'`,
        );
        expect(perms.rows[0]).toEqual({ n: 14, sensitive: 0 });

        const total = await direct.query(
          `SELECT count(*)::int AS n
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.deleted_at IS NULL AND ro.name <> 'super-admin' AND rp.effect = 'ALLOW'
            AND ro.company_id IS NULL
            AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%')`,
        );
        // ⚠️ Loại `super-admin` THEO TÊN: SuperAdminBootstrapService grant TOÀN BỘ catalog per-pair
        // (data_scope='System') ở MỖI LẦN BOOT ⇒ mọi spec dựng super-admin (chạy song song ở worker
        // khác) và mọi DB dev/PROD đã bootstrap sẽ đẩy 43 → 57.
        //
        // ⟲ **S16-SOCIAL-BE-1B (22/09/2026) THÊM `ro.company_id IS NULL`** — sửa GỐC, không nới số.
        // ┌─ VÌ SAO ĐỔI, VÀ VÌ SAO LÝ LẼ CŨ SAI ─────────────────────────────────────────────────────┐
        // │ Bản trước cố ý ĐẾM TOÀN CỤC với lý lẽ «lọc theo scope sẽ MÙ với role TUỲ BIẾN của tenant  │
        // │ — đúng nhóm nguy hiểm census này sinh ra để canh». Lý lẽ đó sai ở chỗ: một ĐẲNG THỨC       │
        // │ (`toBe(43)`) KHÔNG canh được nhóm đó, vì role tuỳ biến của tenant là thứ SINH RA LÚC CHẠY  │
        // │ — mỗi int-spec tạo vài cái, và tenant thật cũng tạo. ĐO THẬT trên lane `mediaos_be1b`      │
        // │ (22/09): 43 hàng thuộc role HỆ THỐNG (seed 0578, đúng kỳ vọng) + 57 hàng thuộc role tuỳ    │
        // │ biến do fixture của CHÍNH các int-spec SOCIAL dựng (`socvis-*`/`socialbe1-*` của BE-1 và   │
        // │ `sb1b*` của BE-1B) ⇒ 100. Số 57 đó không phải lỗi seed; nó là dữ liệu test còn sống.       │
        // │ Đây đúng lớp lỗi `invariant-count-must-filter-owned-rows`: bộ đếm bất biến phải lọc theo   │
        // │ phạm vi SỞ HỮU. Phạm vi mà `0578` sở hữu là role HỆ THỐNG (`company_id IS NULL`) — và câu  │
        // │ breakdown per-role NGAY BÊN DƯỚI đã lọc đúng như vậy từ đầu, nên hai câu trong CÙNG một ca │
        // │ đang đo hai tập khác nhau. Nay chúng đo cùng một tập.                                      │
        // │ Backlog `S16-SOCIAL-BE-1` đã DỰ BÁO chính xác việc này («ngay khi BE-1B/FE-1/BE-2 cho      │
        // │ tenant admin cấp quyền feed cho role TUỲ BIẾN, các census đó sẽ ĐỎ OAN — lúc đó phải thu   │
        // │ hẹp về `ro.company_id IS NULL`»).                                                          │
        // └───────────────────────────────────────────────────────────────────────────────────────────┘
        expect(total.rows[0].n).toBe(43);

        const perRole = await direct.query(
          `SELECT ro.name::text AS role_name, count(*)::int AS n
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.company_id IS NULL AND ro.name <> 'super-admin' AND ro.deleted_at IS NULL
            AND rp.effect = 'ALLOW'
            AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%')
          GROUP BY ro.name ORDER BY ro.name`,
        );
        // `super-admin` cũng là role company_id IS NULL, nên lọc theo scope KHÔNG đủ để loại nó khỏi
        // breakdown: sau bootstrap nó có đủ 14 cặp feed và tự thêm một dòng { super-admin, 14 } vào
        // kỳ vọng 4 dòng. Loại THEO TÊN như `total`/`scoped`.
        expect(perRole.rows).toEqual([
          { role_name: "company-admin", n: 14 },
          { role_name: "employee", n: 7 },
          { role_name: "hr", n: 14 },
          { role_name: "manager", n: 8 },
        ]);

        // ⟲ **`ro.company_id IS NULL` — vá 22/09 (FULL gate), CÙNG lý do với `total`/`perRole`.**
        // Câu này bị bỏ sót ở lượt thu hẹp trước: nó đếm CẢ role TUỲ BIẾN của tenant, thứ `0578`
        // không sở hữu. Fixture int-spec của BE-1 gieo đúng một role như vậy
        // (`socialbe1-deptmgr-*` mang `manage:feed-post@Department`) ⇒ ca này ĐỎ OAN ngay khi hai
        // spec chạy trên cùng một DB — tức là trên CI. Bất biến cần đo là «seed hệ thống cấp đúng
        // MỘT cặp hẹp hơn Company», không phải «không tenant nào được tự cấp phạm vi hẹp».
        const scoped = await direct.query(
          `SELECT ro.name::text AS role_name, p.action::text, p.resource_type::text, rp.data_scope::text
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.company_id IS NULL AND ro.deleted_at IS NULL AND ro.name <> 'super-admin'
            AND rp.effect = 'ALLOW'
            AND rp.data_scope <> 'Company'
            AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%')`,
        );
        expect(scoped.rows).toEqual([
          {
            role_name: "manager",
            action: "view",
            resource_type: "feed-report",
            data_scope: "Department",
          },
        ]);
      });

      it("census wildcard: 0 đường ngầm vào quyền SOCIAL (3 hình dạng wildcard, mọi role trừ super-admin)", async () => {
        // Hình dạng 2 (`<verb>:*`) + 3 (`*:<resource feed>`): cặp catalog mà CHỈ 0578 có thể sinh ra
        // (nó tạo đúng 14 cặp TƯỜNG MINH) ⇒ quét MỌI role, kể cả role tuỳ biến của tenant.
        const r = await direct.query(
          `SELECT ro.name::text AS role_name, p.action::text, p.resource_type::text
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.deleted_at IS NULL AND ro.name <> 'super-admin'
            AND ((p.action = '*' AND (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%'))
              OR (p.resource_type = '*' AND p.action IN ('view','create','manage','approve')))`,
        );
        expect(r.rows).toEqual([]);

        // Hình dạng 1 (`*:*`) KHÔNG do 0578 sinh — đó là cặp toàn-quyền của hệ phân quyền, và một role
        // TUỲ BIẾN của tenant mang `*:*` là quyết định HỢP LỆ của tenant admin (S14-FG có fixture đúng
        // hình dạng đó). Phạm vi DB-1 sở hữu là role HỆ THỐNG ⇒ lọc `company_id IS NULL`, KHÔNG assert
        // toàn cục (assert toàn cục = đỏ oan trên mọi DB thật; `invariant-count-must-filter-owned-rows`).
        // Câu hỏi "role tuỳ biến `*:*` có thấy feed không" thuộc PermissionService — nợ chuyển cho BE-1.
        const star = await direct.query(
          `SELECT ro.name::text AS role_name
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.deleted_at IS NULL AND ro.name <> 'super-admin' AND ro.company_id IS NULL
            AND p.action = '*' AND p.resource_type = '*'`,
        );
        expect(star.rows).toEqual([]);

        // Hình dạng bypass MẠNH NHẤT: object_permissions là grant EXACT sẵn.
        const obj = await direct.query(
          `SELECT count(*)::int AS n FROM object_permissions op JOIN permissions p ON p.id = op.permission_id
          WHERE p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%'`,
        );
        expect(obj.rows[0].n).toBe(0);
      });

      it("3 cặp `social-*` của fbpost KHÔNG bị chạm (tiền tố feed- là bắt buộc — DB-17 R7)", async () => {
        // Phạm vi sở hữu = role CANONICAL: 0544 seed 3 hàng social-* cho `company-admin`
        // (`company_id IS NULL`), và 0578 chỉ ghi vào role canonical. fbpost đã live nên tenant admin
        // hoàn toàn có thể cấp `view:social-post` cho role TUỲ BIẾN của họ (đo được thật trên lane DB
        // 20/09/2026: 5 hàng = 3 canonical + 2 tuỳ biến) — liệt kê toàn cục ở đây là đỏ oan, không phải lưới.
        const r = await direct.query(
          `SELECT ro.name::text AS role_name, p.action::text, p.resource_type::text, rp.data_scope::text
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE p.resource_type IN ('social-post', 'social-account') AND rp.effect = 'ALLOW'
            AND ro.name <> 'super-admin' AND ro.company_id IS NULL AND ro.deleted_at IS NULL
          ORDER BY p.resource_type, p.action`,
        );
        expect(r.rows).toEqual([
          {
            role_name: "company-admin",
            action: "manage",
            resource_type: "social-account",
            data_scope: "Company",
          },
          {
            role_name: "company-admin",
            action: "create",
            resource_type: "social-post",
            data_scope: "Company",
          },
          {
            role_name: "company-admin",
            action: "view",
            resource_type: "social-post",
            data_scope: "Company",
          },
        ]);
      });

      it("audit_logs.object_type: 132 giá trị, CÓ ĐỦ 5 feed_*, và canary cũ KHÔNG mất (NO-LOSS)", async () => {
        // ⚠️ RATCHET: 131 là mốc SAU khi 0579 thêm 4 giá trị vào 127 (đo 19/09/2026). Lane nào thêm
        // object_type mới thì sửa số này MỘT CÁCH CÓ CHỦ Ý — đó chính là điểm của ratchet.
        // Bump 131 → 132 CÓ CHỦ Ý (S16-SOCIAL-DB-2, plan §0): + `feed_kudos_badge` (mig 0583) — mở CHECK
        // cho audit CRUD catalog huy hiệu (SPEC-16 §18.1), nếu không BE-3 ăn 23514 khi ghi audit.
        const r = await direct.query(
          `SELECT substring(pg_get_constraintdef(oid)
                 FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\\([[:space:]]*''(\\{[^}]*\\})''')::text[] AS vals
           FROM pg_constraint
          WHERE conrelid = 'audit_logs'::regclass AND conname = 'audit_logs_object_type_chk'`,
        );
        const vals = r.rows[0].vals as string[];
        expect(vals).not.toBeNull();
        expect(vals).toHaveLength(132);
        expect(vals).toEqual(
          expect.arrayContaining([
            "feed_post",
            "feed_comment",
            "feed_group",
            "feed_report",
            "feed_kudos_badge",
          ]),
        );
        // NO-LOSS: canary 'defect' (0086 — chỉ có ở DB, không có trong snapshot TS) phải còn.
        expect(vals).toContain("defect");
        // KHÔNG trùng lặp (assert số học của 0579 canh vế này lúc migrate; đây là vế sống trong CI).
        expect(new Set(vals).size).toBe(vals.length);

        // Ghi audit với object_type mới phải ĐI ĐƯỢC — ca DƯƠNG cho UNION-ADD.
        const ok = await attempt(
          A.companyId,
          `INSERT INTO audit_logs (company_id, actor_user_id, action, action_group, object_type, object_id)
         VALUES ($1, $2, 'FeedPostHidden', 'CONTENT_MODERATION', 'feed_post', $3)`,
          [A.companyId, uA, postA],
        );
        expect(ok.code).toBeNull();
      });

      it("bộ đếm bất biến: like_count đếm ĐÚNG hàng THUỘC bài đó (không phải mọi reaction của tenant)", async () => {
        await withRole(direct, null, async (c) => {
          await c.query(
            `INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
           VALUES ($1, 'post', $2, $3, 'like'), ($1, 'comment', $4, $3, 'like')`,
            [A.companyId, postA, uA, commentA],
          );
          const r = await c.query(
            `SELECT count(*)::int AS n FROM feed_reactions
            WHERE company_id = $1 AND target_type = 'post' AND target_id = $2`,
            [A.companyId, postA],
          );
          // Lọc theo (target_type, target_id) — bỏ vế nào cũng đếm lẫn reaction của BÌNH LUẬN vào bài
          // (`invariant-count-must-filter-owned-rows`).
          expect(r.rows[0].n).toBe(1);
        });
      });

      it("idempotency: chạy lại 0578 + 0579 ⇒ 0 exception, count KHÔNG đổi (0577 thì PHẢI raise — xem ca dưới)", async () => {
        const COUNTS = `
        SELECT
          (SELECT count(*) FROM permissions WHERE resource_type = 'feed' OR resource_type LIKE 'feed-%') AS perms,
          (SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
             JOIN roles r ON r.id = rp.role_id
            WHERE (p.resource_type = 'feed' OR p.resource_type LIKE 'feed-%')
              AND r.deleted_at IS NULL
              -- S16-SOCIAL-BE-1B: lọc theo phạm vi SỞ HỮU của 0578 (role HỆ THỐNG) — xem khối
              -- giải thích dài ở ca «seed quyền: 14 cặp · 43 grant» phía trên.
              AND r.company_id IS NULL)                                                                  AS grants,
          (SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE p.resource_type IN ('social-post','social-account'))                                   AS fbpost_grants,
          (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'audit_logs_object_type_chk') AS audit_def`;
        const before = (await direct.query(COUNTS)).rows[0];
        for (const file of [
          "0578_s16socialdb1_seed_feed_perms.sql",
          "0579_s16socialdb1_audit_union_object_type.sql",
        ]) {
          const sql = readFileSync(path.join(__dirname, "..", "..", "migrations", file), "utf8");
          for (const stmt of sql.split("--> statement-breakpoint")) {
            // ⟲ **S16-SOCIAL-BE-1B (22/09/2026) — BỎ QUA KHỐI VERIFY khi CHẠY LẠI.** Tiền lệ trong
            // chính file này: ca «0577 chạy lại PHẢI RAISE» cũng chỉ chạy MỘT khối (`split(...)[0]`).
            //
            // ┌─ ĐÂY LÀ MỘT PHÁT HIỆN, KHÔNG PHẢI MỘT LỜI NỚI ───────────────────────────────────────┐
            // │ Khối `DO $$ … verify` của `0578` đếm grant `feed-*` trên **TOÀN BỘ role** rồi RAISE   │
            // │ nếu ≠ 43 (`[0578] verify: N grant feed tren toan bo role, ky vong 43`). Nó đếm cả role │
            // │ TUỲ BIẾN của tenant — thứ nó KHÔNG sở hữu và không kiểm soát được                      │
            // │ (`invariant-count-must-filter-owned-rows`). Hệ quả THẬT: `0578` **không re-run được**  │
            // │ trên bất kỳ DB nào đã có tenant cấp `feed-*` cho vai tuỳ biến — gồm mọi lane test sau  │
            // │ lượt int-spec đầu tiên, và một ngày nào đó là PROD (khôi phục backup rồi chạy lại      │
            // │ chain). Không sửa được tại chỗ: `0578` ĐÃ ÁP DỤNG ở mọi môi trường, sửa file đã áp là  │
            // │ đổi lịch sử migration. Nợ ghi ở `harness/backlog.mjs` (S16-SOCIAL-BE-2): cần một       │
            // │ migration SAU đặt lại verify theo phạm vi sở hữu, hoặc chấp nhận 0578 là một-lần.      │
            // │ Ca này vì vậy đo ĐÚNG thứ nó nên đo — **seed có idempotent không** (ON CONFLICT DO      │
            // │ NOTHING) — chứ không đo lại một verify vốn đã chạy một lần lúc áp thật.                 │
            // └──────────────────────────────────────────────────────────────────────────────────────┘
            if (/RAISE EXCEPTION\s+'\[0578\] verify/.test(stmt)) continue;
            if (
              stmt
                .trim()
                .replace(/^--.*$/gm, "")
                .trim().length === 0
            )
              continue;
            await direct.query(stmt);
          }
        }
        const after = (await direct.query(COUNTS)).rows[0];
        expect(after).toEqual(before);
      }, 60_000);

      it("0577 chạy lại PHẢI RAISE (tiền-kiểm to_regclass fail-loud) — tính năng, KHÔNG phải lỗi", async () => {
        // Bản plan v1 viết "chạy lại cả 3 migration ⇒ 0 exception" — TỰ MÂU THUẪN với tiền-kiểm của 0577.
        // Ca này ghim đúng hành vi: DDL không idempotent, và nó CỐ Ý như vậy (đụng tên = lane khác dựng
        // song song ⇒ DỪNG). Chỉ chạy khối tiền-kiểm (0), trong tx rollback.
        const sql = readFileSync(
          path.join(__dirname, "..", "..", "migrations", "0577_s16socialdb1_feed_track_a_ddl.sql"),
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
  },
);
