/**
 * S16-SOCIAL-AVATARPRESIGN-1 — mọi `avatarUrl` của SOCIAL là URL ĐÃ KÝ qua `AvatarPresignService`
 * (plan `docs/plans/S16-SOCIAL-AVATARPRESIGN-1.md` §5 — §10 ghi đè; owner ký D1–D10 02/10/2026).
 * Ca HÀNH VI; ca đếm câu (T-CNT · T-ZERO) ở `social-avatarpresign-1-count.int-spec.ts`.
 *
 * Cột `employee_profiles.avatar_url` lưu fileId và ĐA-NGƯỜI-GHI (HR · đề xuất đổi hồ sơ của chính nhân
 * viên). Ký mù = IDOR đọc tệp nội-tenant; chiếu thô = ảnh vỡ + rò fileId của người khác. Luật được đo:
 *   • chỉ CẶP (employeeId, fileId) có link `ME/avatar` sống mới được ký — đầu độc / tệp tenant khác /
 *     tệp không link ⇒ `null` (D-POISON · D-XTENANT · D-UNLINKED);
 *   • D2-b: SOCIAL chỉ ký fileId — `javascript:`/`data:`/URL ngoài ⇒ `null` (D-SCHEME);
 *   • che ảnh ⊆ che tên ở MỌI điểm (K1 · D9 · D13-a) và ref không che KHÔNG mở khoá ref đã che cùng
 *     người (D-K1 · D-K1-XREF · D-NAMEMASK · D-REPORTER);
 *   • `029` ký trong SAVEPOINT — lỗi câu cổng không cuốn quyết định kiểm duyệt (T-029-SP, D10);
 *   • WS không chở URL ký (WS-*, D3-b).
 *
 * Luật viết ca: mọi khẳng định «null/vắng» đi cùng một neo dương trên CÙNG response (ký thật chạy) —
 * thiếu neo thì «null» xanh-rỗng khi việc ký hỏng toàn bộ. Response parse bằng CHÍNH schema FE dùng.
 * KHÔNG import `social-avatar-signer` (RED phải nạp được file và đỏ ở hành vi, không ở import).
 * Boot qua `applyMainPipeline` (lưới pipeline-parity). GATE CỨNG `hasDb && LANE_DB`.
 */

import { Logger } from "@nestjs/common";
import {
  feedAckPageSchema,
  feedBirthdayListSchema,
  feedCommentCreatedSchema,
  feedCommentPageSchema,
  feedGroupMemberPageSchema,
  feedKudosPageSchema,
  feedPostCreatedSchema,
  feedPostPageSchema,
  feedPostSchema,
  feedReactorSchema,
  feedReportPageSchema,
  feedReportSchema,
  kudosRecipientSearchResultSchema,
} from "@mediaos/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TenantTx } from "../../src/db/db.service";
import { FileRepository } from "../../src/foundation/files/file.repository";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
import { hasDb } from "../helpers/integration-db";
import {
  SIGNED_RE,
  captured,
  gateQueries,
  gateValues,
  giveVerifiedAvatar,
} from "../helpers/social-avatar-fixtures";
import {
  MGR_DEPT,
  PLAIN,
  authorOf,
  bootAvatarWorld,
  byEmployee,
  peopleOfPost,
  peopleOfRows,
  recipientsOf,
  reportPeople,
  type AvatarWorld,
  type Json,
  type Person,
  type Shown,
  type Who,
} from "../helpers/social-avatar-world";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

/** Tên `Logger` của `SocialAvatarSigner` — lọc `logger.warn` mà KHÔNG import module. */
const SIGNER_LOGGER_CONTEXT = "SocialAvatarSigner";

