/**
 * S16-SOCIAL-QA-1 (L3) — ĐỐI TƯỢNG THEO `post_id` TRONG CÙNG CÔNG TY
 * (plan `docs/plans/S16-SOCIAL-QA-1.md` §3 Bảng 4 + §4-L3, D4 · D5 · D10).
 *
 *   QA1-I-P-<mã>-<G|H|D|U>   19 route nhận `post_id` × 4 trạng thái của bài:
 *     G = bài trong nhóm kín mà người gọi không là thành viên đang hoạt động
 *     H = bài đang ẩn của người khác
 *     D = bài đã xoá
 *     U = bài của một đơn vị mà người gọi không thuộc
 *
 * Bảng `TABLE4` là LITERAL chép từ Bảng 4 của plan (nguồn: API-19 §6.5): người gọi của từng ô và kỳ
 * vọng đều viết tay, không suy từ code. Mỗi ô từ chối có ca cho phép SONG SINH trên CHÍNH bài đó, cùng
 * request:
 *   G · U  người cùng bộ cặp nhưng CÓ tư cách (thành viên nhóm / thuộc đơn vị)
 *   H      tác giả của bài
 *   D      chính người sẽ bị từ chối, gọi TRƯỚC khi bài bị xoá (tác giả với 004 · 005 · 044)
 *
 * Thứ tự trong một ô (G · H · U): từ chối → so với «id không tồn tại» → «bài không đổi» → cho phép.
 * Mỗi ô dùng một bài RIÊNG, dựng qua API ở `beforeAll` (đúng loại bài mà route cần).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
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
  ideaPost,
  joinAsActiveMember,
  newsPost,
  pollPost,
  sameErrorBody,
  sharePost,
  type FeedPair,
  type Json,
  type Qa1Actor,
  type Qa1PostPlace,
  type Qa1Res,
  type Qa1World,
} from "../helpers/social-qa1-kit";
import { snapPost } from "../helpers/social-qa1-idor-util";
import { QA1_ROUTES, qa1Route } from "../helpers/social-qa1-routes";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;

const dump = (res: Qa1Res): string => `${res.status} ${JSON.stringify(res.body)}`;

type Col = "G" | "H" | "D" | "U";
const COLS: readonly Col[] = ["G", "H", "D", "U"];

/** Loại bài mà route cần để ca cho phép ra đúng mã thành công. */
type Kind = "share" | "news" | "poll" | "idea";

/** Bộ cặp của người gọi (vai tuỳ biến, scope Company): 7 cặp của nhân viên + tối đa một cặp thêm. */
type Who = "emp" | "mod" | "news" | "idea";
const EXTRA_PAIR: Readonly<Record<Who, FeedPair | null>> = {
  emp: null,
  mod: "manage:feed-post",
  news: "manage:feed-news",
  idea: "approve:feed-idea",
};
const WHOS: readonly Who[] = ["emp", "mod", "news", "idea"];

type Expect = "404" | "allow";

/**
 * Bảng 4 — LITERAL. Cột: mã · loại bài · người gọi theo thứ tự [G, H, D, U] · kỳ vọng [G, H, D, U].
 * Ba route đòi chủ sở hữu hoặc cặp kiểm duyệt (004 · 005 · 044) và bốn route theo loại bài (021 ·
 * 041 · 042 · 043): cột G · U gọi bằng người CÓ cặp kiểm duyệt bài — cặp đó không mở được nhóm / đơn vị.
 */
type Row4 = readonly [
  code: string,
  kind: Kind,
  callers: readonly [Who, Who, Who, Who],
  expected: readonly [Expect, Expect, Expect, Expect],
];
const ALL_404 = ["404", "404", "404", "404"] as const;
const EMP4 = ["emp", "emp", "emp", "emp"] as const;
const MOD_GU = ["mod", "emp", "emp", "mod"] as const;
const TABLE4: readonly Row4[] = [
  ["003", "share", EMP4, ALL_404],
  ["007", "share", EMP4, ALL_404],
  ["008", "share", EMP4, ALL_404],
  ["009", "share", EMP4, ALL_404],
  ["011", "share", EMP4, ALL_404],
  ["012", "share", EMP4, ALL_404],
  ["013", "share", EMP4, ALL_404],
  ["014", "share", EMP4, ALL_404],
  ["015", "share", EMP4, ALL_404],
  ["004", "share", MOD_GU, ALL_404],
  ["005", "share", MOD_GU, ALL_404],
  ["044", "poll", MOD_GU, ALL_404],
  ["021", "news", MOD_GU, ALL_404],
  ["041", "poll", MOD_GU, ALL_404],
  ["042", "poll", MOD_GU, ALL_404],
  ["043", "poll", MOD_GU, ALL_404],
  ["022", "news", ["news", "news", "news", "news"], ALL_404],
  ["046", "idea", ["idea", "idea", "idea", "idea"], ALL_404],
  ["006", "share", ["mod", "mod", "mod", "mod"], ["404", "allow", "404", "404"]],
];

