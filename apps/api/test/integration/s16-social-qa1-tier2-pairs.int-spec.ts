/**
 * S16-SOCIAL-QA-1 (L2) — CẶP KIỂM Ở TẦNG 2 + phạm vi của vai quản lý
 * (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L2, D2 · D5).
 *
 *   QA1-M-T-1…5   route đăng bài: cặp theo LOẠI bài + cờ chính thức (API-19 §5.1b)
 *   QA1-M-T-6, 7  route kiểm duyệt: cặp theo TỪNG trường (API-19 §5.1c)
 *   QA1-M-T-8     xử lý báo cáo kèm hành động (API-19 §5.1h)
 *   QA1-M-T-9     can thiệp nhóm từ ngoài bằng cặp quản trị nhóm (API-19 §5.1, dòng 033…039)
 *   QA1-M-T-10    cửa đăng ký tệp: cặp theo `target` (API-19 §5.1e)
 *   QA1-M-S-1…3   vai manager canonical ở hàng đợi báo cáo + thống kê: chỉ đơn vị mình (API-19 §5.1j)
 *
 * Mỗi ca từ chối có ca cho phép SONG SINH: CÙNG request, người gọi chỉ khác đúng một cặp (D5). Trên
 * route đổi trạng thái, vế từ chối chạy TRƯỚC, rồi kiểm «DB không đổi», rồi tới vế cho phép trên
 * chính đối tượng đó.
 *
 * M-T dùng vai TUỲ BIẾN ở công ty A; M-S dùng vai canonical thật ở công ty B (để số liệu thống kê
 * của M-S không lẫn bài của các ca M-T).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import {
  EMPLOYEE_FEED_PAIRS,
  FEED_PAIRS,
  bootQa1World,
  createGroup,
  expectGuardDenied,
  expectSocial,
  joinGroup,
  newsPost,
  reportTarget,
  sharePost,
  type FeedPair,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { QA1_FILE_UPLOAD_BODY } from "../helpers/social-qa1-routes";
import { ensureQa1FileDoorEnv } from "../helpers/social-qa1-seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;

const dump = (res: Qa1Res): string => `${res.status} ${JSON.stringify(res.body)}`;
const without = (pair: FeedPair): FeedPair[] => EMPLOYEE_FEED_PAIRS.filter((p) => p !== pair);
const plus = (...extra: FeedPair[]): FeedPair[] => [...EMPLOYEE_FEED_PAIRS, ...extra];

type SocialKey = keyof typeof SOCIAL_ERROR_CODES & keyof typeof SOCIAL_ERR;

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-QA-1 · L2 · cặp tầng 2 + scope của manager (DB cô lập)",
  () => {
    let w: Qa1World;
    let priv: Qa1Actor;
    let emp: Qa1Actor;

    const scalar = async <T>(sql: string, params: unknown[]): Promise<T | undefined> =>
      (await w.direct.query<{ v: T }>(sql, params)).rows[0]?.v;
    const postsBy = (a: Qa1Actor): Promise<number | undefined> =>
      scalar<number>(
        `SELECT count(*)::int AS v FROM feed_posts WHERE company_id = $1 AND author_user_id = $2`,
        [a.tenant.companyId, a.userId],
      );
    const deny = (res: Qa1Res, key: SocialKey): void =>
      expectSocial(res, 403, SOCIAL_ERR[key], SOCIAL_ERROR_CODES[key]);

    beforeAll(async () => {
      ensureQa1FileDoorEnv();
      w = await bootQa1World("qa1tier2");
      priv = await w.actor(w.A, "priv", { pairs: FEED_PAIRS });
      emp = await w.actor(w.A, "emp", { pairs: EMPLOYEE_FEED_PAIRS });
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await w?.close();
    });

    // ══════════════ M-T-1…5 — route đăng bài: cặp theo loại ══════════════

    describe("T · 002 cặp theo loại bài", () => {
      /** Cùng thân, hai người gọi: người thiếu đúng một cặp ⇒ 403 theo MÃ + 0 bài; người đủ cặp ⇒ 201. */
      async function typeGate(opts: {
        denied: Qa1Actor;
        allowed: Qa1Actor;
        body: Json;
        key: SocialKey;
        type: string;
      }): Promise<void> {
        const before = await postsBy(opts.denied);
        deny(await w.post(opts.denied.token, "/social/posts").send(opts.body), opts.key);
        expect(await postsBy(opts.denied), "từ chối thì không bài nào được tạo").toBe(before);

        // Đối chứng: người bị từ chối vẫn đăng được bài `share` (cặp sàn của route vẫn có).
        const control = await w
          .post(opts.denied.token, "/social/posts")
          .send({ type: "share", audience: "company", body: "Bài đối chứng" });
        expect(control.status, `đối chứng share: ${dump(control)}`).toBe(201);

        const ok = await w.post(opts.allowed.token, "/social/posts").send(opts.body);
        expect(ok.status, `song sinh cho phép: ${dump(ok)}`).toBe(201);
        expect((ok.body.data as Json).type).toBe(opts.type);
      }

      it("QA1-M-T-1 · tin tức cần thêm cặp quản lý tin tức", async () => {
        await typeGate({
          denied: emp,
          allowed: await w.actor(w.A, "empnews", { pairs: plus("manage:feed-news") }),
          body: { type: "news", audience: "company", body: "Tin của ca M-T-1", requiresAck: false },
          key: "NEWS_MANAGE_REQUIRED",
          type: "news",
        });
      });

      it("QA1-M-T-2 · bình chọn cần cặp tạo bình chọn", async () => {
        await typeGate({
          denied: await w.actor(w.A, "nopoll", { pairs: without("create:feed-poll") }),
          allowed: emp,
          body: {
            type: "poll",
            audience: "company",
            poll: { question: "Câu hỏi M-T-2", options: ["Một", "Hai"] },
          },
          key: "POLL_CREATE_REQUIRED",
          type: "poll",
        });
      });

      it("QA1-M-T-3 · sáng kiến cần cặp gửi sáng kiến", async () => {
        await typeGate({
          denied: await w.actor(w.A, "noidea", { pairs: without("create:feed-idea") }),
          allowed: emp,
          body: { type: "idea", audience: "company", body: "Sáng kiến của ca M-T-3" },
          key: "IDEA_CREATE_REQUIRED",
          type: "idea",
        });
      });

      it("QA1-M-T-4 · vinh danh cần cặp gửi vinh danh", async () => {
        await typeGate({
          denied: await w.actor(w.A, "nokudos", { pairs: without("create:feed-kudos") }),
          allowed: emp,
          body: {
            type: "kudos",
            audience: "company",
            kudos: { recipientEmployeeIds: [priv.employeeId], message: "Cảm ơn (M-T-4)" },
          },
          key: "KUDOS_CREATE_REQUIRED",
          type: "kudos",
        });
      });

      it("QA1-M-T-5 · cờ vinh danh chính thức cần thêm cặp quản lý vinh danh", async () => {
        await typeGate({
          denied: emp,
          allowed: await w.actor(w.A, "empofficial", { pairs: plus("manage:feed-kudos") }),
          body: {
            type: "kudos",
            audience: "company",
            kudos: {
              recipientEmployeeIds: [priv.employeeId],
              message: "Cảm ơn (M-T-5)",
              isOfficial: true,
            },
          },
          key: "KUDOS_OFFICIAL_DENIED",
          type: "kudos",
        });
      });
    });

    // ══════════════ M-T-6, 7 — kiểm duyệt: cặp theo trường ══════════════

    describe("T · 006 cặp theo trường", () => {
      let newsOnly: Qa1Actor;
      let postOnly: Qa1Actor;
      let both: Qa1Actor;
      let newsId: string;

      const pinned = (): Promise<boolean | undefined> =>
        scalar<boolean>(`SELECT pinned AS v FROM feed_posts WHERE id = $1 AND company_id = $2`, [
          newsId,
          w.A.companyId,
        ]);
      const pin = (a: Qa1Actor) =>
        w.patch(a.token, `/social/posts/${newsId}/moderation`).send({ pinned: true });

      beforeAll(async () => {
        newsOnly = await w.actor(w.A, "newsonly", { pairs: plus("manage:feed-news") });
        postOnly = await w.actor(w.A, "postonly", { pairs: plus("manage:feed-post") });
        both = await w.actor(w.A, "modboth", {
          pairs: plus("manage:feed-news", "manage:feed-post"),
        });
        newsId = (await newsPost(w, priv)).id;
      });

      it("QA1-M-T-6 · có cặp tin tức nhưng thiếu cặp sàn của route ⇒ 403 tầng 1, kể cả khi chỉ gửi `pinned`", async () => {
        expectGuardDenied(await pin(newsOnly), "006 pinned · thiếu manage:feed-post");
        expect(await pinned()).toBe(false);
      });

      it("QA1-M-T-7 · có cặp sàn nhưng thiếu cặp của trường `pinned` ⇒ 403 theo MÃ, bài không đổi", async () => {
        deny(await pin(postOnly), "MODERATION_FIELD_DENIED");
        expect(await pinned()).toBe(false);

        // Đối chứng: chính người này đổi được trường thuộc cặp mình giữ, trên CÙNG bài.
        const lock = await w
          .patch(postOnly.token, `/social/posts/${newsId}/moderation`)
          .send({ commentsLocked: true });
        expect(lock.status, `đối chứng commentsLocked: ${dump(lock)}`).toBe(200);
      });

      it("QA1-M-T-6/7 song sinh · đủ hai cặp ⇒ 200, bài được ghim", async () => {
        const res = await pin(both);
        expect(res.status, dump(res)).toBe(200);
        expect(await pinned()).toBe(true);
      });
    });

    // ══════════════ M-T-8 — xử lý báo cáo kèm hành động ══════════════

    describe("T · 029 hành động kèm", () => {
      it("QA1-M-T-8 · hành động kèm cần thêm cặp kiểm duyệt bài; thiếu ⇒ 403 theo MÃ, báo cáo còn mở", async () => {
        const reportOnly = await w.actor(w.A, "reportonly", {
          pairs: ["view:feed", "manage:feed-report"],
        });
        const reportMod = await w.actor(w.A, "reportmod", {
          pairs: ["view:feed", "manage:feed-report", "manage:feed-post"],
        });
        const post = await sharePost(w, emp);
        const report = await reportTarget(w, priv, "post", post.id);
        const body = { status: "resolved", action: "hide_post" };
        const state = async (): Promise<[string | undefined, string | undefined]> => [
          await scalar<string>(
            `SELECT status AS v FROM feed_reports WHERE id = $1 AND company_id = $2`,
            [report.id, w.A.companyId],
          ),
          await scalar<string>(
            `SELECT status AS v FROM feed_posts WHERE id = $1 AND company_id = $2`,
            [post.id, w.A.companyId],
          ),
        ];

        deny(
          await w.patch(reportOnly.token, `/social/reports/${report.id}`).send(body),
          "REPORT_ACTION_DENIED",
        );
        expect(await state()).toEqual(["open", "published"]);

        // Đối chứng: chính người này xử lý được một báo cáo KHÁC khi không kèm hành động.
        const other = await reportTarget(w, priv, "post", (await sharePost(w, emp)).id);
        const plain = await w
          .patch(reportOnly.token, `/social/reports/${other.id}`)
          .send({ status: "resolved" });
        expect(plain.status, `đối chứng không hành động: ${dump(plain)}`).toBe(200);

        const ok = await w.patch(reportMod.token, `/social/reports/${report.id}`).send(body);
        expect(ok.status, `song sinh cho phép: ${dump(ok)}`).toBe(200);
        expect(await state()).toEqual(["resolved", "hidden"]);
      });
    });

    // ══════════════ M-T-9 — can thiệp nhóm từ ngoài ══════════════

    describe("T · nhóm 033 / 034 / 037 / 038 / 039 qua cặp quản trị nhóm", () => {
      let outsider: Qa1Actor;
      let groupMgr: Qa1Actor;
      let member: Qa1Actor;
      let groupId: string;

      const memberRow = async (): Promise<string> =>
        JSON.stringify(
          (
            await w.direct.query(
              `SELECT m.role, m.status, g.deleted_at, g.description
                 FROM feed_group_members m JOIN feed_groups g ON g.id = m.group_id
                WHERE m.company_id = $1 AND m.group_id = $2 AND m.user_id = $3`,
              [w.A.companyId, groupId, member.userId],
            )
          ).rows,
        );

      /** Năm request, theo thứ tự chạy: đọc → sửa → đổi vai → gỡ thành viên → xoá nhóm. */
      const calls: ReadonlyArray<readonly [string, (a: Qa1Actor) => PromiseLike<Qa1Res>]> = [
        ["037", (a) => w.get(a.token, `/social/groups/${groupId}/members`)],
        [
          "033",
          (a) => w.patch(a.token, `/social/groups/${groupId}`).send({ description: "Mô tả M-T-9" }),
        ],
        [
          "038",
          (a) =>
            w
              .patch(a.token, `/social/groups/${groupId}/members/${member.userId}`)
              .send({ role: "admin" }),
        ],
        ["039", (a) => w.del(a.token, `/social/groups/${groupId}/members/${member.userId}`)],
        ["034", (a) => w.del(a.token, `/social/groups/${groupId}`)],
      ];

      beforeAll(async () => {
        outsider = await w.actor(w.A, "outsider", { pairs: ["view:feed"] });
        groupMgr = await w.actor(w.A, "groupmgr", { pairs: ["view:feed", "manage:feed-group"] });
        member = await w.actor(w.A, "member", { pairs: ["view:feed"] });
        groupId = (await createGroup(w, emp, "public")).id;
        expect((await joinGroup(w, member, groupId)).myStatus).toBe("active");
      });

      it("QA1-M-T-9 · người ngoài nhóm: thiếu cặp ⇒ 403 theo MÃ trên cả năm route, nhóm không đổi; có cặp ⇒ 200", async () => {
        const before = await memberRow();
        for (const [code, call] of calls) {
          const res = await call(outsider);
          expectSocial(
            { status: res.status, body: res.body },
            403,
            SOCIAL_ERR.GROUP_ROLE_REQUIRED,
            SOCIAL_ERROR_CODES.GROUP_ROLE_REQUIRED,
          );
          expect(await memberRow(), `${code}: nhóm không đổi sau từ chối`).toBe(before);
        }

        for (const [code, call] of calls) {
          const res = await call(groupMgr);
          expect(res.status, `${code} song sinh cho phép: ${dump(res)}`).toBe(200);
        }
        expect(await memberRow(), "thành viên đã bị gỡ").toBe("[]");
        expect(
          await scalar<boolean>(
            `SELECT (deleted_at IS NOT NULL) AS v FROM feed_groups WHERE id = $1 AND company_id = $2`,
            [groupId, w.A.companyId],
          ),
        ).toBe(true);
      });

      it("QA1-M-T-9b · cặp quản trị nhóm mở thẻ nhóm kín nhưng KHÔNG mở bài trong nhóm", async () => {
        const closed = await createGroup(w, emp, "private");
        const post = await sharePost(w, emp, "Bài trong nhóm kín", {
          audience: "group",
          groupId: closed.id,
        });

        // Thẻ nhóm: thiếu cặp ⇒ 404; có cặp ⇒ 200.
        expectSocial(
          await w.get(outsider.token, `/social/groups/${closed.id}`),
          404,
          SOCIAL_ERR.GROUP_NOT_FOUND,
          SOCIAL_ERROR_CODES.GROUP_NOT_FOUND,
        );
        const card = await w.get(groupMgr.token, `/social/groups/${closed.id}`);
        expect(card.status, dump(card)).toBe(200);

        // Bài trong nhóm: người có cặp quản trị nhóm vẫn ⇒ 404; thành viên ⇒ 200 (neo dương).
        expectSocial(
          await w.get(groupMgr.token, `/social/posts/${post.id}`),
          404,
          SOCIAL_ERR.POST_NOT_FOUND,
          SOCIAL_ERROR_CODES.POST_NOT_FOUND,
        );
        const mine = await w.get(emp.token, `/social/posts/${post.id}`);
        expect(mine.status, dump(mine)).toBe(200);
      });
    });

    // ══════════════ M-T-10 — cửa đăng ký tệp theo `target` ══════════════

    describe("T · 054 / 055 cặp theo `target`", () => {
      const sides = [
        ["post", "create:feed-post", "FILE_TARGET_POST_DENIED"],
        ["comment", "create:feed-comment", "FILE_TARGET_COMMENT_DENIED"],
      ] as const;

      it.each(sides)("QA1-M-T-10 · target=%s cần cặp %s", async (target, pair, key) => {
        const otherPair: FeedPair =
          pair === "create:feed-post" ? "create:feed-comment" : "create:feed-post";
        const otherTarget = target === "post" ? "comment" : "post";
        const holder = await w.actor(w.A, `file${target}yes`, { pairs: ["view:feed", pair] });
        const lacking = await w.actor(w.A, `file${target}no`, {
          pairs: ["view:feed", otherPair],
        });
        const register = (a: Qa1Actor, t: string) =>
          w.post(a.token, "/social/files/upload-url").send({ ...QA1_FILE_UPLOAD_BODY, target: t });
        const filesOf = (a: Qa1Actor): Promise<number | undefined> =>
          scalar<number>(
            `SELECT count(*)::int AS v FROM files WHERE company_id = $1 AND uploaded_by = $2`,
            [w.A.companyId, a.userId],
          );

        // 054 — thiếu cặp của đích ⇒ 403 theo MÃ, không tệp nào được đăng ký.
        const before = await filesOf(lacking);
        deny(await register(lacking, target), key);
        expect(await filesOf(lacking)).toBe(before);
        const ok = await register(holder, target);
        expect(ok.status, `054 song sinh cho phép: ${dump(ok)}`).toBe(200);

        // 055 — tệp của CHÍNH người thiếu cặp (đăng ký qua đích mà họ được phép), xác nhận với đích bị cấm.
        const own = await register(lacking, otherTarget);
        expect(own.status, `054 đối chứng đích kia: ${dump(own)}`).toBe(200);
        const fileId = (own.body.data as Json).fileId as string;
        const marked = await w.direct.query(
          `UPDATE files SET upload_status = 'Uploaded' WHERE id = $1 AND company_id = $2`,
          [fileId, w.A.companyId],
        );
        expect(marked.rowCount).toBe(1);
        deny(await w.post(lacking.token, `/social/files/${fileId}/confirm`).send({ target }), key);
        const confirm = await w
          .post(lacking.token, `/social/files/${fileId}/confirm`)
          .send({ target: otherTarget });
        expect(confirm.status, `055 song sinh cho phép: ${dump(confirm)}`).toBe(200);
      });
    });

    // ══════════════ M-S-1…3 — manager canonical chỉ thấy đơn vị mình ══════════════

    describe("S · manager canonical ở 028 / 052 / 053", () => {
      let mgr: Qa1Actor;
      let hr: Qa1Actor;
      let unitMine: string;
      let unitOther: string;
      let reporterMine: Qa1Actor;
      let reportMine: string;
      let reportOther: string;
      let reportCompany: string;

      const NAME_MINE = "QA1 Don vi cua quan ly";
      const NAME_OTHER = "QA1 Don vi khac";
      const ENGAGEMENT = "/social/stats/engagement";
      const EXPORT = "/social/stats/engagement/export";

      interface Stats {
        units: Array<{ orgUnitId: string | null }>;
        rows: Array<{ orgUnitId: string | null; posts: number }>;
        weekTotals: Array<{ posts: number }>;
      }
      const stats = async (a: Qa1Actor, query = ""): Promise<Stats> => {
        const res = await w.get(a.token, `${ENGAGEMENT}${query}`);
        expect(res.status, `${a.label} 052${query}: ${JSON.stringify(res.body)}`).toBe(200);
        return res.body.data as Stats;
      };
      const totalPosts = (s: Stats): number => s.weekTotals.reduce((n, x) => n + x.posts, 0);

      const unitNamesInExport = async (a: Qa1Actor, query = ""): Promise<string[]> => {
        const res = await w
          .get(a.token, `${EXPORT}${query}`)
          .buffer(true)
          .parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on("data", (c: Buffer) => chunks.push(c));
            r.on("end", () => cb(null, Buffer.concat(chunks)));
          });
        expect(res.status, `${a.label} 053${query}`).toBe(200);
        const ExcelJS = await import("exceljs");
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(res.body as Parameters<typeof wb.xlsx.load>[0]);
        const sheet = wb.getWorksheet("Theo đơn vị");
        if (!sheet) throw new Error("053: thiếu sheet «Theo đơn vị»");
        const names: string[] = [];
        sheet.eachRow((row, n) => {
          if (n > 1) names.push(String((row.values as unknown[])[2]));
        });
        return names;
      };

      beforeAll(async () => {
        unitMine = await w.orgUnit(w.B, NAME_MINE);
        unitOther = await w.orgUnit(w.B, NAME_OTHER);
        mgr = await w.actor(w.B, "mgr", { canonical: "manager", orgUnitId: unitMine });
        hr = await w.actor(w.B, "hr", { canonical: "hr" });
        const authorMine = await w.actor(w.B, "authormine", {
          canonical: "employee",
          orgUnitId: unitMine,
        });
        reporterMine = await w.actor(w.B, "reportermine", {
          canonical: "employee",
          orgUnitId: unitMine,
        });
        const authorOther = await w.actor(w.B, "authorother", {
          canonical: "employee",
          orgUnitId: unitOther,
        });
        const reporterOther = await w.actor(w.B, "reporterother", {
          canonical: "employee",
          orgUnitId: unitOther,
        });

        // Bài `org_unit` trong đơn vị của manager · bài `org_unit` ngoài đơn vị · bài `company`.
        const inMine = await sharePost(w, authorMine, "Bài trong đơn vị của quản lý", {
          audience: "org_unit",
          orgUnitId: unitMine,
        });
        const inOther = await sharePost(w, authorOther, "Bài của đơn vị khác", {
          audience: "org_unit",
          orgUnitId: unitOther,
        });
        const company = await sharePost(w, authorOther, "Bài toàn công ty");
        reportMine = (await reportTarget(w, reporterMine, "post", inMine.id)).id;
        reportOther = (await reportTarget(w, reporterOther, "post", inOther.id)).id;
        reportCompany = (await reportTarget(w, reporterMine, "post", company.id)).id;
      });

      it("QA1-M-S-1 · 028: manager chỉ thấy báo cáo về bài của đơn vị mình, không thấy người báo cáo; hr thấy đủ", async () => {
        type Row = { id: string; reporter: Json | null };
        const queue = async (a: Qa1Actor): Promise<Row[]> => {
          const res = await w.get(a.token, "/social/reports?limit=100");
          expect(res.status, `${a.label} 028: ${JSON.stringify(res.body)}`).toBe(200);
          return (res.body.data as { data: Row[] }).data;
        };

        // Vế cho phép trước: hr thấy cả ba báo cáo và thấy người báo cáo.
        const all = await queue(hr);
        expect(all.map((r) => r.id).sort()).toEqual(
          [reportMine, reportOther, reportCompany].sort(),
        );
        const hrRow = all.find((r) => r.id === reportMine);
        expect(hrRow?.reporter?.employeeId).toBe(reporterMine.employeeId);

        const mine = await queue(mgr);
        expect(mine.map((r) => r.id)).toEqual([reportMine]);
        expect(mine[0]).toHaveProperty("reporter", null);
        expect(JSON.stringify(mine)).not.toContain("Bài của đơn vị khác");
        expect(JSON.stringify(mine)).not.toContain("Bài toàn công ty");
      });

      it("QA1-M-S-2 · 052: manager chỉ thấy đơn vị mình; hỏi đơn vị khác ⇒ 403 theo MÃ; hr thấy đủ", async () => {
        const full = await stats(hr);
        expect(new Set(full.units.map((u) => u.orgUnitId))).toEqual(new Set([unitMine, unitOther]));
        expect(totalPosts(full)).toBe(3);

        const scoped = await stats(mgr);
        expect(scoped.units.map((u) => u.orgUnitId)).toEqual([unitMine]);
        expect(scoped.rows.map((r) => r.orgUnitId)).toEqual([unitMine]);
        expect(totalPosts(scoped)).toBe(1);

        deny(
          await w.get(mgr.token, `${ENGAGEMENT}?orgUnitId=${unitOther}`),
          "STATS_UNIT_OUT_OF_SCOPE",
        );
        // Song sinh: CÙNG request với hr ⇒ 200; và manager hỏi đơn vị của chính mình ⇒ 200.
        expect(totalPosts(await stats(hr, `?orgUnitId=${unitOther}`))).toBe(2);
        expect(totalPosts(await stats(mgr, `?orgUnitId=${unitMine}`))).toBe(1);
      });

      it("QA1-M-S-3 · 053: tệp xuất của manager chỉ có đơn vị mình; hỏi đơn vị khác ⇒ 403 theo MÃ; hr xuất đủ", async () => {
        const mineOnly = await unitNamesInExport(mgr);
        expect(mineOnly.length).toBeGreaterThan(0);
        expect(mineOnly.every((n) => n.startsWith(NAME_MINE))).toBe(true);

        const everything = await unitNamesInExport(hr);
        expect(everything.some((n) => n.startsWith(NAME_MINE))).toBe(true);
        expect(everything.some((n) => n.startsWith(NAME_OTHER))).toBe(true);

        deny(await w.get(mgr.token, `${EXPORT}?orgUnitId=${unitOther}`), "STATS_UNIT_OUT_OF_SCOPE");
        const other = await unitNamesInExport(hr, `?orgUnitId=${unitOther}`);
        expect(other.length).toBeGreaterThan(0);
        expect(other.every((n) => n.startsWith(NAME_OTHER))).toBe(true);
      });
    });
  },
);
