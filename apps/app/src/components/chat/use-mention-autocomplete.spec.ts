/**
 * S17-CHAT-UX2-FE-3 — luật `@mention` ở tầng HÀM THUẦN (SPEC-15 §22c CHAT-DEC-027).
 *
 * Đây là nơi đo những ca mà dựng cả composer chỉ làm mờ phép đo: dò trigger, lọc roster, và — đắt
 * nhất — `collectMentionIds`, hàm đứng giữa "người dùng đã xoá chữ" và "người kia có nhận thông báo".
 */
import { describe, expect, it } from "vitest";
import type { ChatRoomMemberDto } from "@mediaos/contracts";
import {
  applyMention,
  collectMentionIds,
  detectMentionTrigger,
  filterMentionCandidates,
  mentionLabel,
  rosterToMentionCandidates,
  type MentionCandidate,
} from "./use-mention-autocomplete";

const U = (n: number) => `0000000${n}-1111-4111-8111-11111111111${n}`;

const NAM: MentionCandidate = { userId: U(1), name: "Nguyễn Văn Nam", avatarUrl: null };
const NGA: MentionCandidate = { userId: U(2), name: "Trần Nga", avatarUrl: null };
const BINH: MentionCandidate = { userId: U(3), name: "Lê Bình", avatarUrl: null };

function member(over: Partial<ChatRoomMemberDto>): ChatRoomMemberDto {
  return {
    id: U(9),
    roomId: U(8),
    userId: U(1),
    joinedAt: "2026-09-01T00:00:00.000Z",
    userName: "Nguyễn Văn Nam",
    ...over,
  } as ChatRoomMemberDto;
}

describe("rosterToMentionCandidates · ai được gợi ý", () => {
  it("LOẠI người đã rời phòng (`leftAt`) — server sẽ bỏ id đó im lặng (CHAT-ERR-010)", () => {
    const out = rosterToMentionCandidates([
      member({ userId: U(1), userName: "Nguyễn Văn Nam" }),
      member({ userId: U(2), userName: "Người đã rời", leftAt: "2026-09-02T00:00:00.000Z" }),
    ]);
    expect(out.map((c) => c.userId)).toEqual([U(1)]);
  });

  // Ca đối chứng DƯƠNG: không có nó thì một hàm `return []` cũng làm ca trên xanh.
  it("GIỮ người còn trong phòng — kể cả khi cả roster đều `leftAt: null`", () => {
    const out = rosterToMentionCandidates([
      member({ userId: U(1), userName: "A", leftAt: null }),
      member({ userId: U(2), userName: "B", leftAt: null }),
    ]);
    expect(out.map((c) => c.userId)).toEqual([U(1), U(2)]);
  });

  it("LOẠI người không có tên hiển thị — không có gì để chèn vào chữ", () => {
    const out = rosterToMentionCandidates([
      member({ userId: U(1), userName: null }),
      member({ userId: U(2), userName: "   " }),
      member({ userId: U(3), userName: "Có tên" }),
    ]);
    expect(out.map((c) => c.userId)).toEqual([U(3)]);
  });
});

describe("detectMentionTrigger · khi nào popover được phép mở", () => {
  it("gõ `@ng` ở đầu dòng ⇒ trigger với query `ng`", () => {
    expect(detectMentionTrigger("@ng", 3)).toEqual({ start: 0, query: "ng" });
  });

  it("`@` ngay sau dấu cách ⇒ trigger", () => {
    expect(detectMentionTrigger("chào @na", 8)).toEqual({ start: 5, query: "na" });
  });

  it("EMAIL `ten@congty.vn` ⇒ KHÔNG trigger (trước `@` là chữ)", () => {
    expect(detectMentionTrigger("ten@congty", 10)).toBeNull();
  });

  it("chữ số ngay trước `@` cũng KHÔNG trigger", () => {
    expect(detectMentionTrigger("2026@x", 6)).toBeNull();
  });

  it("có xuống dòng giữa `@` và con trỏ ⇒ KHÔNG trigger", () => {
    expect(detectMentionTrigger("@nam\nsang ý khác", 16)).toBeNull();
  });

  it("truy vấn quá dài ⇒ KHÔNG trigger (đang gõ văn xuôi có dấu @)", () => {
    const text = `@${"x".repeat(40)}`;
    expect(detectMentionTrigger(text, text.length)).toBeNull();
  });

  it("không có `@` nào ⇒ null", () => {
    expect(detectMentionTrigger("không nhắc ai cả", 16)).toBeNull();
  });

  it("tên nhiều âm tiết vẫn trong một truy vấn (`@Nguyễn Văn`)", () => {
    expect(detectMentionTrigger("@Nguyễn Văn", 11)).toEqual({ start: 0, query: "Nguyễn Văn" });
  });
});

