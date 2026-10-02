import { describe, expect, it } from "vitest";
import {
  wsFeedCompanyPostCreatedEventSchema,
  wsFeedGroupPostCreatedEventSchema,
  type FeedPostDto,
} from "@mediaos/contracts";
import { buildWsPostCreatedEvent } from "./social-ws-payload";

/**
 * S16-SOCIAL-BE-2C — nguồn payload `feed:post.created` (plan §4.7, §5 P1–P5).
 *
 * Hàm THUẦN quyết định HAI thứ: (1) bài nào được phát (chỉ `published` + `company`/`group` có id), và
 * (2) NHÃN `audience`/`groupId` của payload — emitter định tuyến theo nhãn đó (bất biến 7). Nhãn lấy từ
 * HÀNG DB, không từ hằng: code BE-1 đè `audience: "company"` tại nguồn; giữ hằng đó cho nhánh group là
 * dán nhãn bài nhóm KÍN thành bài công ty ⇒ emitter định tuyến đúng-theo-payload ra room CẢ CÔNG TY
 * (mutant M18).
 */

const G = "61000000-0000-4000-8000-000000000001";
const POST = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const keysOf = (s: { shape: Record<string, unknown> }): string[] => Object.keys(s.shape).sort();

/** DTO REST đầy đủ — decorate bằng TÁC GIẢ (đúng thứ `create()` có trong tay lúc phát). */
function restDto(over: Partial<FeedPostDto> = {}): FeedPostDto {
  return {
    id: POST,
    type: "poll",
    audience: "company",
    orgUnitId: null,
    groupId: null,
    author: { employeeId: null, fullName: "Tác giả", avatarUrl: null },
    body: "nội dung",
    tags: ["a"],
    attachments: [
      {
        fileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        kind: "image",
        fileName: "a.png",
        sizeBytes: 10,
        url: "https://signed.example/secret",
      },
    ],
    pinned: false,
    commentsLocked: false,
    requiresAck: false,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    myReaction: "like",
    savedByMe: true,
    isMine: true,
    status: "published",
    mentions: [],
    poll: { myVote: ["22222222-2222-4222-8222-222222222222"] } as never,
    editedAt: null,
    publishedAt: "2026-10-02T00:00:00.000Z",
    lastActivityAt: "2026-10-02T00:00:00.000Z",
    createdAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

describe("buildWsPostCreatedEvent (S16-SOCIAL-BE-2C)", () => {
  it("P1 bài company published ⇒ biến thể company, `groupId:null`, khoá ra ĐÚNG bằng option company", () => {
    const ev = buildWsPostCreatedEvent(
      { audience: "company", status: "published", groupId: null },
      restDto(),
    );
    expect(ev).not.toBeNull();
    expect(ev?.audience).toBe("company");
    expect(ev?.groupId).toBeNull();
    expect(wsFeedCompanyPostCreatedEventSchema.safeParse(ev).success).toBe(true);
    expect(Object.keys(ev ?? {}).sort()).toEqual(keysOf(wsFeedCompanyPostCreatedEventSchema));
    expect(JSON.stringify(ev)).not.toContain("signed.example");
  });

  it("🔒 P2 bài group ⇒ nhãn `group` + `groupId` LẤY TỪ HÀNG; parse được bởi option group, KHÔNG bởi option company", () => {
    const ev = buildWsPostCreatedEvent(
      { audience: "group", status: "published", groupId: G },
      restDto({ audience: "group", groupId: G }),
    );
    expect(ev?.audience).toBe("group");
    expect(ev?.groupId).toBe(G);
    expect(wsFeedGroupPostCreatedEventSchema.safeParse(ev).success).toBe(true);
    // Lưới chống dán nhãn sai: payload nhóm KHÔNG được đi lọt option company (⇒ room công ty).
    expect(wsFeedCompanyPostCreatedEventSchema.safeParse(ev).success).toBe(false);
    // Room nhóm KHÔNG nhận payload rộng hơn room công ty: cùng tập khoá đã bóc.
    expect(Object.keys(ev ?? {}).sort()).toEqual(keysOf(wsFeedGroupPostCreatedEventSchema));
    for (const k of ["status", "myReaction", "savedByMe", "isMine", "mentions", "poll"]) {
      expect(ev).not.toHaveProperty(k);
    }
    expect((ev?.attachments ?? [])[0]).not.toHaveProperty("url");
  });

  it("P3 bài org_unit ⇒ null (D21 — KHÔNG có room nào cho org_unit)", () => {
    expect(
      buildWsPostCreatedEvent(
        { audience: "org_unit", status: "published", groupId: null },
        restDto({ audience: "org_unit", orgUnitId: G }),
      ),
    ).toBeNull();
  });

  it("P4 bài KHÔNG published (hidden) ⇒ null", () => {
    expect(
      buildWsPostCreatedEvent({ audience: "company", status: "hidden", groupId: null }, restDto()),
    ).toBeNull();
  });

  it("P5 bài group THIẾU groupId ⇒ null (không có đích để định tuyến)", () => {
    expect(
      buildWsPostCreatedEvent(
        { audience: "group", status: "published", groupId: null },
        restDto({ audience: "group" }),
      ),
    ).toBeNull();
  });
});
