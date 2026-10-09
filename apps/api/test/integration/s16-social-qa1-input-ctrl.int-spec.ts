/**
 * S16-SOCIAL-QA-1 — QA1-F-1: chuỗi đầu vào chứa ký tự U+0000 ⇒ 400 chuẩn, không ghi gì.
 *
 * U+0000 là ký tự duy nhất kho dữ liệu không lưu được trong cột văn bản. Biên đầu vào của SOCIAL từ
 * chối nó bằng ĐÚNG hình dạng lỗi validation của kho (`VALIDATION-ERR-001` + `details[]` nêu trường),
 * không dội lại nội dung đã gửi. Lớp chặn: `src/social/social-input-text.pipe.ts`; phép kiểm đủ tĩnh
 * (mọi controller SOCIAL đều gắn lớp chặn): `src/social/social-input-text.pipe.spec.ts`.
 *
 * Mỗi bề mặt có vế đối chứng: cùng request với văn bản thường ⇒ đúng mã thành công. Vế đó là bằng
 * chứng request của ca từ chối hợp lệ ở MỌI điểm khác — không có nó, một 400 vì lý do khác đọc y hệt.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb } from "../helpers/integration-db";
import {
  FEED_PAIRS,
  bootQa1World,
  createGroup,
  expectGuardDenied,
  expectUnauthenticated,
  ideaPost,
  reportTarget,
  sharePost,
  type Json,
  type Qa1Actor,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { expectCountersReconciled } from "../helpers/social-qa1-kit-counters";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const NUL = String.fromCharCode(0);
/** Hai mốc nhận diện đặt hai bên ký tự U+0000 — thân lỗi không được chứa mốc nào. */
const MARK_HEAD = "qa1mark";
const MARK_TAIL = "qa1tail";
const CLEAN_TEXT = "van ban sach";
const tail = (): string => randomUUID().replace(/-/g, "").slice(0, 8);

interface Surface {
  name: string;
  /** Mã thành công của vế đối chứng. */
  ok: number;
  /** Trường mà `details[]` phải nêu (đường dẫn nối bằng dấu chấm, như lỗi validation thường). */
  field: string;
  call: (text: string) => PromiseLike<Qa1Res>;
  /**
   * Số hàng mà BƯỚC CHUẨN BỊ của chính `call` tạo ra (bằng request thành công) trước request được
   * đo. Vắng = bề mặt không có bước chuẩn bị ⇒ ca từ chối phải để số hàng ĐỨNG YÊN.
   */
  seeds?: Partial<RowCounts>;
}