describe("filterMentionCandidates · bỏ dấu + ưu tiên khớp đầu tên", () => {
  const all = [NAM, NGA, BINH];

  it("gõ không dấu vẫn khớp có dấu (`nguyen` ⇒ Nguyễn Văn Nam)", () => {
    expect(filterMentionCandidates(all, "nguyen").map((c) => c.userId)).toEqual([U(1)]);
  });

  it("khớp ĐẦU tên xếp TRƯỚC khớp giữa chuỗi — kể cả khi thứ tự đầu vào ngược lại", () => {
    // "Trần Nga" đứng TRƯỚC trong đầu vào nhưng chỉ khớp GIỮA chuỗi ("trầ*n* nga");
    // "Nguyễn Văn Nam" khớp ngay ký tự ĐẦU ⇒ phải nhảy lên trên.
    const out = filterMentionCandidates([NGA, NAM], "n");
    expect(out.map((c) => c.userId)).toEqual([U(1), U(2)]);
  });

  it("truy vấn rỗng ⇒ trả cả danh sách (vừa gõ `@`)", () => {
    expect(filterMentionCandidates(all, "")).toHaveLength(3);
  });

  it("không ai khớp ⇒ mảng rỗng (component dùng cái này để ĐÓNG popover)", () => {
    expect(filterMentionCandidates(all, "zzz")).toEqual([]);
  });

  it("cắt theo `limit`", () => {
    expect(filterMentionCandidates(all, "", 2)).toHaveLength(2);
  });
});

describe("applyMention · chèn vào nháp", () => {
  it("thay `@query` bằng `@Tên ` và trả con trỏ ngay sau dấu cách", () => {
    const trigger = detectMentionTrigger("chào @ng", 8)!;
    const out = applyMention("chào @ng", trigger, NAM);
    expect(out.text).toBe("chào @Nguyễn Văn Nam ");
    expect(out.caret).toBe(out.text.length);
  });

  it("giữ nguyên phần chữ SAU con trỏ", () => {
    const trigger = detectMentionTrigger("@ng nhé", 3)!;
    const out = applyMention("@ng nhé", trigger, NGA);
    expect(out.text).toBe("@Trần Nga  nhé");
    expect(out.caret).toBe("@Trần Nga ".length);
  });
});

describe("collectMentionIds · id chỉ đi theo chữ CÒN trong nháp", () => {
  const entries = [
    { userId: NAM.userId, label: mentionLabel(NAM.name) },
    { userId: NGA.userId, label: mentionLabel(NGA.name) },
  ];

  it("nhãn còn trong nháp ⇒ id được gửi", () => {
    const body = `${mentionLabel(NAM.name)} ${mentionLabel(NGA.name)} họp lúc 3h`;
    expect(collectMentionIds(body, entries, 20)).toEqual([NAM.userId, NGA.userId]);
  });

  it("XOÁ chữ `@Trần Nga` khỏi nháp ⇒ id của Nga KHÔNG được gửi", () => {
    const body = `${mentionLabel(NAM.name)} họp lúc 3h`;
    expect(collectMentionIds(body, entries, 20)).toEqual([NAM.userId]);
  });

  it("xoá HẾT ⇒ mảng rỗng", () => {
    expect(collectMentionIds("không nhắc ai", entries, 20)).toEqual([]);
  });

  it("nhắc CÙNG một người hai lần ⇒ id chỉ xuất hiện MỘT lần", () => {
    const body = `${mentionLabel(NAM.name)} và ${mentionLabel(NAM.name)}`;
    const twice = [entries[0], entries[0]];
    expect(collectMentionIds(body, twice, 20)).toEqual([NAM.userId]);
  });

  it("HAI người TRÙNG TÊN, xoá một ⇒ chỉ MỘT id đi theo (đếm số lần xuất hiện, không `includes`)", () => {
    const dup = [
      { userId: U(1), label: "@Nam" },
      { userId: U(2), label: "@Nam" },
    ];
    expect(collectMentionIds("@Nam @Nam ơi", dup, 20)).toEqual([U(1), U(2)]);
    expect(collectMentionIds("@Nam ơi", dup, 20)).toEqual([U(1)]);
  });

  it("cắt ở trần `max` (khớp `sendMessageSchema.mentions.max(20)`)", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      userId: `id-${i}`,
      label: `@N${i}`,
    }));
    const body = many.map((m) => m.label).join(" ");
    expect(collectMentionIds(body, many, 20)).toHaveLength(20);
  });
});
