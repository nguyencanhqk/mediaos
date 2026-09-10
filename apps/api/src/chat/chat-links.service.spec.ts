import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ChatLinksService } from "./chat-links.service";
import type { ChatAccessService } from "./chat-access.service";
import type { DatabaseService } from "../db/db.service";
import type { ChatLinkCandidateRow, ChatMessagesRepository } from "./chat-messages.repository";
import { CHAT_ERR } from "./chat.errors";

/**
 * S17-CHAT-UX2-BE-2 — ngữ nghĩa PHÂN TRANG + CHẠM TRẦN của `CHAT-API-031` (API-13 §5.1d(6)).
 *
 * ┌─ VÌ SAO SUITE NÀY COLOCATED TRONG `src/`, KHÔNG CHỈ Ở int-spec ───────────────────────────────┐
 * │ Mọi `*.int-spec.ts` đều `describe.skipIf(!hasLaneDb)`: không có `LANE_DB` thì SKIP, và SKIP    │
 * │ KHÔNG phải FAIL (memory `src-green-is-not-integration-green`). Luật `truncated`/con trỏ là     │
 * │ thứ dễ hỏng nhất ở WO này và nó là logic THUẦN trên kết quả truy vấn — đặt nó ở đây thì CI     │
 * │ thường cũng gác. int-spec vẫn giữ phần chỉ Postgres trả lời được (RLS · deny-path · SQL thật). │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Repo giả dưới đây mô phỏng ĐÚNG hợp đồng SQL: sắp `room_seq DESC`, áp vị từ con trỏ, cắt `LIMIT`.
 * Sai lệch ở chỗ đó sẽ làm suite này xanh trên một thứ không tồn tại, nên nó được viết một lần và
 * dùng chung cho mọi ca.
 */

const CO = "11111111-1111-4111-8111-111111111111";
const ROOM = "33333333-3333-4333-8333-333333333333";
const OTHER_ROOM = "55555555-5555-4555-8555-555555555555";
const USER = "22222222-2222-4222-8222-222222222222";
const ACTOR = { id: USER, companyId: CO };

interface FakeMessage {
  roomSeq: number;
  body: string;
}

function makeService(messages: readonly FakeMessage[]) {
  // Nguồn đã sắp DESC như `ORDER BY room_seq DESC`.
  const sorted = [...messages].sort((a, b) => b.roomSeq - a.roomSeq);

  const listRoomLinkCandidates = vi.fn(
    async (
      _tx: unknown,
      _companyId: string,
      _roomId: string,
      opts: {
        beforeSeqExclusive?: number;
        beforeSeqInclusive?: number;
        limit: number;
      },
    ): Promise<ChatLinkCandidateRow[]> =>
      sorted
        .filter((m) =>
          opts.beforeSeqExclusive !== undefined ? m.roomSeq < opts.beforeSeqExclusive : true,
        )
        .filter((m) =>
          opts.beforeSeqInclusive !== undefined ? m.roomSeq <= opts.beforeSeqInclusive : true,
        )
        // Vị từ `body <> ''` của SQL — repo giả phải mang nó, nếu không ca "tin chỉ có tệp" ở đây đo
        // một hình dạng dữ liệu mà truy vấn thật không bao giờ trả về.
        .filter((m) => m.body !== "")
        .slice(0, opts.limit)
        .map((m) => ({
          id: `msg-${m.roomSeq}`,
          roomSeq: m.roomSeq,
          body: m.body,
          senderId: USER,
          senderName: "Người gửi",
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
        })),
  );

  const assertMember = vi.fn(
    async (): Promise<{ membership: { visibleFromSeq: number | null } }> => ({
      membership: { visibleFromSeq: null },
    }),
  );

  const svc = new ChatLinksService(
    { withTenant: async (_c: string, fn: (tx: unknown) => unknown) => fn({}) } as unknown as DatabaseService,
    { assertMember } as unknown as ChatAccessService,
    { listRoomLinkCandidates } as unknown as ChatMessagesRepository,
  );
  return { svc, assertMember, listRoomLinkCandidates };
}

/** Sinh N tin KHÔNG có liên kết, `room_seq` giảm dần từ `from`. */
const noise = (from: number, n: number): FakeMessage[] =>
  Array.from({ length: n }, (_, i) => ({ roomSeq: from - i, body: `tin thường ${from - i}` }));

