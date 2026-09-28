import { describe, expect, it, vi } from "vitest";
import type { TenantTx } from "../db/db.service";
import {
  audiencePairKey,
  classifyInAudience,
  loadMentionsForTargets,
  mentionsFor,
  parseHashtags,
  targetTypeLabel,
  type MentionTarget,
} from "./social-mentions";

/**
 * S16-SOCIAL-BE-1 — parse hashtag (plan §2 D8 · §5 R25).
 *
 * ⚠️ Lý do file này tồn tại: regex ASCII (`[a-zA-Z0-9_]`) trông "chạy được" trên mọi ca tiếng Anh và
 * âm thầm cắt cụt MỌI hashtag tiếng Việt có dấu — `#tuyểndụng` thành `tuy`. Đây là ca THƯỜNG của một
 * công ty Việt Nam, không phải ca biên.
 */

describe("parseHashtags — Unicode", () => {
  it("hashtag tiếng Việt CÓ DẤU giữ nguyên trọn vẹn", () => {
    expect(parseHashtags("tin mới #tuyểndụng hôm nay")).toEqual(["tuyểndụng"]);
  });

  it("hashtag có dấu + chữ số + gạch dưới", () => {
    expect(parseHashtags("#đợt_2 và #q4_2026")).toEqual(["đợt_2", "q4_2026"]);
  });

  it("chuẩn hoá về CHỮ THƯỜNG", () => {
    expect(parseHashtags("#TuyenDung #tuyendung")).toEqual(["tuyendung"]);
  });

  it("bỏ TRÙNG, giữ THỨ TỰ xuất hiện", () => {
    expect(parseHashtags("#b #a #b #c")).toEqual(["b", "a", "c"]);
  });
});

describe("parseHashtags — biên", () => {
  it("body rỗng / null / undefined ⇒ mảng rỗng", () => {
    expect(parseHashtags("")).toEqual([]);
    expect(parseHashtags(null)).toEqual([]);
    expect(parseHashtags(undefined)).toEqual([]);
  });

  it("KHÔNG bắt `#` nằm GIỮA một từ (`abc#def` là một phần của từ, không phải thẻ)", () => {
    expect(parseHashtags("email abc#def xyz")).toEqual([]);
  });

  it("`#` trơ trọi / theo sau là khoảng trắng ⇒ không thẻ nào", () => {
    expect(parseHashtags("# và # nữa")).toEqual([]);
  });

  it("BỎ thẻ dài hơn 64 ký tự, KHÔNG cắt cụt (cắt cụt đẻ thẻ rác gần-giống)", () => {
    const long = "a".repeat(65);
    expect(parseHashtags(`#${long} #ok`)).toEqual(["ok"]);
    expect(parseHashtags(`#${"a".repeat(64)}`)).toEqual(["a".repeat(64)]);
  });

  it("trần 20 thẻ / một nội dung", () => {
    const body = Array.from({ length: 30 }, (_, i) => `#t${i}`).join(" ");
    expect(parseHashtags(body)).toHaveLength(20);
  });

  it("dừng ở dấu câu — `#tag.` cho ra `tag`", () => {
    expect(parseHashtags("xong #tag. hết")).toEqual(["tag"]);
  });
});

describe("targetTypeLabel — biến template NOTI-028", () => {
  it("khớp nhãn tiếng Việt của template 0581", () => {
    expect(targetTypeLabel("post")).toBe("bài viết");
    expect(targetTypeLabel("comment")).toBe("bình luận");
  });
});

// ══════════════ S16-SOCIAL-BE-1D — vị từ audience MỘT nguồn (D2) ══════════════

const U1 = "u1000000-0000-4000-8000-000000000001";
const U2 = "u2000000-0000-4000-8000-000000000002";
const G1 = "g1000000-0000-4000-8000-000000000001";
const G2 = "g2000000-0000-4000-8000-000000000002";
const X = "x0000000-0000-4000-8000-00000000000x";
const Y = "y0000000-0000-4000-8000-00000000000y";
const H = "h0000000-0000-4000-8000-00000000000h";

const none = new Set<string>();