/** Số hàng của MỘT công ty ở bốn bảng mà các bề mặt trong file này ghi vào. */
interface RowCounts {
  posts: number;
  comments: number;
  groups: number;
  reports: number;
}

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-QA-1 · QA1-F-1 chuỗi đầu vào chứa ký tự U+0000 ⇒ 400 chuẩn, không ghi gì",
  () => {
    let w: Qa1World;
    let author: Qa1Actor;
    let admin: Qa1Actor;
    let viewer: Qa1Actor;
    let postId = "";
    let groupId = "";

    beforeAll(async () => {
      w = await bootQa1World("qa1inputctrl");
      author = await w.actor(w.A, "author", { pairs: FEED_PAIRS });
      admin = await w.actor(w.A, "admin", { pairs: FEED_PAIRS });
      viewer = await w.actor(w.A, "viewer", { pairs: ["view:feed"] });
      postId = (await sharePost(w, author, "Bài nền cho bình luận")).id;
      groupId = (await createGroup(w, author, "public")).id;
    }, 120_000);

    afterAll(async () => {
      await w?.close();
    });

    /** Đếm hàng (kể cả hàng đã xoá mềm) của công ty A — nơi mọi request của file này ghi vào. */
    async function rowCounts(): Promise<RowCounts> {
      const r = await w.direct.query<RowCounts>(
        `SELECT (SELECT count(*)::int FROM feed_posts    WHERE company_id = $1) AS posts,
                (SELECT count(*)::int FROM feed_comments WHERE company_id = $1) AS comments,
                (SELECT count(*)::int FROM feed_groups   WHERE company_id = $1) AS groups,
                (SELECT count(*)::int FROM feed_reports  WHERE company_id = $1) AS reports`,
        [w.A.companyId],
      );
      return r.rows[0] as RowCounts;
    }
    const plus = (base: RowCounts, add: Partial<RowCounts> = {}): RowCounts => ({
      posts: base.posts + (add.posts ?? 0),
      comments: base.comments + (add.comments ?? 0),
      groups: base.groups + (add.groups ?? 0),
      reports: base.reports + (add.reports ?? 0),
    });

    const post = (body: Json): PromiseLike<Qa1Res> =>
      w.post(author.token, "/social/posts").send(body);
    const poll = (question: string, first: string): PromiseLike<Qa1Res> =>
      post({
        type: "poll",
        audience: "company",
        poll: { question, options: [first, "Hai"], multipleChoice: false, isAnonymous: false },
      });

    const surfaces: Surface[] = [
      {
        name: "002 thân bài",
        ok: 201,
        field: "body",
        call: (t) => post({ type: "share", audience: "company", body: t }),
      },
      {
        name: "015 thân bình luận",
        ok: 201,
        field: "body",
        call: (t) => w.post(author.token, `/social/posts/${postId}/comments`).send({ body: t }),
      },
      {
        name: "002 câu hỏi bình chọn (object lồng)",
        ok: 201,
        field: "poll.question",
        call: (t) => poll(t, "Một"),
      },
      {
        name: "002 nhãn lựa chọn (chuỗi lồng trong mảng)",
        ok: 201,
        field: "poll.options.0",
        call: (t) => poll("Hỏi", t),
      },
      {
        name: "002 lời vinh danh (object lồng)",
        ok: 201,
        field: "kudos.message",
        call: (t) =>
          post({
            type: "kudos",
            audience: "company",
            kudos: { recipientEmployeeIds: [admin.employeeId], message: t },
          }),
      },
      {
        name: "004 sửa thân bài",
        ok: 200,
        field: "body",
        call: (t) => w.patch(author.token, `/social/posts/${postId}`).send({ body: t }),
      },
      {
        name: "023 tìm kiếm q",
        ok: 200,
        field: "q",
        call: (t) => w.get(author.token, `/social/search?q=${encodeURIComponent(t)}`),
      },
      {
        name: "024 thẻ q",
        ok: 200,
        field: "q",
        call: (t) => w.get(author.token, `/social/tags?q=${encodeURIComponent(t)}`),
      },
      {
        name: "027 ghi chú báo cáo",
        ok: 201,
        field: "note",
        call: (t) =>
          w
            .post(author.token, "/social/reports")
            .send({ targetType: "post", targetId: postId, reason: "other", note: t }),
      },
      {
        name: "029 ghi chú xử lý báo cáo",
        ok: 200,
        field: "resolutionNote",
        seeds: { posts: 1, reports: 1 },
        call: async (t) => {
          const target = await sharePost(w, admin);
          const report = await reportTarget(w, author, "post", target.id);
          return w
            .patch(admin.token, `/social/reports/${report.id}`)
            .send({ status: "resolved", resolutionNote: t });
        },
      },
      {
        name: "030 danh sách nhóm q",
        ok: 200,
        field: "q",
        call: (t) => w.get(author.token, `/social/groups?q=${encodeURIComponent(t)}`),
      },
      {
        name: "031 tên nhóm",
        ok: 201,
        field: "name",
        call: (t) =>
          w
            .post(author.token, "/social/groups")
            .send({ name: `${t} ${tail()}`, visibility: "public" }),
      },
      {
        name: "033 mô tả nhóm",
        ok: 200,
        field: "description",
        call: (t) => w.patch(author.token, `/social/groups/${groupId}`).send({ description: t }),
      },
      {
        name: "046 ghi chú duyệt sáng kiến",
        ok: 200,
        field: "reviewNote",
        seeds: { posts: 1 },
        call: async (t) => {
          const idea = await ideaPost(w, author);
          return w
            .patch(admin.token, `/social/posts/${idea.id}/idea/review`)
            .send({ status: "under_review", reviewNote: t });
        },
      },
    ];

    it.each(surfaces)("đối chứng · $name với văn bản thường ⇒ đúng mã thành công", async (s) => {
      const res = await s.call(CLEAN_TEXT);
      expect(res.status, JSON.stringify(res.body)).toBe(s.ok);
    });

    it("tự-kiểm phép đếm hàng: một request THÀNH CÔNG làm số hàng tăng đúng 1", async () => {
      const before = await rowCounts();
      expect(before.posts, "bài nền đã được đếm").toBeGreaterThanOrEqual(1);
      expect(before.groups, "nhóm nền đã được đếm").toBeGreaterThanOrEqual(1);
      await sharePost(w, author, "Bài tự-kiểm phép đếm");
      expect(await rowCounts()).toEqual(plus(before, { posts: 1 }));
    });

    it.each(surfaces)("QA1-F-1 · $name có U+0000 ⇒ 400 chuẩn, nêu trường", async (s) => {
      const rowsBefore = await rowCounts();
      const res = await s.call(`${MARK_HEAD}${NUL}${MARK_TAIL}`);
      // Không ghi gì: số hàng chỉ đổi đúng bằng phần bước chuẩn bị của bề mặt (nếu có) đã tạo.
      expect(await rowCounts(), `số hàng sau ${s.name}`).toEqual(plus(rowsBefore, s.seeds));
      const raw = JSON.stringify(res.body);
      const dump = `ĐO: ${s.name} ⇒ ${res.status} ${raw.slice(0, 400)}`;
      expect(res.status, dump).toBe(400);
      expect(res.body?.success, dump).toBe(false);
      expect(res.body?.error?.code, dump).toBe("VALIDATION-ERR-001");
      const details = (res.body?.error?.details ?? []) as Array<{ field?: string; rule?: string }>;
      expect(Array.isArray(details), dump).toBe(true);
      expect(
        details.map((d) => d.field),
        dump,
      ).toContain(s.field);
      // Không dội lại nội dung đã gửi: không mốc nào, không ký tự U+0000 (dạng thô lẫn dạng escape).
      expect(raw.includes(MARK_HEAD), dump).toBe(false);
      expect(raw.includes(MARK_TAIL), dump).toBe(false);
      expect(raw.includes(NUL), dump).toBe(false);
      expect(raw.includes("\\u0000"), dump).toBe(false);
    });

    it("thân có NHIỀU chuỗi chứa U+0000 ⇒ một 400, `details[]` nêu đủ từng trường", async () => {
      const bad = `${MARK_HEAD}${NUL}`;
      const rowsBefore = await rowCounts();
      const res = await poll(bad, bad);
      expect(await rowCounts(), "số hàng không đổi").toEqual(rowsBefore);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      const fields = ((res.body?.error?.details ?? []) as Array<{ field?: string }>).map(
        (d) => d.field,
      );
      expect(fields).toEqual(expect.arrayContaining(["poll.question", "poll.options.0"]));
    });

    it("thứ tự từ chối không đổi: không token ⇒ 401, thiếu quyền ⇒ 403 — cả khi thân có U+0000", async () => {
      const body = { type: "share", audience: "company", body: `${MARK_HEAD}${NUL}${MARK_TAIL}` };
      const rowsBefore = await rowCounts();
      expectUnauthenticated(await w.post(null, "/social/posts").send(body));
      expectGuardDenied(await w.post(viewer.token, "/social/posts").send(body));
      expect(await rowCounts(), "số hàng không đổi").toEqual(rowsBefore);
    });

    it("sau mọi lượt trên: cột đếm vẫn khớp (không ghi dở)", async () => {
      await expectCountersReconciled(w.direct, w.companyIds);
    });
  },
);
