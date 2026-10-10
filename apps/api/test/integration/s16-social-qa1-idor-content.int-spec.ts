/**
 * S16-SOCIAL-QA-1 (L3) — ĐỐI TƯỢNG CỦA NGƯỜI KHÁC TRONG CÙNG CÔNG TY: bình luận · quyền sở hữu ·
 * xác nhận đọc · nhóm · danh sách (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L3, D4 · D5 · D10).
 *
 *   QA1-I-C-016…019, I-C-del, I-C-5   route theo `comment_id` + bình luận cha (API-19 §6.5)
 *   QA1-I-O-1…5                       sửa / xoá / đóng nội dung của người khác (SPEC-16 §12 ERR-003)
 *   QA1-I-A-1…3                       xác nhận đã đọc chỉ ghi cho chính người gọi (API-19, dòng 021)
 *   QA1-I-G-1…4, I-G-7                cổng nhóm: thấy nhóm · vai trong nhóm · đăng vào nhóm
 *   QA1-I-L-1…3                       danh sách không còn trả bài nhóm cho người đã rời nhóm
 *
 * Mỗi ca từ chối đứng cạnh ca cho phép SONG SINH (cùng request, người gọi chỉ khác đúng tư cách). Trên
 * route đổi trạng thái / phá huỷ: từ chối → «DB không đổi» → cho phép trên CHÍNH đối tượng đó.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_ERR } from "../../src/social/social.errors";
import { hasDb } from "../helpers/integration-db";
import {
  countAudit,
  countPostsBy,
  snapComment,
  snapGroup,
  snapPost,
} from "../helpers/social-qa1-idor-util";
import {
  EMPLOYEE_FEED_PAIRS,
  addComment,
  bootQa1World,
  createGroup,
  expectSocial,
  joinAsActiveMember,
  joinGroup,
  newsPost,
  pollPost,
  reactComment,
  sameErrorBody,
  savePost,
  sharePost,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;

const dump = (res: Qa1Res): string => `${res.status} ${JSON.stringify(res.body)}`;
const lite = (res: { status: number; body: unknown }): Qa1Res => ({
  status: res.status,
  body: res.body as Qa1Res["body"],
});

type SocialKey = keyof typeof SOCIAL_ERROR_CODES & keyof typeof SOCIAL_ERR;

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-QA-1 · L3 · nội dung và nhóm của người khác trong cùng công ty (DB cô lập)",
  () => {
    let w: Qa1World;
    /** Chủ nhóm + tác giả nội dung mẫu: 7 cặp nhân viên + cặp tin tức. KHÔNG có cặp kiểm duyệt bài. */
    let owner: Qa1Actor;
    /** Thành viên thường (đang hoạt động) của cả nhóm kín lẫn nhóm công khai. */
    let mem: Qa1Actor;
    /** Thành viên thường của nhóm kín, giữ thêm cặp kiểm duyệt bài. */
    let memMod: Qa1Actor;
    /** Người ngoài mọi nhóm. */
    let outs: Qa1Actor;
    /** Người ngoài mọi nhóm, giữ thêm cặp kiểm duyệt bài. */
    let outMod: Qa1Actor;
    /** Đang CHỜ DUYỆT ở nhóm kín (giữ nguyên suốt file). */
    let pend: Qa1Actor;
    /** Vai `hr` canonical thật (đủ cặp, gồm cặp kiểm duyệt bài). */
    let hr: Qa1Actor;
    let closedGroupId: string;
    let openGroupId: string;

    const A = (): string => w.A.companyId;
    const expectErr = (res: Qa1Res, status: number, key: SocialKey): void =>
      expectSocial(res, status, SOCIAL_ERR[key], SOCIAL_ERROR_CODES[key]);
    const emp = (label: string): Promise<Qa1Actor> =>
      w.actor(w.A, label, { pairs: EMPLOYEE_FEED_PAIRS });
    const listIds = async (a: Qa1Actor, url: string): Promise<string[]> => {
      const res = await w.get(a.token, url);
      expect(res.status, `${a.label} ${url}: ${JSON.stringify(res.body)}`).toBe(200);
      return ((res.body.data as { data: Array<{ id: string }> }).data ?? []).map((p) => p.id);
    };

    beforeAll(async () => {
      w = await bootQa1World("qa1idorc");
      owner = await w.actor(w.A, "owner", { pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-news"] });
      mem = await emp("mem");
      memMod = await w.actor(w.A, "memmod", {
        pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-post"],
      });
      outs = await emp("outs");
      outMod = await w.actor(w.A, "outmod", {
        pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-post"],
      });
      pend = await emp("pend");
      hr = await w.actor(w.A, "hr", { canonical: "hr" });

      closedGroupId = (await createGroup(w, owner, "private")).id;
      openGroupId = (await createGroup(w, owner, "public")).id;
      await joinAsActiveMember(w, owner, mem, closedGroupId);
      await joinAsActiveMember(w, owner, memMod, closedGroupId);
      await joinAsActiveMember(w, owner, mem, openGroupId);
      expect((await joinGroup(w, pend, closedGroupId)).myStatus).toBe("pending");
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await w?.close();
    });

    // ══════════════ I-C — route theo comment_id ══════════════

    describe("C · bình luận", () => {
      let groupPostId: string;

      /** Bốn route theo `comment_id`: [mã, người bị từ chối, song sinh, lời gọi, mã thành công]. */
      const patch = (a: Qa1Actor, id: string) =>
        w.patch(a.token, `/social/comments/${id}`).send({ body: "Bình luận đã sửa (L3)" });
      const remove = (a: Qa1Actor, id: string) => w.del(a.token, `/social/comments/${id}`);
      const react = (a: Qa1Actor, id: string) =>
        w.put(a.token, `/social/comments/${id}/reaction`).send({ emoji: "like" });
      const unreact = (a: Qa1Actor, id: string) =>
        w.del(a.token, `/social/comments/${id}/reaction`);

      beforeAll(async () => {
        groupPostId = (
          await sharePost(w, owner, "Bài trong nhóm kín (I-C)", {
            audience: "group",
            groupId: closedGroupId,
          })
        ).id;
      });

      const rows = [
        ["016", () => outMod, () => memMod, patch],
        ["017", () => outMod, () => memMod, remove],
        ["018", () => outs, () => mem, react],
        ["019", () => outs, () => mem, unreact],
      ] as const;

      it.each(rows)(
        "QA1-I-C-%s · bình luận trên bài không thấy ⇒ 404 như id không tồn tại, không đổi; thành viên cùng bộ cặp ⇒ 200",
        async (code, deniedOf, twinOf, call) => {
          const commentId = (await addComment(w, owner, groupPostId)).id;
          const before = await snapComment(w.direct, A(), commentId);

          const denied = lite(await call(deniedOf(), commentId));
          expectErr(denied, 404, "COMMENT_NOT_FOUND");
          sameErrorBody(denied, lite(await call(deniedOf(), randomUUID())), "so với id bịa");
          expect(await snapComment(w.direct, A(), commentId)).toBe(before);

          if (code === "019") await reactComment(w, twinOf(), commentId);
          const ok = await call(twinOf(), commentId);
          expect(ok.status, `song sinh: ${JSON.stringify(ok.body)}`).toBe(200);
        },
      );

      it("QA1-I-C-del · bình luận đã xoá: cả bốn route ⇒ 404 như id không tồn tại; trước khi xoá cùng request ⇒ 200", async () => {
        const postId = (await sharePost(w, owner)).id;
        const commentId = (await addComment(w, owner, postId)).id;

        // Trước khi xoá: cùng người, cùng request ⇒ 200 (017 của tác giả chính là phép xoá).
        for (const [what, res] of [
          ["016", await patch(owner, commentId)],
          ["018", await react(outs, commentId)],
          ["019", await unreact(outs, commentId)],
          ["017", await remove(owner, commentId)],
        ] as const) {
          expect(res.status, `${what} trước khi xoá: ${JSON.stringify(res.body)}`).toBe(200);
        }

        const before = await snapComment(w.direct, A(), commentId);
        for (const [what, call, who] of [
          ["016", patch, owner],
          ["017", remove, owner],
          ["018", react, outs],
          ["019", unreact, outs],
        ] as const) {
          const res = lite(await call(who, commentId));
          expectErr(res, 404, "COMMENT_NOT_FOUND");
          sameErrorBody(res, lite(await call(who, randomUUID())), `${what} so với id bịa`);
        }
        expect(await snapComment(w.direct, A(), commentId)).toBe(before);
      });

      it("QA1-I-C-5 · trả lời một bình luận thuộc bài KHÁC (hoặc đã xoá) ⇒ 404 theo MÃ, không bình luận nào được ghi; đúng bài ⇒ 201", async () => {
        const first = (await sharePost(w, owner)).id;
        const second = (await sharePost(w, owner)).id;
        const parentId = (await addComment(w, owner, first)).id;
        const reply = (postId: string, parent: string) =>
          w
            .post(outs.token, `/social/posts/${postId}/comments`)
            .send({ body: "Trả lời (I-C-5)", parentCommentId: parent });

        const before = await snapPost(w.direct, A(), second);
        expectErr(lite(await reply(second, parentId)), 404, "COMMENT_NOT_FOUND");
        expect(await snapPost(w.direct, A(), second)).toBe(before);

        const ok = await reply(first, parentId);
        expect(ok.status, `song sinh đúng bài: ${JSON.stringify(ok.body)}`).toBe(201);

        // Cha đã xoá: cùng request vừa thành công giờ ⇒ 404.
        const gone = (await addComment(w, owner, first)).id;
        const twin = await reply(first, gone);
        expect(twin.status, JSON.stringify(twin.body)).toBe(201);
        expect((await w.del(owner.token, `/social/comments/${gone}`)).status).toBe(200);
        expectErr(lite(await reply(first, gone)), 404, "COMMENT_NOT_FOUND");
      });
    });

    // ══════════════ I-O — nội dung của người khác ══════════════

    describe("O · sửa / xoá / đóng nội dung của người khác", () => {
      interface OwnCase {
        id: string;
        code: string;
        ok: 200 | 201;
        action: string;
        /** Hành động của chủ nội dung lên chính nội dung của mình có vào sổ audit không. */
        ownerAudited: boolean;
        make(): Promise<string>;
        call(a: Qa1Actor, id: string): PromiseLike<{ status: number; body: unknown }>;
        snap(id: string): Promise<string>;
      }
      const post = (id: string): Promise<string> => snapPost(w.direct, A(), id);
      const comment = (id: string): Promise<string> => snapComment(w.direct, A(), id);
      const newComment = async (): Promise<string> =>
        (await addComment(w, owner, (await sharePost(w, owner)).id)).id;

      const cases: readonly OwnCase[] = [
        {
          id: "QA1-I-O-1",
          code: "004",
          ok: 200,
          action: "social.post.update",
          ownerAudited: false,
          make: async () => (await sharePost(w, owner)).id,
          call: (a, id) => w.patch(a.token, `/social/posts/${id}`).send({ body: "Sửa (I-O-1)" }),
          snap: post,
        },
        {
          id: "QA1-I-O-2",
          code: "005",
          ok: 200,
          action: "social.post.delete",
          ownerAudited: false,
          make: async () => (await sharePost(w, owner)).id,
          call: (a, id) => w.del(a.token, `/social/posts/${id}`),
          snap: post,
        },
        {
          id: "QA1-I-O-3",
          code: "016",
          ok: 200,
          action: "social.comment.update",
          ownerAudited: false,
          make: newComment,
          call: (a, id) => w.patch(a.token, `/social/comments/${id}`).send({ body: "Sửa (I-O-3)" }),
          snap: comment,
        },
        {
          id: "QA1-I-O-4",
          code: "017",
          ok: 200,
          action: "social.comment.delete",
          ownerAudited: false,
          make: newComment,
          call: (a, id) => w.del(a.token, `/social/comments/${id}`),
          snap: comment,
        },
        {
          id: "QA1-I-O-5",
          code: "044",
          ok: 201,
          action: "social.poll.close",
          ownerAudited: true,
          make: async () => (await pollPost(w, owner)).id,
          call: (a, id) => w.post(a.token, `/social/posts/${id}/poll/close`),
          snap: post,
        },
      ];

      it.each(cases)(
        "$id · $code: người khác ⇒ 403 theo MÃ, không đổi; chủ nội dung ⇒ thành công; vai hr ⇒ thành công + đúng 1 hàng audit",
        async (c) => {
          const mine = await c.make();
          const forHr = await c.make();
          const audit = (a: Qa1Actor): Promise<number> =>
            countAudit(w.direct, A(), c.action, a.userId);

          // Vế từ chối trên CẢ HAI đối tượng, rồi mới tới vế cho phép.
          const before = [await c.snap(mine), await c.snap(forHr)];
          const auditBefore = [await audit(outs), await audit(owner), await audit(hr)];
          for (const id of [mine, forHr]) {
            expectErr(lite(await c.call(outs, id)), 403, "NOT_CONTENT_OWNER");
          }
          expect([await c.snap(mine), await c.snap(forHr)]).toEqual(before);
          expect(await audit(outs), "từ chối thì không có hàng audit").toBe(auditBefore[0]);

          const byOwner = await c.call(owner, mine);
          expect(byOwner.status, `chủ nội dung: ${JSON.stringify(byOwner.body)}`).toBe(c.ok);
          expect(await audit(owner)).toBe(auditBefore[1] + (c.ownerAudited ? 1 : 0));
          expect(await c.snap(mine), "chủ nội dung thật sự ghi").not.toBe(before[0]);

          const byHr = await c.call(hr, forHr);
          expect(byHr.status, `vai hr: ${JSON.stringify(byHr.body)}`).toBe(c.ok);
          expect(await audit(hr)).toBe(auditBefore[2] + 1);
        },
      );

      it("QA1-I-O-4b · chủ BÀI không xoá được bình luận của người khác trên bài mình; tác giả bình luận thì xoá được", async () => {
        const postId = (await sharePost(w, owner)).id;
        const commentId = (await addComment(w, outs, postId)).id;
        const before = await snapComment(w.direct, A(), commentId);

        expectErr(
          lite(await w.del(owner.token, `/social/comments/${commentId}`)),
          403,
          "NOT_CONTENT_OWNER",
        );
        expect(await snapComment(w.direct, A(), commentId)).toBe(before);

        const ok = await w.del(outs.token, `/social/comments/${commentId}`);
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      });
    });

    // ══════════════ I-A — xác nhận đã đọc ══════════════

    describe("A · xác nhận đã đọc", () => {
      const acks = async (postId: string): Promise<Array<{ user_id: string; at: string }>> =>
        (
          await w.direct.query<{ user_id: string; at: string }>(
            `SELECT user_id, acked_at::text AS at FROM feed_post_acks
              WHERE post_id = $1 AND company_id = $2 ORDER BY user_id`,
            [postId, A()],
          )
        ).rows;

      it("QA1-I-A-1 · thân lạ gửi kèm bị bỏ qua: chỉ có hàng xác nhận của chính người gọi", async () => {
        const newsId = (await newsPost(w, owner, { requiresAck: true })).id;
        const res = await w.post(outs.token, `/social/posts/${newsId}/ack`).send({
          userId: mem.userId,
          employeeId: mem.employeeId,
          ackedAt: "2001-02-03T04:05:06.000Z",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);

        const rows = await acks(newsId);
        expect(rows.map((r) => r.user_id)).toEqual([outs.userId]);
        expect(rows[0].at.startsWith("2001-")).toBe(false);

        // Neo dương: người được nêu trong thân lạ tự xác nhận thì mới có hàng của họ.
        const own = await w.post(mem.token, `/social/posts/${newsId}/ack`);
        expect(own.status, JSON.stringify(own.body)).toBe(201);
        expect((await acks(newsId)).map((r) => r.user_id).sort()).toEqual(
          [outs.userId, mem.userId].sort(),
        );
      });

      it("QA1-I-A-2 · xác nhận lặp giữ nguyên mốc cũ, vẫn đúng một hàng", async () => {
        const newsId = (await newsPost(w, owner, { requiresAck: true })).id;
        const first = await w.post(outs.token, `/social/posts/${newsId}/ack`);
        expect(first.status, JSON.stringify(first.body)).toBe(201);
        const [row] = await acks(newsId);

        const again = await w.post(outs.token, `/social/posts/${newsId}/ack`);
        expect(again.status, JSON.stringify(again.body)).toBe(201);
        expect((again.body.data as Json).firstTime).toBe(false);
        expect((again.body.data as Json).ackedAt).toBe((first.body.data as Json).ackedAt);
        expect(await acks(newsId)).toEqual([row]);
      });

      it("QA1-I-A-3 · tin không yêu cầu xác nhận ⇒ 409 theo MÃ, không hàng nào; tin có yêu cầu ⇒ 201", async () => {
        const plainId = (await newsPost(w, owner, { requiresAck: false })).id;
        expectErr(
          lite(await w.post(outs.token, `/social/posts/${plainId}/ack`)),
          409,
          "ACK_NOT_APPLICABLE",
        );
        expect(await acks(plainId)).toEqual([]);

        const needId = (await newsPost(w, owner, { requiresAck: true })).id;
        const ok = await w.post(outs.token, `/social/posts/${needId}/ack`);
        expect(ok.status, JSON.stringify(ok.body)).toBe(201);
        expect((ok.body.data as Json).firstTime).toBe(true);
      });
    });

    // ══════════════ I-G — cổng nhóm ══════════════

    describe("G · nhóm", () => {
      const card = (a: Qa1Actor, id: string) => w.get(a.token, `/social/groups/${id}`);
      const members = (a: Qa1Actor, id: string) => w.get(a.token, `/social/groups/${id}/members`);

      it.each([
        ["QA1-I-G-1", "032", card],
        ["QA1-I-G-3", "037", members],
      ] as const)(
        "%s · %s nhóm kín: người ngoài và người đang chờ duyệt ⇒ 404 như id không tồn tại; thành viên ⇒ 200",
        async (_id, _code, call) => {
          for (const who of [outs, pend]) {
            const denied = lite(await call(who, closedGroupId));
            expectErr(denied, 404, "GROUP_NOT_FOUND");
            sameErrorBody(
              denied,
              lite(await call(who, randomUUID())),
              `${who.label} so với id bịa`,
            );
          }
          const ok = await call(mem, closedGroupId);
          expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        },
      );

      it("QA1-I-G-3b · 037 nhóm công khai: chưa tham gia ⇒ 403 theo MÃ; thành viên ⇒ 200", async () => {
        expectErr(lite(await members(outs, openGroupId)), 403, "GROUP_ROLE_REQUIRED");
        const ok = await members(mem, openGroupId);
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      });

      it("QA1-I-G-2 · thành viên thường sửa / xoá nhóm ⇒ 403 theo MÃ, nhóm không đổi; chủ nhóm ⇒ 200", async () => {
        const groupId = (await createGroup(w, owner, "private")).id;
        await joinAsActiveMember(w, owner, mem, groupId);
        const edit = (a: Qa1Actor) =>
          w.patch(a.token, `/social/groups/${groupId}`).send({ description: "Mô tả (I-G-2)" });
        const drop = (a: Qa1Actor) => w.del(a.token, `/social/groups/${groupId}`);

        const before = await snapGroup(w.direct, A(), groupId);
        expectErr(lite(await edit(mem)), 403, "GROUP_ROLE_REQUIRED");
        expectErr(lite(await drop(mem)), 403, "GROUP_ROLE_REQUIRED");
        expect(await snapGroup(w.direct, A(), groupId)).toBe(before);

        const edited = await edit(owner);
        expect(edited.status, `033 chủ nhóm: ${JSON.stringify(edited.body)}`).toBe(200);
        const dropped = await drop(owner);
        expect(dropped.status, `034 chủ nhóm: ${JSON.stringify(dropped.body)}`).toBe(200);
      });

      it("QA1-I-G-4 · thành viên thường duyệt / gỡ thành viên ⇒ 403 theo MÃ, danh sách không đổi; chủ nhóm ⇒ 200", async () => {
        const groupId = (await createGroup(w, owner, "private")).id;
        const waiting = await emp("waiting");
        const other = await emp("other");
        await joinAsActiveMember(w, owner, mem, groupId);
        await joinAsActiveMember(w, owner, other, groupId);
        expect((await joinGroup(w, waiting, groupId)).myStatus).toBe("pending");
        const approve = (a: Qa1Actor) =>
          w
            .patch(a.token, `/social/groups/${groupId}/members/${waiting.userId}`)
            .send({ decision: "approve" });
        const kick = (a: Qa1Actor) =>
          w.del(a.token, `/social/groups/${groupId}/members/${other.userId}`);

        const before = await snapGroup(w.direct, A(), groupId);
        expectErr(lite(await approve(mem)), 403, "GROUP_ROLE_REQUIRED");
        expectErr(lite(await kick(mem)), 403, "GROUP_ROLE_REQUIRED");
        expect(await snapGroup(w.direct, A(), groupId)).toBe(before);

        const approved = await approve(owner);
        expect(approved.status, `038 chủ nhóm: ${JSON.stringify(approved.body)}`).toBe(200);
        const kicked = await kick(owner);
        expect(kicked.status, `039 chủ nhóm: ${JSON.stringify(kicked.body)}`).toBe(200);
      });

      it("QA1-I-G-7 · đăng bài vào nhóm khi chưa là thành viên đang hoạt động ⇒ từ chối theo MÃ, không bài nào được tạo; thành viên ⇒ 201", async () => {
        const send = (a: Qa1Actor, groupId: string) =>
          w
            .post(a.token, "/social/posts")
            .send({ type: "share", audience: "group", groupId, body: "Bài vào nhóm (I-G-7)" });
        const before = [
          await countPostsBy(w.direct, A(), outs.userId),
          await countPostsBy(w.direct, A(), pend.userId),
        ];

        // Nhóm công khai, chưa tham gia: thấy nhóm nhưng không được ghi ⇒ 403.
        expectErr(lite(await send(outs, openGroupId)), 403, "WRITE_OUT_OF_AUDIENCE");
        // Nhóm kín, đang chờ duyệt: chưa thấy nhóm ⇒ 404 như id không tồn tại (API-19 §6.5 «404 trước 403»).
        const pending = lite(await send(pend, closedGroupId));
        expectErr(pending, 404, "GROUP_NOT_FOUND");
        sameErrorBody(pending, lite(await send(pend, randomUUID())), "so với id bịa");
        expect([
          await countPostsBy(w.direct, A(), outs.userId),
          await countPostsBy(w.direct, A(), pend.userId),
        ]).toEqual(before);

        for (const groupId of [openGroupId, closedGroupId]) {
          const ok = await send(mem, groupId);
          expect(ok.status, `song sinh thành viên: ${dump(lite(ok))}`).toBe(201);
        }
      });
    });

    // ══════════════ I-L — danh sách ══════════════

    describe("L · danh sách", () => {
      it("QA1-I-L-1 · feed theo nhóm kín: người ngoài và người đang chờ duyệt nhận danh sách rỗng như id không tồn tại; thành viên thấy bài", async () => {
        const postId = (
          await sharePost(w, owner, "Bài nhóm kín (I-L-1)", {
            audience: "group",
            groupId: closedGroupId,
          })
        ).id;
        expect(await listIds(mem, `/social/feed?groupId=${closedGroupId}`)).toContain(postId);

        for (const who of [outs, pend]) {
          const res = await w.get(who.token, `/social/feed?groupId=${closedGroupId}`);
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          expect((res.body.data as { data: unknown[] }).data).toEqual([]);
          const ghost = await w.get(who.token, `/social/feed?groupId=${randomUUID()}`);
          expect(ghost.status, JSON.stringify(ghost.body)).toBe(200);
          expect(res.body.data).toEqual(ghost.body.data);
        }
      });

      it.each([
        ["QA1-I-L-2", "bài nhóm đã lưu biến khỏi danh sách đã lưu", "/social/saved?limit=50"],
        ["QA1-I-L-3", "tin của nhóm biến khỏi danh sách tin tức", "/social/news?limit=50"],
      ] as const)("%s · sau khi bị gỡ khỏi nhóm: %s", async (id, _what, url) => {
        const leaver = await emp(`leaver${id.slice(-1)}`);
        await joinAsActiveMember(w, owner, leaver, closedGroupId);
        const groupNews = await newsPost(w, owner, {
          requiresAck: true,
          audience: "group",
          groupId: closedGroupId,
        });
        const companyNews = await newsPost(w, owner, { requiresAck: true });
        await savePost(w, leaver, groupNews.id);
        await savePost(w, leaver, companyNews.id);

        // Trước khi gỡ: thấy cả hai.
        const seen = await listIds(leaver, url);
        expect(seen).toContain(groupNews.id);
        expect(seen).toContain(companyNews.id);

        const kicked = await w.del(
          owner.token,
          `/social/groups/${closedGroupId}/members/${leaver.userId}`,
        );
        expect(kicked.status, JSON.stringify(kicked.body)).toBe(200);

        // Sau khi gỡ: bài nhóm biến mất; bài toàn công ty còn (neo dương); thành viên khác vẫn thấy.
        const after = await listIds(leaver, url);
        expect(after).not.toContain(groupNews.id);
        expect(after).toContain(companyNews.id);
        if (url.startsWith("/social/news")) {
          expect(await listIds(mem, url)).toContain(groupNews.id);
        }
        // Hàng «đã lưu» không bị xoá — chỉ là không còn thấy.
        const kept = await w.direct.query(
          `SELECT 1 FROM feed_saved_posts WHERE post_id = $1 AND user_id = $2 AND company_id = $3`,
          [groupNews.id, leaver.userId, A()],
        );
        expect(kept.rowCount).toBe(1);
      });
    });
  },
);