describe("classifyInAudience — 3 audience × {trong, ngoài}", () => {
  it("company ⇒ trong (người gọi đã lọc «còn sống»)", () => {
    const t = { audience: "company", orgUnitId: null, groupId: null };
    expect(classifyInAudience(t, { userId: X, orgUnitId: null }, none, none)).toBe(true);
  });

  it("org_unit: cùng đơn vị ⇒ trong · khác đơn vị ⇒ ngoài · không hồ sơ ⇒ ngoài", () => {
    const t = { audience: "org_unit", orgUnitId: U1, groupId: null };
    expect(classifyInAudience(t, { userId: X, orgUnitId: U1 }, none, none)).toBe(true);
    expect(classifyInAudience(t, { userId: X, orgUnitId: U2 }, none, none)).toBe(false);
    expect(classifyInAudience(t, { userId: X, orgUnitId: null }, none, none)).toBe(false);
  });

  it("org_unit: người ĐỨNG ĐẦU đơn vị (hồ sơ ở đơn vị khác) ⇒ trong", () => {
    const t = { audience: "org_unit", orgUnitId: U1, groupId: null };
    const heads = new Set([audiencePairKey(U1, H)]);
    expect(classifyInAudience(t, { userId: H, orgUnitId: U2 }, heads, none)).toBe(true);
  });

  it("[PR1-3] khoá CẶP: head của U1 xét cho bài U2 ⇒ ngoài", () => {
    const t = { audience: "org_unit", orgUnitId: U2, groupId: null };
    const heads = new Set([audiencePairKey(U1, H)]);
    expect(classifyInAudience(t, { userId: H, orgUnitId: null }, heads, none)).toBe(false);
  });

  it("group: thành viên ⇒ trong · không thành viên ⇒ ngoài", () => {
    const t = { audience: "group", orgUnitId: null, groupId: G1 };
    const members = new Set([audiencePairKey(G1, Y)]);
    expect(classifyInAudience(t, { userId: Y, orgUnitId: null }, none, members)).toBe(true);
    expect(classifyInAudience(t, { userId: X, orgUnitId: null }, none, members)).toBe(false);
  });

  it("[PR1-3] khoá CẶP: Y thuộc G1 xét cho bài G2 ⇒ ngoài", () => {
    const t = { audience: "group", orgUnitId: null, groupId: G2 };
    const members = new Set([audiencePairKey(G1, Y)]);
    expect(classifyInAudience(t, { userId: Y, orgUnitId: null }, none, members)).toBe(false);
  });

  // FULL gate BE-1D: `dto.groupId`/`dto.orgUnitId` từ request có thể viết HOA (`z.string().uuid()`
  // nhận), còn tập nạp lấy uuid thường từ DB. Bản cũ khớp nhờ Postgres so uuid không phân biệt hoa thường.
  it("id đơn vị/nhóm viết HOA từ request vẫn khớp tập nạp từ DB (không bỏ im lặng)", () => {
    const members = new Set([audiencePairKey(G1, Y)]);
    const heads = new Set([audiencePairKey(U1, H)]);
    const group = { audience: "group", orgUnitId: null, groupId: G1.toUpperCase() };
    const unit = { audience: "org_unit", orgUnitId: U1.toUpperCase(), groupId: null };
    expect(classifyInAudience(group, { userId: Y, orgUnitId: null }, none, members)).toBe(true);
    expect(classifyInAudience(unit, { userId: H, orgUnitId: null }, heads, none)).toBe(true);
  });

  it("audience lạ / thiếu id đơn vị-nhóm ⇒ ngoài (hướng an toàn)", () => {
    const p = { userId: X, orgUnitId: U1 };
    expect(classifyInAudience({ audience: "x", orgUnitId: U1, groupId: G1 }, p, none, none)).toBe(
      false,
    );
    expect(
      classifyInAudience({ audience: "org_unit", orgUnitId: null, groupId: null }, p, none, none),
    ).toBe(false);
  });
});

// ══════════════ S16-SOCIAL-BE-1D — bộ nạp theo LÔ (D7 · D4 · D8) ══════════════

/**
 * Tx giả: mỗi `tx.select(...)` trả một chuỗi builder thenable, lần gọi thứ n resolve `results[n]`.
 * Đếm `select` = đếm câu SQL — thứ ca N+1 cần đo.
 *
 * ⚠️ `results` GẮN VỚI THỨ TỰ câu trong `loadMentionsForTargets` (mention → head → thành viên nhóm).
 * Đảo thứ tự hai câu sau trong code là ca lô-trộn ĐỎ dù code vẫn đúng — sửa lại thứ tự `results`.
 */
