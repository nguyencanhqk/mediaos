import { describe, expect, it, vi } from "vitest";
import type { TenantTx } from "../db/db.service";
import { blocksFor, loadPostBlocksTx } from "./social-post-blocks";
import { SocialPollsRepository } from "./social-polls.repository";

/**
 * S16-SOCIAL-BE-2D — bộ nạp khối thẻ bài (plan §5 U1/U2 · §9 V2 U7).
 *
 * Tx giả đếm CẢ `select` (builder) LẪN `execute` (SQL thô — câu poll): fakeTx chỉ đếm `select` sẽ chấm
 * câu poll viết bằng `tx.execute` là 0 câu và ca «≤ hằng số câu» xanh-rỗng (plan-review D-F3/§9 V6).
 * Ca driver-level (đếm câu SQL THẬT) là B7'/B10 ở int-spec — đây là kiểm nhanh phụ.
 *
 * ⚠️ `selectResults` GẮN THỨ TỰ câu builder trong `loadPostBlocksTx`: khối kudos → người nhận → idea.
 */
function fakeTx(selectResults: unknown[][], executeRows: unknown[] = []) {
  let n = 0;
  const select = vi.fn(() => {
    const rows = selectResults[n++] ?? [];
    const chain: object = new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "then"
            ? (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
                Promise.resolve(rows).then(ok, ko)
            : () => chain,
      },
    );
    return chain;
  });
  const execute = vi.fn(async () => ({ rows: executeRows }));
  return { tx: { select, execute } as unknown as TenantTx, select, execute };
}

const CO = "c0000000-0000-4000-8000-00000000000c";
const VIEWER = "v0000000-0000-4000-8000-00000000000v";
const P_K = "a1000000-0000-4000-8000-000000000001";
const P_P = "a2000000-0000-4000-8000-000000000002";
const P_I = "a3000000-0000-4000-8000-000000000003";
const P_S = "a4000000-0000-4000-8000-000000000004";
const KUDOS = "k1000000-0000-4000-8000-000000000001";
const EMP = "e1000000-0000-4000-8000-000000000001";
const POLL = "b1000000-0000-4000-8000-000000000001";
const OPT = "o1000000-0000-4000-8000-000000000001";

const kudosRow = {
  postId: P_K,
  kudosId: KUDOS,
  message: "cảm ơn",
  isOfficial: false,
  badgeId: null,
  badgeCode: null,
  badgeName: null,
  badgeIcon: null,
};
const recipientRow = {
  kudosId: KUDOS,
  employeeId: EMP,
  fullName: "A",
  avatarUrl: null,
  isFormerEmployee: false,
};
const pollRow = {
  poll_id: POLL,
  post_id: P_P,
  question: "?",
  status: "open",
  multiple_choice: false,
  is_anonymous: false,
  closes_at: "2026-10-05 03:00:00+00",
  total_voters: "1",
  option_id: OPT,
  label: "x",
  vote_count: 1,
  mine: true,
};