describe.skipIf(!hasLaneDb)("S16-SOCIAL-AVATARPRESIGN-1 · ký avatar SOCIAL (DB cô lập)", () => {
  let w: AvatarWorld;

  beforeAll(async () => {
    w = await bootAvatarWorld("savp");
  }, 300_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await w?.close();
  }, 60_000);

  /**
   * D-POISON — trên các điểm chiếu của request: `viewer` (avatar_url = fileId ĐÃ XÁC MINH của author)
   * ⇒ `null`; neo: `author` ⇒ URL ký (≠ fileId thô).
   */
  function expectPoisonMasked(people: Shown[], where: string): void {
    const v = byEmployee(people, w.viewer.employeeId);
    const a = byEmployee(people, w.author.employeeId);
    expect(v, `${where}: viewer có mặt trên response`).toBeTruthy();
    expect(a, `${where}: author có mặt trên response (neo)`).toBeTruthy();
    expect(v!.avatar, `${where}: viewer đầu độc bằng fileId của author`).toBeNull();
    expect(a!.avatar, `${where}: neo — author được ký`).toMatch(SIGNED_RE);
    expect(a!.avatar).not.toBe(w.vA);
  }

  // ═══════════════════════ D-POISON — 15 route ═══════════════════════

  describe("D-POISON — viewer đầu độc `avatar_url` = fileId ĐÃ XÁC MINH của author ⇒ null", () => {
    it("003 GET /social/posts/:id (thẻ kudos: author + viewer là người nhận)", async () => {
      const dto = await w.getOk(w.viewer.token, `/social/posts/${w.kPost}`, feedPostSchema);
      expectPoisonMasked(peopleOfPost(dto), "003");
    });

    it("001 GET /social/feed", async () => {
      const page = await w.getOk(w.viewer.token, "/social/feed?limit=50", feedPostPageSchema);
      const mine = (page.data as Json[]).filter((c) =>
        [w.sPostA, w.sPostV, w.kPost].includes(c.id as string),
      );
      expect(mine, "001: đủ 3 thẻ dựng sẵn trên trang").toHaveLength(3);
      expectPoisonMasked(mine.flatMap(peopleOfPost), "001");
    });

    it("002 POST /social/posts (response của bài vinh danh)", async () => {
      const res = await w.post(w.mod.token, "/social/posts").send({
        type: "kudos",
        audience: "company",
        kudos: { recipientEmployeeIds: [w.viewer.employeeId, w.author.employeeId], message: "002" },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      feedPostCreatedSchema.parse(res.body.data);
      expectPoisonMasked(peopleOfPost(res.body.data as Json), "002");
    });

    it("004 PATCH /social/posts/:id (tác giả tự sửa)", async () => {
      const people: Shown[] = [];
      for (const [who, id] of [
        [w.viewer, w.sPostV],
        [w.author, w.sPostA],
      ] as const) {
        const res = await w.patch(who.token, `/social/posts/${id}`).send({ body: "Đã sửa" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        feedPostCreatedSchema.parse(res.body.data);
        people.push(authorOf(res.body.data as Json));
      }
      expectPoisonMasked(people, "004");
    });

    it("006 PATCH /social/posts/:id/moderation (response riêng, KHÔNG qua decorate)", async () => {
      const people: Shown[] = [];
      for (const id of [w.sPostV, w.sPostA]) {
        const res = await w
          .patch(w.mod.token, `/social/posts/${id}/moderation`)
          .send({ commentsLocked: false });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        feedPostSchema.parse(res.body.data);
        people.push(authorOf(res.body.data as Json));
      }
      expectPoisonMasked(people, "006");
    });

    it("014 GET /social/posts/:id/comments", async () => {
      const page = await w.getOk(
        w.mod.token,
        `/social/posts/${w.sPostA}/comments?limit=50`,
        feedCommentPageSchema,
      );
      expectPoisonMasked((page.data as Json[]).map(authorOf), "014");
    });

    it("015 POST /social/posts/:id/comments", async () => {
      const people: Shown[] = [];
      for (const who of [w.viewer, w.author]) {
        const res = await w
          .post(who.token, `/social/posts/${w.sPostV}/comments`)
          .send({ body: "015" });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        feedCommentCreatedSchema.parse(res.body.data);
        people.push(authorOf(res.body.data as Json));
      }
      expectPoisonMasked(people, "015");
    });

    it("013 GET /social/posts/:id/reactions", async () => {
      const res = await w.get(w.mod.token, `/social/posts/${w.sPostA}/reactions`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      z.array(feedReactorSchema).parse(res.body.data);
      expectPoisonMasked(peopleOfRows(res.body.data as Json[]), "013");
    });

    it("022 GET /social/posts/:id/acks (cả hai nửa)", async () => {
      for (const [id, state] of [
        [w.newsAck, "acked"],
        [w.newsUnack, "unacked"],
      ] as const) {
        const page = await w.getOk(
          w.mod.token,
          `/social/posts/${id}/acks?state=${state}&limit=100`,
          feedAckPageSchema,
        );
        expectPoisonMasked(peopleOfRows(page.data as Json[]), `022 ${state}`);
      }
    });

    it("026 GET /social/birthdays (khoá `avatar`)", async () => {
      const list = await w.getOk(
        w.viewer.token,
        "/social/birthdays?range=today",
        feedBirthdayListSchema,
      );
      expectPoisonMasked(peopleOfRows(list.data as Json[], "avatar"), "026");
    });

    it("037 GET /social/groups/:id/members", async () => {
      const page = await w.getOk(
        w.mod.token,
        `/social/groups/${w.groupId}/members?limit=100`,
        feedGroupMemberPageSchema,
      );
      expectPoisonMasked(peopleOfRows(page.data as Json[]), "037");
    });

    it("047 GET /social/kudos", async () => {
      const page = await w.getOk(
        w.viewer.token,
        "/social/kudos?page=1&limit=50",
        feedKudosPageSchema,
      );
      const row = (page.data as Json[]).find((k) => k.postId === w.kPost);
      expect(row, "047: dòng của bài vinh danh dựng sẵn").toBeTruthy();
      expectPoisonMasked(recipientsOf({ kudos: row }), "047");
    });

    it("059 GET /social/kudos/recipients?q=", async () => {
      const res = await w.getOk(
        w.mod.token,
        "/social/kudos/recipients?q=avatar",
        kudosRecipientSearchResultSchema,
      );
      expectPoisonMasked(peopleOfRows(res.data as Json[]), "059");
    });

    it("028 GET /social/reports (reporter = viewer · tác giả đích = author)", async () => {
      const page = await w.getOk(w.mod.token, "/social/reports?limit=100", feedReportPageSchema);
      const row = (page.data as Json[]).find((r) => r.id === w.rPoison);
      expect(row, "028: dòng báo cáo dựng sẵn").toBeTruthy();
      expectPoisonMasked(reportPeople(row!), "028");
    });

    it("029 PATCH /social/reports/:id (response sau khi xử lý)", async () => {
      const target = await w.share(w.author.token, "Bài sẽ bị báo cáo 029");
      const reportId = await w.report(w.viewer.token, target);
      const res = await w
        .patch(w.mod.token, `/social/reports/${reportId}`)
        .send({ status: "dismissed" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      feedReportSchema.parse(res.body.data);
      expectPoisonMasked(reportPeople(res.body.data as Json), "029");
    });
  });

  // ═════════════ D-SCHEME · D-XTENANT · D-UNLINKED — chỉ fileId xác minh của CHÍNH người đó ═════════════

  describe("chỉ CẶP (employeeId, fileId) đã xác minh được ký", () => {
    const schemeCard = async (): Promise<Shown[]> =>
      peopleOfPost(await w.getOk(w.viewer.token, `/social/posts/${w.schemePost}`, feedPostSchema));
    const expectAnchor = (people: Shown[], where: string): void => {
      expect(byEmployee(people, w.author.employeeId)?.avatar, `${where}: neo — author ký`).toMatch(
        SIGNED_RE,
      );
    };

    it("D-SCHEME — `javascript:` / `data:` ⇒ null; D2-b: URL https NGOÀI ⇒ null (initials)", async () => {
      const people = await schemeCard();
      expect(byEmployee(people, w.jsP.employeeId)?.avatar, "javascript:").toBeNull();
      expect(byEmployee(people, w.dataP.employeeId)?.avatar, "data:").toBeNull();
      expect(
        byEmployee(people, w.extP.employeeId)?.avatar,
        "D2-b: SOCIAL chỉ ký fileId",
      ).toBeNull();
      expectAnchor(people, "D-SCHEME");
    });

    it("D-SCHEME — 059 tìm thấy người mang `javascript:` ⇒ avatarUrl null", async () => {
      const res = await w.getOk(
        w.mod.token,
        "/social/kudos/recipients?q=avatar",
        kudosRecipientSearchResultSchema,
      );
      const people = peopleOfRows(res.data as Json[]);
      expect(byEmployee(people, w.jsP.employeeId), "059: jsP có mặt").toBeTruthy();
      expect(byEmployee(people, w.jsP.employeeId)!.avatar, "059 javascript:").toBeNull();
      expect(byEmployee(people, w.extP.employeeId)!.avatar, "059 D2-b").toBeNull();
      expectAnchor(people, "059");
    });

    it("D-XTENANT — fileId ĐÃ XÁC MINH của người tenant B ⇒ null", async () => {
      const people = await schemeCard();
      expect(byEmployee(people, w.foreignP.employeeId)?.avatar, "tệp tenant khác").toBeNull();
      expectAnchor(people, "D-XTENANT");
    });

    it("D-UNLINKED — ảnh của CHÍNH mình nhưng KHÔNG link ME/avatar ⇒ null", async () => {
      const people = await schemeCard();
      expect(byEmployee(people, w.unlinkedP.employeeId)?.avatar, "tệp không link").toBeNull();
      expectAnchor(people, "D-UNLINKED");
    });
  });

  // ═══════════════════════ K1 · D9 · D13-a — che ảnh ⊆ che tên ═══════════════════════

  describe("che ẢNH đi theo che TÊN — không ref nào mở khoá ref đã che", () => {
    it("D-K1 — người nhận có avatar ký; xoá mềm HỒ SƠ ⇒ null + isFormerEmployee", async () => {
      const k1p = await w.person(w.A, "Kmot Nhan");
      await giveVerifiedAvatar(w.direct, w.A.companyId, k1p.employeeId, k1p.userId!);
      const postId = await w.kudos(w.mod.token, [k1p.employeeId]);

      const before = await w.getOk(w.viewer.token, `/social/posts/${postId}`, feedPostSchema);
      expect(
        byEmployee(recipientsOf(before), k1p.employeeId)?.avatar,
        "neo: trước xoá mềm ⇒ ký",
      ).toMatch(SIGNED_RE);

      await w.direct.query(`UPDATE employee_profiles SET deleted_at = now() WHERE id = $1`, [
        k1p.employeeId,
      ]);
      const after = await w.getOk(w.viewer.token, `/social/posts/${postId}`, feedPostSchema);
      const r = ((after.kudos as Json).recipients as Json[]).find(
        (x) => x.employeeId === k1p.employeeId,
      );
      expect(r).toEqual({
        employeeId: k1p.employeeId,
        fullName: null,
        avatarUrl: null,
        isFormerEmployee: true,
      });
    });

    it("D-K1-XREF — CÙNG người: thẻ tác giả (không che) + ô người nhận đã che trên CÙNG trang ⇒ ô người nhận null", async () => {
      const x = await w.login(w.A, "Xoatk Tacgia", PLAIN);
      await giveVerifiedAvatar(w.direct, w.A.companyId, x.employeeId, x.userId);
      const xPost = await w.share(x.token, "Bài của X");
      const xKudos = await w.kudos(w.author.token, [x.employeeId]);
      await w.direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [x.userId]);

      const masked = {
        employeeId: x.employeeId,
        fullName: null,
        avatarUrl: null,
        isFormerEmployee: true,
      };
      const page = await w.getOk(w.viewer.token, "/social/feed?limit=20", feedPostPageSchema);
      const cards = page.data as Json[];
      const xCard = cards.find((c) => c.id === xPost);
      const kCard = cards.find((c) => c.id === xKudos);
      expect(xCard && kCard, "001: trang chứa CẢ thẻ của X lẫn thẻ vinh danh X").toBeTruthy();
      expect(authorOf(xCard!).employeeId).toBe(x.employeeId);
      expect(authorOf(xCard!).avatar, "neo: thẻ tác giả X (không che theo TK) được ký").toMatch(
        SIGNED_RE,
      );
      const rx = ((kCard!.kudos as Json).recipients as Json[]).find(
        (r) => r.employeeId === x.employeeId,
      );
      expect(rx, "001: ô người nhận X (TK xoá mềm) KHÔNG mượn chữ ký của thẻ tác giả").toEqual(
        masked,
      );

      const detail = await w.getOk(w.viewer.token, `/social/posts/${xKudos}`, feedPostSchema);
      expect(authorOf(detail).avatar, "003 neo: tác giả thẻ kudos ký").toMatch(SIGNED_RE);
      expect(((detail.kudos as Json).recipients as Json[])[0], "003").toEqual(masked);

      const list = await w.getOk(
        w.viewer.token,
        "/social/kudos?page=1&limit=50",
        feedKudosPageSchema,
      );
      const rows = list.data as Json[];
      const anchorRow = rows.find((k) => k.postId === w.kPost);
      expect(
        byEmployee(recipientsOf({ kudos: anchorRow }), w.author.employeeId)?.avatar,
        "047 neo",
      ).toMatch(SIGNED_RE);
      const xRow = rows.find((k) => k.postId === xKudos);
      expect((xRow!.recipients as Json[])[0], "047").toEqual(masked);
    });

    describe("D-NAMEMASK (D9) — TK khoá / TK xoá mềm ⇒ tên null VÀ ảnh null, fileId KHÔNG vào câu cổng", () => {
      let live: Person;
      let locked: Person;
      let delAcc: Person;
      let noAcc: Person;
      const files = new Map<string, string>();

      beforeAll(async () => {
        live = await w.person(w.A, "Nm Song", { dob: w.dobToday });
        locked = await w.person(w.A, "Nm Khoa", { dob: w.dobToday });
        delAcc = await w.person(w.A, "Nm Xoa", { dob: w.dobToday });
        noAcc = await w.person(w.A, "Nm Khongtk", { dob: w.dobToday, account: false });
        for (const p of [live, locked, delAcc]) {
          const f = await giveVerifiedAvatar(w.direct, w.A.companyId, p.employeeId, p.userId!);
          files.set(p.employeeId, f);
        }
        // HR-managed: HR (mod) sở hữu tệp + tạo link — hồ sơ KHÔNG có tài khoản.
        const fNo = await giveVerifiedAvatar(
          w.direct,
          w.A.companyId,
          noAcc.employeeId,
          w.mod.userId,
        );
        files.set(noAcc.employeeId, fNo);
        await w.direct.query(`UPDATE users SET status = 'locked' WHERE id = $1`, [locked.userId]);
        await w.direct.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [delAcc.userId]);
      }, 60_000);

      function expectNameMask(
        rows: Json[],
        values: unknown[],
        avatarKey: "avatar" | "avatarUrl",
        where: string,
      ): void {
        const by = new Map(rows.map((r) => [r.employeeId as string, r]));
        expect(by.get(live.employeeId)?.[avatarKey], `${where}: neo — người sống được ký`).toMatch(
          SIGNED_RE,
        );
        expect(values, `${where}: neo — fileId người sống vào câu cổng`).toContain(
          files.get(live.employeeId),
        );
        for (const [p, label] of [
          [locked, "TK khoá"],
          [delAcc, "TK xoá mềm"],
        ] as const) {
          const row = by.get(p.employeeId);
          expect(row, `${where}: ${label} vẫn có dòng (không đổi tập hàng)`).toBeTruthy();
          expect(row!.fullName, `${where}: ${label} — tên bị che`).toBeNull();
          expect(row![avatarKey], `${where}: ${label} — ảnh che theo tên`).toBeNull();
          expect(values, `${where}: ${label} — fileId không rời SQL`).not.toContain(
            files.get(p.employeeId),
          );
        }
      }

      /**
       * Owner SỬA D9 02/10/2026 (FULL gate lượt 1, CHỈ `026`): hồ sơ KHÔNG tài khoản không có đường tự ẩn
       * (`show_birthday` sống ở TK) ⇒ trên widget sinh nhật cả công ty, ảnh chỉ đi kèm TK SỐNG. Mọi bề
       * mặt khác giữ D9 như đã ký («vắng ≠ che»). Dòng VẪN ra — bỏ dòng là câu hỏi của
       * S16-SOCIAL-BDAYMASKED-1. Neo dương: người sống ký + fileId của họ vào câu cổng (`expectNameMask`).
       */
      it("026 GET /social/birthdays — hồ sơ KHÔNG tài khoản ⇒ ảnh null, fileId KHÔNG vào câu cổng (owner sửa D9)", async () => {
        const { out: res, qs } = await captured(async () =>
          w.get(w.viewer.token, "/social/birthdays?range=today"),
        );
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        feedBirthdayListSchema.parse(res.body.data);
        const rows = res.body.data.data as Json[];
        const values = gateValues(qs);
        expectNameMask(rows, values, "avatar", "026");
        const row = rows.find((r) => r.employeeId === noAcc.employeeId);
        expect(row, "026: hồ sơ không TK vẫn có dòng (không đổi tập hàng)").toBeTruthy();
        expect(row!.fullName, "026: hồ sơ không TK — tên vắng").toBeNull();
        expect(row!.avatar, "026: hồ sơ không TK — ảnh null (owner sửa D9)").toBeNull();
        expect(values, "026: fileId hồ sơ không TK không rời SQL").not.toContain(
          files.get(noAcc.employeeId),
        );
      });

      it("022 GET /social/posts/:id/acks?state=unacked", async () => {
        const { out: res, qs } = await captured(async () =>
          w.get(w.mod.token, `/social/posts/${w.newsUnack}/acks?state=unacked&limit=100`),
        );
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        feedAckPageSchema.parse(res.body.data);
        expectNameMask(res.body.data.data as Json[], gateValues(qs), "avatarUrl", "022 unacked");
      });
    });

    describe("D-REPORTER (D13-a) — người tố giác bị che thì ảnh của họ KHÔNG vào lô ký", () => {
      let rep: Who;
      let mgrDept: Who;
      let vR = "";
      let vT = "";
      let repReport = "";

      beforeAll(async () => {
        rep = await w.login(w.A, "Totiac Nguoi", PLAIN, { orgUnitId: w.ouX });
        const tgt = await w.login(w.A, "Bitocao Tacgia", PLAIN, { orgUnitId: w.ouX });
        mgrDept = await w.login(w.A, "Truong Donvi", MGR_DEPT, {
          orgUnitId: w.ouX,
          reportScope: "Department",
        });
        vR = await giveVerifiedAvatar(w.direct, w.A.companyId, rep.employeeId, rep.userId);
        vT = await giveVerifiedAvatar(w.direct, w.A.companyId, tgt.employeeId, tgt.userId);
        const tgtPost = await w.createPost(tgt.token, {
          type: "share",
          audience: "org_unit",
          orgUnitId: w.ouX,
          body: "Bài của đơn vị X",
        });
        repReport = await w.report(rep.token, tgtPost);
      }, 60_000);

      /** Tiền điều kiện trên CHÍNH trang: `rep` không là tác giả đích / người xử lý của dòng nào. */
      function expectRepOnlyReporter(rows: Json[]): void {
        for (const r of rows) {
          expect((r.targetSnapshot as Json | null)?.authorEmployeeId).not.toBe(rep.employeeId);
          expect((r.resolvedBy as Json | null)?.employeeId).not.toBe(rep.employeeId);
        }
      }

      it("(1) neo DƯƠNG — actor @Company thấy reporter + ảnh ký, fileId người tố giác VÀO câu cổng", async () => {
        const { out: res, qs } = await captured(async () =>
          w.get(w.mod.token, "/social/reports?limit=100"),
        );
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        feedReportPageSchema.parse(res.body.data);
        const rows = res.body.data.data as Json[];
        expectRepOnlyReporter(rows);
        const reporter = rows.find((r) => r.id === repReport)!.reporter as Json;
        expect(reporter.employeeId).toBe(rep.employeeId);
        expect(reporter.avatarUrl, "neo (1): reporter ký").toMatch(SIGNED_RE);
        expect(gateValues(qs)).toContain(vR);
      });

      it("(2) manager @Department — reporter null VÀ fileId người tố giác KHÔNG vào câu cổng", async () => {
        const { out: res, qs } = await captured(async () =>
          w.get(mgrDept.token, "/social/reports?limit=100"),
        );
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        feedReportPageSchema.parse(res.body.data);
        const rows = res.body.data.data as Json[];
        expectRepOnlyReporter(rows);
        const row = rows.find((r) => r.id === repReport);
        expect(row, "manager thấy hàng của đơn vị mình").toBeTruthy();
        expect(gateQueries(qs).length, "(2): ĐÚNG một câu cổng").toBe(1);
        expect(gateValues(qs), "neo (2): tác giả đích vào lô ký").toContain(vT);
        expect((row!.targetSnapshot as Json).avatarUrl, "neo (2): tác giả đích ký").toMatch(
          SIGNED_RE,
        );
        expect(row!.reporter, "D13-a: manager không thấy người tố giác").toBeNull();
        expect(gateValues(qs), "ảnh người tố giác không vào lô ký").not.toContain(vR);
      });
    });
  });

  // ═══════════════════════ T-029-SP (D10) — lỗi câu cổng trong tx ghi ═══════════════════════

  it("T-029-SP — câu cổng LỖI trong tx của 029 ⇒ 200, quyết định + audit VẪN commit, ảnh về initials", async () => {
    const target = await w.share(w.author.token, "Bài cho T-029-SP");
    const reportId = await w.report(w.viewer.token, target);
    const spy = vi
      .spyOn(w.app.get(FileRepository), "findVerifiedAvatarsTx")
      .mockImplementationOnce(async (_companyId: string, _ids: string[], tx: TenantTx) => {
        await tx.execute(sql`select 1/0`); // lỗi CÂU thật trong tx của route (22012)
        return [];
      });
    const warn = vi.spyOn(Logger.prototype, "warn");
    try {
      const res = await w
        .patch(w.mod.token, `/social/reports/${reportId}`)
        .send({ status: "dismissed" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(spy, "neo: câu cổng ĐÃ chạy trong 029").toHaveBeenCalledTimes(1);
      expect((res.body.data.targetSnapshot as Json).avatarUrl, "ký lỗi ⇒ initials").toBeNull();
      const st = await w.direct.query(`SELECT status FROM feed_reports WHERE id = $1`, [reportId]);
      expect(st.rows[0].status, "quyết định kiểm duyệt ĐÃ commit").toBe("dismissed");
      const audit = await w.direct.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE object_id = $1 AND action = 'social.report.dismissed'`,
        [reportId],
      );
      expect(audit.rows[0].n, "audit ĐÃ commit cùng tx").toBe(1);
      const signerWarns = warn.mock.contexts.filter(
        (c) => (c as { context?: string } | undefined)?.context === SIGNER_LOGGER_CONTEXT,
      );
      expect(signerWarns.length, "ký lỗi KHÔNG im lặng (logger.warn của signer)").toBe(1);
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });

  // ═══════════════════════ WS (D3-b) — URL ký KHÔNG lên room ═══════════════════════

  describe("WS — `author.avatarUrl` trên kênh phát (room công ty · room nhóm) là null tại NGUỒN", () => {
    it("WS-POST — feed:post.created", async () => {
      const spy = vi.spyOn(w.app.get(RealtimeEmitterService), "emitFeedPostCreated");
      try {
        const res = await w
          .post(w.author.token, "/social/posts")
          .send({ type: "share", audience: "company", body: "WS bài" });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(spy, "bài company + published được phát").toHaveBeenCalledTimes(1);
        const payload = spy.mock.calls[0]![1] as unknown as Json;
        expect((payload.author as Json).avatarUrl, "WS: URL ký là capability TTL").toBeNull();
        expect((res.body.data.author as Json).avatarUrl, "neo: REST 002 ký").toMatch(SIGNED_RE);
      } finally {
        spy.mockRestore();
      }
    });

    // Hợp nhất S16-SOCIAL-BE-2C: bài `audience='group'` giờ CŨNG được phát (room `co:{c}:feedgroup:{g}`,
    // biến thể `group` của union) — nguồn `buildWsPostCreatedEvent` phải ép `null` cho CẢ biến thể này.
    it("WS-POST-GROUP — feed:post.created biến thể NHÓM (BE-2C) cũng `author.avatarUrl` null", async () => {
      const spy = vi.spyOn(w.app.get(RealtimeEmitterService), "emitFeedPostCreated");
      try {
        const res = await w
          .post(w.author.token, "/social/posts")
          .send({ type: "share", audience: "group", groupId: w.groupId, body: "WS bài nhóm" });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(spy, "bài nhóm + published được phát (BE-2C)").toHaveBeenCalledTimes(1);
        const payload = spy.mock.calls[0]![1] as unknown as Json;
        expect(payload.audience, "neo: biến thể nhóm").toBe("group");
        expect(payload.groupId, "neo: đích là nhóm của bài").toBe(w.groupId);
        expect((payload.author as Json).avatarUrl, "WS nhóm: URL ký không lên room").toBeNull();
        expect((res.body.data.author as Json).avatarUrl, "neo: REST 002 ký").toMatch(SIGNED_RE);
      } finally {
        spy.mockRestore();
      }
    });

    it("WS-CMT — feed:comment.created", async () => {
      const spy = vi.spyOn(w.app.get(RealtimeEmitterService), "emitFeedCommentCreated");
      try {
        const res = await w
          .post(w.author.token, `/social/posts/${w.sPostV}/comments`)
          .send({ body: "WS bình luận" });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(spy, "bình luận trên bài company được phát").toHaveBeenCalledTimes(1);
        const payload = spy.mock.calls[0]![1] as unknown as Json;
        expect((payload.author as Json).avatarUrl, "WS: URL ký là capability TTL").toBeNull();
        expect((res.body.data.author as Json).avatarUrl, "neo: REST 015 ký").toMatch(SIGNED_RE);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