function fakeTx(results: unknown[][]) {
  let n = 0;
  const select = vi.fn(() => {
    const rows = results[n++] ?? [];
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
  return { tx: { select } as unknown as TenantTx, select };
}

const P_CO = "p1000000-0000-4000-8000-000000000001";
const P_OU = "p2000000-0000-4000-8000-000000000002";
const P_G1 = "p3000000-0000-4000-8000-000000000003";
const P_G2 = "p4000000-0000-4000-8000-000000000004";
const EMP = "e0000000-0000-4000-8000-00000000000e";
const CO = "c0000000-0000-4000-8000-00000000000c";

const alive = (targetId: string, userId: string, over: Record<string, unknown> = {}) => ({
  targetId,
  userId,
  userStatus: "active",
  userDeletedAt: null,
  label: `Tên ${userId.slice(0, 2)}`,
  employeeId: EMP,
  orgUnitId: null,
  ...over,
});

const mixed: MentionTarget[] = [
  { id: P_CO, audience: "company", orgUnitId: null, groupId: null },
  { id: P_OU, audience: "org_unit", orgUnitId: U1, groupId: null },
  { id: P_G1, audience: "group", orgUnitId: null, groupId: G1 },
  { id: P_G2, audience: "group", orgUnitId: null, groupId: G2 },
];

describe("loadMentionsForTargets — ≤ 3 câu cho CẢ lô", () => {
  it("lô trộn 3 audience ⇒ ĐÚNG 3 câu (mention · head · thành viên nhóm)", async () => {
    const { tx, select } = fakeTx([
      [alive(P_CO, X), alive(P_OU, H, { orgUnitId: U2 }), alive(P_G1, Y), alive(P_G2, Y)],
      [{ orgUnitId: U1, headUserId: H }],
      [{ groupId: G1, userId: Y }],
    ]);
    const out = await loadMentionsForTargets(tx, CO, "post", mixed);
    expect(select).toHaveBeenCalledTimes(3);
    expect(out.get(P_CO)).toEqual([{ withheld: false, employeeId: EMP, label: "Tên x0" }]);
    expect(out.get(P_OU)).toEqual([{ withheld: false, employeeId: EMP, label: "Tên h0" }]);
    expect(out.get(P_G1)).toEqual([{ withheld: false, employeeId: EMP, label: "Tên y0" }]);
    // [PR1-3] Y thuộc G1, KHÔNG thuộc G2 — cùng lô không được lây.
    expect(out.get(P_G2)).toEqual([{ withheld: true }]);
  });

  it("chỉ bài company ⇒ 1 câu (không hỏi head/nhóm khi không cần)", async () => {
    const { tx, select } = fakeTx([[alive(P_CO, X)]]);
    await loadMentionsForTargets(tx, CO, "post", [mixed[0]]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("không đích ⇒ 0 câu · đích không mention ⇒ mảng RỖNG có mặt", async () => {
    const empty = fakeTx([]);
    expect((await loadMentionsForTargets(empty.tx, CO, "post", [])).size).toBe(0);
    expect(empty.select).not.toHaveBeenCalled();

    const { tx, select } = fakeTx([[]]);
    const out = await loadMentionsForTargets(tx, CO, "comment", mixed);
    expect(select).toHaveBeenCalledTimes(1);
    expect(out.get(P_G1)).toEqual([]);
  });
});

describe("loadMentionsForTargets — ca biên ⇒ `withheld`, GIỮ vị trí (D4 · D8)", () => {
  const company = [mixed[0]];

  it.each([
    ["tài khoản khoá", { userStatus: "locked" }],
    ["tài khoản xoá mềm", { userDeletedAt: new Date() }],
    ["user không còn (LEFT JOIN rỗng)", { userId: null, label: null, employeeId: null }],
    ["không hồ sơ nhân sự sống", { employeeId: null }],
    ["tên rỗng", { label: "   " }],
    ["tên NULL", { label: null }],
  ])("%s ⇒ {withheld:true}", async (_n, over) => {
    const { tx } = fakeTx([[alive(P_CO, X), alive(P_CO, Y, over)]]);
    const out = await loadMentionsForTargets(tx, CO, "post", company);
    const list = out.get(P_CO);
    expect(list).toHaveLength(2);
    expect(list?.[0]).toMatchObject({ withheld: false });
    expect(list?.[1]).toEqual({ withheld: true });
  });

  it("hàng mention lạc đích ⇒ NÉM, không nuốt im lặng", async () => {
    const { tx } = fakeTx([[alive("zz000000-0000-4000-8000-0000000000zz", X)]]);
    await expect(loadMentionsForTargets(tx, CO, "post", company)).rejects.toThrow(/lạc đích/);
  });
});

describe("mentionsFor — thiếu đích là lỗi, KHÔNG phải mảng rỗng", () => {
  it("trả mảng khi có · NÉM khi đích không nằm trong lô", () => {
    const map = new Map([[P_CO, []]]);
    expect(mentionsFor(map, P_CO)).toEqual([]);
    expect(() => mentionsFor(map, P_OU)).toThrow(/không có trong lô/);
  });
});