/** Route mà khi bài còn sống chỉ tác giả (trong các người gọi của cột D) mới được phép. */
const OWNER_ROUTES: ReadonlySet<string> = new Set(["004", "005", "044"]);

interface Cell {
  id: string;
  code: string;
  col: Col;
  kind: Kind;
  who: Who;
  expected: Expect;
}
const CELLS: readonly Cell[] = TABLE4.flatMap(([code, kind, callers, expected]) =>
  COLS.map((col, i) => ({
    id: `${code}-${col}`,
    code,
    col,
    kind,
    who: callers[i],
    expected: expected[i],
  })),
);
const cellsOf = (col: Col): Cell[] => CELLS.filter((c) => c.col === col);

interface Fixture {
  postId: string;
  optionIds: string[];
}

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-QA-1 · L3 · đối tượng theo post_id trong cùng công ty (DB cô lập)",
  () => {
    let w: Qa1World;
    /** Tác giả của mọi bài: 7 cặp nhân viên + cặp tin tức + cặp duyệt sáng kiến; KHÔNG có cặp kiểm duyệt bài. */
    let author: Qa1Actor;
    /** Người ẩn bài (đủ 15 cặp) — chỉ dùng để dựng trạng thái H. */
    let priv: Qa1Actor;
    /** Người gọi KHÔNG có tư cách: ngoài nhóm, khác đơn vị. */
    const out = {} as Record<Who, Qa1Actor>;
    /** Song sinh CÓ tư cách: cùng bộ cặp, là thành viên nhóm và thuộc đơn vị của bài. */
    const inn = {} as Record<Who, Qa1Actor>;
    let groupId: string;
    let unitId: string;
    const fixtures = new Map<string, Fixture>();

    const fx = (cell: Cell): Fixture => {
      const found = fixtures.get(cell.id);
      if (!found) throw new Error(`thiếu bài của ô ${cell.id}`);
      return found;
    };

    /** Thân hợp lệ của route (route không nhận thân ⇒ `undefined`). */
    const bodyOf = (code: string, f: Fixture): Json | undefined => {
      switch (code) {
        case "004":
          return { body: "Nội dung đã sửa (L3)" };
        case "006":
          return { commentsLocked: true };
        case "011":
          return { emoji: "like" };
        case "015":
          return { body: "Bình luận của ca L3" };
        case "041":
          return { optionIds: [f.optionIds[0]] };
        case "046":
          return { status: "under_review" };
        default:
          return undefined;
      }
    };

    /** Gọi route `code` trên bài `postId` — đường dẫn / method / mã thành công lấy từ bảng tay của L1. */
    const call = async (a: Qa1Actor, code: string, postId: string, f: Fixture): Promise<Qa1Res> => {
      const route = qa1Route(code);
      const req = w[route.verb](a.token, route.template.replace(":post_id", postId));
      const body = bodyOf(code, f);
      const res = await (body ? req.send(body) : req);
      return { status: res.status, body: res.body as Qa1Res["body"] };
    };

    /** Ảnh chụp mọi thứ một route theo `post_id` có thể ghi: hàng bài + các bảng con của nó. */
    const snap = (postId: string): Promise<string> => snapPost(w.direct, w.A.companyId, postId);

    const expectPostNotFound = (res: Qa1Res): void =>
      expectSocial(res, 404, SOCIAL_ERR.POST_NOT_FOUND, SOCIAL_ERROR_CODES.POST_NOT_FOUND);

    /** Dựng MỘT bài đúng loại + đúng chỗ cho ô; ô H thì ẩn bài ngay sau khi đăng. */
    async function makeFixture(cell: Cell): Promise<Fixture> {
      const where: Qa1PostPlace =
        cell.col === "G"
          ? { audience: "group", groupId }
          : cell.col === "U"
            ? { audience: "org_unit", orgUnitId: unitId }
            : {};
      let made: { id: string; optionIds?: string[] };
      if (cell.kind === "news") made = await newsPost(w, author, { requiresAck: true, ...where });
      else if (cell.kind === "poll") made = await pollPost(w, author, where);
      else if (cell.kind === "idea") made = await ideaPost(w, author, undefined, where);
      else made = await sharePost(w, author, undefined, where);

      if (cell.col === "H") {
        const hidden = await w
          .patch(priv.token, `/social/posts/${made.id}/moderation`)
          .send({ hidden: true });
        if (hidden.status !== 200) {
          throw new Error(
            `ẩn bài của ô ${cell.id}: ${hidden.status} ${JSON.stringify(hidden.body)}`,
          );
        }
      }
      return { postId: made.id, optionIds: made.optionIds ?? [] };
    }

    beforeAll(async () => {
      w = await bootQa1World("qa1idorp");
      unitId = await w.orgUnit(w.A, "QA1 Don vi cua bai");
      const otherUnitId = await w.orgUnit(w.A, "QA1 Don vi khac");
      const pairsOf = (who: Who): FeedPair[] => {
        const extra = EXTRA_PAIR[who];
        return extra ? [...EMPLOYEE_FEED_PAIRS, extra] : [...EMPLOYEE_FEED_PAIRS];
      };

      author = await w.actor(w.A, "author", {
        pairs: [...EMPLOYEE_FEED_PAIRS, "manage:feed-news", "approve:feed-idea"],
        orgUnitId: unitId,
      });
      priv = await w.actor(w.A, "priv", { pairs: FEED_PAIRS });
      groupId = (await createGroup(w, author, "private")).id;
      for (const who of WHOS) {
        out[who] = await w.actor(w.A, `out${who}`, {
          pairs: pairsOf(who),
          orgUnitId: otherUnitId,
        });
        inn[who] = await w.actor(w.A, `in${who}`, { pairs: pairsOf(who), orgUnitId: unitId });
        await joinAsActiveMember(w, author, inn[who], groupId);
      }

      // Xác nhận bằng 201 TRƯỚC khi vào ca: mọi loại bài dựng được ở mọi chỗ mà bảng cần.
      for (const cell of CELLS) fixtures.set(cell.id, await makeFixture(cell));
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await w?.close();
    });

    it("QA1-I-P-neo · bảng phủ ĐÚNG tập route nhận post_id (trừ route khôi phục), 76 ô = 75 từ chối + 1 cho phép", () => {
      const withPostId = QA1_ROUTES.filter(
        (r) => r.pathParams.includes("post_id") && r.code !== "058",
      ).map((r) => r.code);
      expect(TABLE4.map((r) => r[0]).sort()).toEqual([...withPostId].sort());
      expect(withPostId).toHaveLength(19);
      expect(CELLS).toHaveLength(76);
      expect(CELLS.filter((c) => c.expected === "404")).toHaveLength(75);
      expect(CELLS.filter((c) => c.expected === "allow").map((c) => c.id)).toEqual(["006-H"]);
      expect(fixtures.size).toBe(76);
    });

    // ══════════════ G · H · U — từ chối → bài không đổi → song sinh cho phép ══════════════

    describe.each([
      ["G", "bài trong nhóm kín, người gọi ngoài nhóm"],
      ["H", "bài đang ẩn của người khác"],
      ["U", "bài của đơn vị khác"],
    ] as const)("cột %s · %s", (col, _what) => {
      const deny = cellsOf(col).filter((c) => c.expected === "404");

      it.each(deny)(
        "QA1-I-P-$id · không thấy ⇒ 404 như id không tồn tại, bài không đổi; người có tư cách ⇒ đúng mã thành công",
        async (cell) => {
          const f = fx(cell);
          const route = qa1Route(cell.code);
          const caller = out[cell.who];
          const twin = col === "H" ? author : inn[cell.who];

          const before = await snap(f.postId);
          const denied = await call(caller, cell.code, f.postId, f);
          expectPostNotFound(denied);
          sameErrorBody(denied, await call(caller, cell.code, randomUUID(), f), "so với id bịa");
          expect(await snap(f.postId), "từ chối thì bài và các bảng con không đổi").toBe(before);

          const ok = await call(twin, cell.code, f.postId, f);
          expect(ok.status, `song sinh ${twin.label}: ${dump(ok)}`).toBe(route.ok);
        },
      );
    });

    it("QA1-I-P-006-H · người giữ cặp kiểm duyệt đọc và sửa được bài đang ẩn (ô cho phép của bảng)", async () => {
      const cell = CELLS.find((c) => c.id === "006-H");
      if (!cell) throw new Error("thiếu ô 006-H");
      const f = fx(cell);

      // Đối chứng: người thiếu cặp của route dừng ở tầng 1, bài không đổi.
      const before = await snap(f.postId);
      expectGuardDenied(await call(out.news, "006", f.postId, f), "006 · thiếu cặp kiểm duyệt");
      expect(await snap(f.postId)).toBe(before);

      const ok = await call(out[cell.who], "006", f.postId, f);
      expect(ok.status, dump(ok)).toBe(200);
      const row = await w.direct.query<{ status: string; comments_locked: boolean }>(
        `SELECT status, comments_locked FROM feed_posts WHERE id = $1 AND company_id = $2`,
        [f.postId, w.A.companyId],
      );
      expect(row.rows[0]).toEqual({ status: "hidden", comments_locked: true });
    });

    // ══════════════ D — cùng người, cùng request: trước khi xoá ⇒ thành công; sau khi xoá ⇒ 404 ══════════════

    describe("cột D · bài đã xoá", () => {
      it.each(cellsOf("D"))(
        "QA1-I-P-$id · trước khi xoá ⇒ đúng mã thành công; sau khi xoá ⇒ 404 như id không tồn tại",
        async (cell) => {
          const f = fx(cell);
          const route = qa1Route(cell.code);
          const caller = OWNER_ROUTES.has(cell.code) ? author : out[cell.who];

          // Vế cho phép chạy TRƯỚC lệnh xoá. Riêng 005: lượt một của tác giả chính là phép xoá.
          const first = await call(caller, cell.code, f.postId, f);
          expect(first.status, `trước khi xoá: ${dump(first)}`).toBe(route.ok);
          if (cell.code !== "005") {
            const removed = await w.del(author.token, `/social/posts/${f.postId}`);
            expect(removed.status, `xoá qua 005: ${JSON.stringify(removed.body)}`).toBe(200);
          }

          const before = await snap(f.postId);
          const after = await call(caller, cell.code, f.postId, f);
          expectPostNotFound(after);
          sameErrorBody(after, await call(caller, cell.code, randomUUID(), f), "so với id bịa");
          expect(await snap(f.postId), "bài đã xoá không bị ghi thêm").toBe(before);
        },
      );

      /**
       * Vế «chưa xoá» của cổng đọc đứng RIÊNG, không dựa vào trạng thái: schema cho phép hàng mang mốc
       * xoá mà trạng thái chưa đổi (dữ liệu cũ / xoá tay — chú thích ở `feed_posts`). Route 005 luôn
       * ghi cả hai, nên chỉ dựng được hàng kiểu này bằng một câu UPDATE.
       */
      it.each(cellsOf("D"))(
        "QA1-I-P-$id-cũ · hàng mang mốc xoá mà trạng thái chưa đổi cũng ⇒ 404 như id không tồn tại",
        async (cell) => {
          const f = await makeFixture(cell);
          const route = qa1Route(cell.code);
          const caller = OWNER_ROUTES.has(cell.code) ? author : out[cell.who];

          if (cell.code !== "005") {
            const first = await call(caller, cell.code, f.postId, f);
            expect(first.status, `trước khi đặt mốc xoá: ${dump(first)}`).toBe(route.ok);
          }
          const marked = await w.direct.query(
            `UPDATE feed_posts SET deleted_at = now(), deleted_by = $3
              WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND status = 'published'`,
            [f.postId, w.A.companyId, author.userId],
          );
          expect(marked.rowCount).toBe(1);

          const before = await snap(f.postId);
          const after = await call(caller, cell.code, f.postId, f);
          expectPostNotFound(after);
          sameErrorBody(after, await call(caller, cell.code, randomUUID(), f), "so với id bịa");
          expect(await snap(f.postId), "bài mang mốc xoá không bị ghi thêm").toBe(before);
        },
      );
    });
  },
);