describe("U1 — số câu theo loại CÓ MẶT trên trang (không theo số bài)", () => {
  it("trang rỗng / chỉ share ⇒ 0 câu", async () => {
    for (const rows of [[], [{ id: P_S, type: "share" }]]) {
      const f = fakeTx([]);
      await loadPostBlocksTx(f.tx, CO, VIEWER, rows);
      expect(f.select).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    }
  });

  it("chỉ kudos ⇒ 2 câu (khối + người nhận)", async () => {
    const f = fakeTx([[kudosRow], [recipientRow]]);
    await loadPostBlocksTx(f.tx, CO, VIEWER, [{ id: P_K, type: "kudos" }]);
    expect(f.select).toHaveBeenCalledTimes(2);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("chỉ poll ⇒ 1 câu (execute) · chỉ idea ⇒ 1 câu", async () => {
    const fp = fakeTx([], [pollRow]);
    await loadPostBlocksTx(fp.tx, CO, VIEWER, [{ id: P_P, type: "poll" }]);
    expect(fp.select.mock.calls.length + fp.execute.mock.calls.length).toBe(1);

    const fi = fakeTx([[{ postId: P_I, status: "submitted" }]]);
    await loadPostBlocksTx(fi.tx, CO, VIEWER, [{ id: P_I, type: "idea" }]);
    expect(fi.select.mock.calls.length + fi.execute.mock.calls.length).toBe(1);
  });

  it("trộn ba loại, NHIỀU bài mỗi loại ⇒ đúng 4 câu", async () => {
    const f = fakeTx(
      [[kudosRow], [recipientRow], [{ postId: P_I, status: "accepted" }]],
      [pollRow],
    );
    const rows = [
      { id: P_K, type: "kudos" },
      { id: P_P, type: "poll" },
      { id: P_I, type: "idea" },
      { id: "a5000000-0000-4000-8000-000000000005", type: "kudos" },
      { id: "a6000000-0000-4000-8000-000000000006", type: "poll" },
      { id: P_S, type: "share" },
    ];
    await loadPostBlocksTx(f.tx, CO, VIEWER, rows);
    expect(f.select.mock.calls.length + f.execute.mock.calls.length).toBe(4);
  });
});

describe("U2 — accessor + mồ côi", () => {
  it("bài share không khoá nào; poll có hàng ⇒ `poll`; poll THIẾU hàng ⇒ vắng + `orphans`", async () => {
    const ORPHAN = "a7000000-0000-4000-8000-000000000007";
    const f = fakeTx([], [pollRow]);
    const rows = [
      { id: P_S, type: "share" },
      { id: P_P, type: "poll" },
      { id: ORPHAN, type: "poll" },
    ];
    const blocks = await loadPostBlocksTx(f.tx, CO, VIEWER, rows);
    expect(blocksFor(blocks, rows[0])).toEqual({});
    const p = blocksFor(blocks, rows[1]).poll;
    expect(p?.pollId).toBe(POLL);
    // §9 V1 — chuỗi thô timestamptz của driver ⇒ ISO có `T`; bigint chuỗi ⇒ số.
    expect(p?.closesAt).toBe("2026-10-05T03:00:00.000Z");
    expect(p?.totalVoters).toBe(1);
    expect(p?.myVote).toEqual([OPT]);
    expect(blocksFor(blocks, rows[2])).toEqual({});
    expect(blocks.orphans).toEqual([{ postId: ORPHAN, type: "poll" }]);
  });

  it("poll 0 lựa chọn (hàng option NULL) ⇒ options=[], KHÔNG {id:null}", async () => {
    const f = fakeTx(
      [],
      [
        {
          ...pollRow,
          option_id: null,
          label: null,
          vote_count: null,
          mine: false,
          total_voters: "0",
        },
      ],
    );
    const blocks = await loadPostBlocksTx(f.tx, CO, VIEWER, [{ id: P_P, type: "poll" }]);
    expect(blocks.poll.get(P_P)?.options).toEqual([]);
    expect(blocks.poll.get(P_P)?.totalVoters).toBe(0);
    expect(blocks.orphans).toEqual([]);
  });

  it('huy hiệu trỏ id mà JOIN không ra tên ⇒ badge null + `brokenBadges` (không `?? ""`)', async () => {
    const BADGE = "d1000000-0000-4000-8000-000000000001";
    const f = fakeTx([[{ ...kudosRow, badgeId: BADGE }], [recipientRow]]);
    const blocks = await loadPostBlocksTx(f.tx, CO, VIEWER, [{ id: P_K, type: "kudos" }]);
    expect(blocks.kudos.get(P_K)?.badge).toBeNull();
    expect(blocks.brokenBadges).toEqual([{ kudosId: KUDOS, badgeId: BADGE }]);
  });

  it("người nhận chép theo DANH SÁCH KHOÁ — `kudosId` (khoá gom) không lên khối", async () => {
    const f = fakeTx([[kudosRow], [{ ...recipientRow, userId: "rò-rỉ" }]]);
    const blocks = await loadPostBlocksTx(f.tx, CO, VIEWER, [{ id: P_K, type: "kudos" }]);
    const r = blocks.kudos.get(P_K)?.recipients[0];
    expect(Object.keys(r ?? {}).sort()).toEqual([
      "avatarUrl",
      "employeeId",
      "fullName",
      "isFormerEmployee",
    ]);
  });
});

describe("U7 — H-8: `pollResultsTx` (041..044) là ĐÚNG MỘT câu", () => {
  it("1 `execute`, 0 `select` — đếm cử tri và lựa chọn cùng ảnh chụp", async () => {
    const f = fakeTx([], [{ ...pollRow, poll_id: POLL }]);
    const repo = new SocialPollsRepository({} as never);
    const res = await repo.pollResultsTx(f.tx, CO, POLL, VIEWER);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.select).not.toHaveBeenCalled();
    expect(res).toEqual({
      options: [{ id: OPT, label: "x", voteCount: 1 }],
      totalVoters: 1,
      myVote: [OPT],
    });
  });

  it("trượt (không hàng) ⇒ NÉM có tên poll — không trả kết quả rỗng trông hợp lệ (gate M2)", async () => {
    const f = fakeTx([], []);
    const repo = new SocialPollsRepository({} as never);
    await expect(repo.pollResultsTx(f.tx, CO, POLL, VIEWER)).rejects.toThrow(POLL);
  });
});

describe("gate — dữ liệu hỏng: báo lên, không 500 cả trang, không im lặng", () => {
  it("vinh danh KHÔNG còn người nhận ⇒ `recipients: []` + `emptyKudos` (M1)", async () => {
    const f = fakeTx([[kudosRow], []]);
    const blocks = await loadPostBlocksTx(f.tx, CO, VIEWER, [{ id: P_K, type: "kudos" }]);
    expect(blocks.kudos.get(P_K)?.recipients).toEqual([]);
    expect(blocks.emptyKudos).toEqual([{ postId: P_K, kudosId: KUDOS }]);
  });

  it("`closes_at = 'infinity'` ⇒ khối poll VẮNG + mồ côi, KHÔNG RangeError (DB LOW-1)", async () => {
    const f = fakeTx([], [{ ...pollRow, closes_at: "infinity" }]);
    const blocks = await loadPostBlocksTx(f.tx, CO, VIEWER, [{ id: P_P, type: "poll" }]);
    expect(blocks.poll.has(P_P)).toBe(false);
    expect(blocks.orphans).toEqual([{ postId: P_P, type: "poll" }]);
  });
});