describe("membership là cổng — không có nhánh nào bỏ qua", () => {
  it("`assertMember` được gọi TRƯỚC khi đọc tin", async () => {
    const { svc, assertMember, listRoomLinkCandidates } = makeService([
      { roomSeq: 1, body: "https://a.vn" },
    ]);
    await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(assertMember).toHaveBeenCalledOnce();
    expect(assertMember.mock.invocationCallOrder[0]).toBeLessThan(
      listRoomLinkCandidates.mock.invocationCallOrder[0],
    );
  });

  it("`assertMember` ném 404 ⇒ không có truy vấn tin nào chạy", async () => {
    const { svc, assertMember, listRoomLinkCandidates } = makeService([
      { roomSeq: 1, body: "https://a.vn" },
    ]);
    assertMember.mockRejectedValueOnce(new NotFoundException(CHAT_ERR.ROOM_NOT_FOUND));
    await expect(svc.listRoomLinks(ACTOR, ROOM, { limit: 30 })).rejects.toThrow(NotFoundException);
    expect(listRoomLinkCandidates).not.toHaveBeenCalled();
  });

  it("`visibleFromSeq` lấy TỪ kết quả assertMember, không tự bịa", async () => {
    const { svc, assertMember, listRoomLinkCandidates } = makeService([
      { roomSeq: 1, body: "https://a.vn" },
    ]);
    assertMember.mockResolvedValueOnce({ membership: { visibleFromSeq: 12 } });
    await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(listRoomLinkCandidates.mock.calls[0][3]).toMatchObject({ visibleFromSeq: 12 });
  });
});

describe("trích + thứ tự", () => {
  it("mới nhất trước; nhiều link trong một tin giữ thứ tự xuất hiện", async () => {
    const { svc } = makeService([
      { roomSeq: 1, body: "cũ https://cu.vn" },
      { roomSeq: 2, body: "https://a.vn rồi https://b.vn" },
    ]);
    const res = await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(res.data.map((l) => l.url)).toEqual(["https://a.vn", "https://b.vn", "https://cu.vn"]);
    expect(res.data.map((l) => l.linkIndex)).toEqual([0, 1, 0]);
  });

  it("tin không có liên kết KHÔNG sinh dòng nào", async () => {
    const { svc } = makeService([{ roomSeq: 1, body: "chào cả nhà" }]);
    const res = await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(res.data).toEqual([]);
  });
});

describe("[crown] chạm trần quét — `truncated` (API-13 §5.1d(6))", () => {
  it("60 tin KHÔNG link ⇒ trang RỖNG nhưng `truncated: true` + `nextCursor` khác null", async () => {
    // Ca trung tâm của mục (6): "cắt trang mà im lặng đọc ra y hệt đã trả hết" là lỗi. Trang rỗng ở
    // đây KHÔNG được đọc thành "phòng không có liên kết nào".
    const { svc } = makeService([...noise(60, 60)]);
    const res = await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(res.data).toEqual([]);
    expect(res.truncated).toBe(true);
    expect(res.nextCursor).not.toBeNull();
  });

  it("lật tiếp con trỏ chạm-trần ra được trang sau — KHÔNG treo, KHÔNG lặp lại chỗ cũ", async () => {
    // Không có vế `linkIndex = -1` ("trọn tin này rồi") thì client lật lại đúng 50 tin ấy mãi mãi.
    const { svc } = makeService([...noise(60, 59), { roomSeq: 1, body: "https://cuoi.vn" }]);
    const first = await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(first.truncated).toBe(true);

    const second = await svc.listRoomLinks(ACTOR, ROOM, {
      limit: 30,
      cursor: first.nextCursor as string,
    });
    expect(second.data.map((l) => l.url)).toEqual(["https://cuoi.vn"]);
    expect(second.truncated).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it("ca ÂM: phòng ít tin, quét hết ⇒ `truncated: false` + `nextCursor: null`", async () => {
    // Neo chống "truncated luôn true": không có ca âm thì một hiện thực trả `true` mọi lúc vẫn xanh.
    const { svc } = makeService([{ roomSeq: 2, body: "https://a.vn" }, { roomSeq: 1, body: "hi" }]);
    const res = await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(res.data).toHaveLength(1);
    expect(res.truncated).toBe(false);
    expect(res.nextCursor).toBeNull();
  });

  it("đúng 50 tin (bằng trần) và hết phòng ⇒ `truncated: false` — biên không lệch một đơn vị", async () => {
    const { svc } = makeService(noise(50, 50));
    const res = await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(res.truncated).toBe(false);
    expect(res.nextCursor).toBeNull();
  });

  it("hàng DƯ (thứ 51) chỉ là bằng chứng — KHÔNG được trích thành dòng", async () => {
    // Tin thứ 51 CÓ link. Nếu nó lọt vào phần trích thì trang này trả một dòng mà con trỏ đã nhảy qua
    // ⇒ trang sau lặp lại nó (hoặc tệ hơn, bỏ mất tin ở giữa).
    const { svc } = makeService([...noise(51, 50), { roomSeq: 1, body: "https://du.vn" }]);
    const res = await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    expect(res.data).toEqual([]);
    expect(res.truncated).toBe(true);
  });
});

describe("[crown] phân trang GIỮA một tin", () => {
  it("1 tin 3 link, limit=2 ⇒ trang 2 ra đúng link thứ 3, không lặp không sót", async () => {
    const { svc } = makeService([
      { roomSeq: 5, body: "https://a.vn https://b.vn https://c.vn" },
    ]);
    const p1 = await svc.listRoomLinks(ACTOR, ROOM, { limit: 2 });
    expect(p1.data.map((l) => l.url)).toEqual(["https://a.vn", "https://b.vn"]);
    expect(p1.truncated).toBe(false);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await svc.listRoomLinks(ACTOR, ROOM, {
      limit: 2,
      cursor: p1.nextCursor as string,
    });
    expect(p2.data.map((l) => l.url)).toEqual(["https://c.vn"]);
    expect(p2.nextCursor).toBeNull();
  });

  it("con trỏ GIỮA tin đọc LẠI chính tin đó (vị từ `<=`), không nhảy qua phần còn dư", async () => {
    const { svc, listRoomLinkCandidates } = makeService([
      { roomSeq: 5, body: "https://a.vn https://b.vn" },
    ]);
    const p1 = await svc.listRoomLinks(ACTOR, ROOM, { limit: 1 });
    await svc.listRoomLinks(ACTOR, ROOM, { limit: 1, cursor: p1.nextCursor as string });
    expect(listRoomLinkCandidates.mock.calls[1][3]).toMatchObject({ beforeSeqInclusive: 5 });
  });

  it("con trỏ TRỌN tin (`linkIndex=-1`) LOẠI TRỪ tin đó (vị từ `<`)", async () => {
    const { svc, listRoomLinkCandidates } = makeService([...noise(60, 60)]);
    const p1 = await svc.listRoomLinks(ACTOR, ROOM, { limit: 30 });
    await svc.listRoomLinks(ACTOR, ROOM, { limit: 30, cursor: p1.nextCursor as string });
    const opts = listRoomLinkCandidates.mock.calls[1][3];
    expect(opts).toMatchObject({ beforeSeqExclusive: 11 });
    expect(opts).not.toHaveProperty("beforeSeqInclusive", 11);
  });

  it("đi hết nhiều trang liên tiếp trả ĐỦ và KHÔNG TRÙNG bộ liên kết", async () => {
    // Ca tổng: bất biến thật của phân trang không phải "mỗi trang đúng", mà là "ghép các trang lại
    // bằng đúng tập ban đầu, không thừa không thiếu".
    const { svc } = makeService([
      { roomSeq: 3, body: "https://a.vn https://b.vn" },
      { roomSeq: 2, body: "không link" },
      { roomSeq: 1, body: "https://c.vn https://d.vn https://e.vn" },
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const res: Awaited<ReturnType<typeof svc.listRoomLinks>> = await svc.listRoomLinks(
        ACTOR,
        ROOM,
        { limit: 2, ...(cursor ? { cursor } : {}) },
      );
      seen.push(...res.data.map((l) => l.url));
      cursor = res.nextCursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual([
      "https://a.vn",
      "https://b.vn",
      "https://c.vn",
      "https://d.vn",
      "https://e.vn",
    ]);
  });
});

describe("con trỏ mang vân PHÒNG — kiểm TRƯỚC khi chạm DB", () => {
  it("con trỏ của phòng khác ⇒ 400, và KHÔNG có truy vấn nào chạy", async () => {
    const { svc, listRoomLinkCandidates, assertMember } = makeService([
      { roomSeq: 5, body: "https://a.vn https://b.vn" },
    ]);
    const p1 = await svc.listRoomLinks(ACTOR, OTHER_ROOM, { limit: 1 });
    listRoomLinkCandidates.mockClear();
    assertMember.mockClear();

    await expect(
      svc.listRoomLinks(ACTOR, ROOM, { limit: 1, cursor: p1.nextCursor as string }),
    ).rejects.toThrow(BadRequestException);
    expect(assertMember).not.toHaveBeenCalled();
    expect(listRoomLinkCandidates).not.toHaveBeenCalled();
  });

  it("con trỏ rác ⇒ 400 (không im lặng rơi về trang đầu)", async () => {
    // Rơi về trang đầu biến một con trỏ hỏng thành VÒNG LẶP VÔ HẠN ở FE: trang 2 luôn trả trang 1.
    const { svc } = makeService([{ roomSeq: 1, body: "https://a.vn" }]);
    await expect(
      svc.listRoomLinks(ACTOR, ROOM, { limit: 30, cursor: "khong-phai-con-tro" }),
    ).rejects.toThrow(BadRequestException);
  });
});
