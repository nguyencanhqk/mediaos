/**
 * S16-SOCIAL-FE-3B (L4, ca F1 — vế lib) — nháp của form huy hiệu → body 049 / 050.
 *
 * Body kiểm bằng CHÍNH schema contracts (`createKudosBadgeSchema` · `updateKudosBadgeSchema`); hình dạng
 * kỳ vọng viết tay bằng `toStrictEqual` — 050 chỉ được mang trường ĐÃ ĐỔI và KHÔNG BAO GIỜ mang `code`.
 */
import { describe, expect, it } from "vitest";
import {
  createKudosBadgeSchema,
  KUDOS_BADGE_DESCRIPTION_MAX,
  KUDOS_BADGE_ICON_MAX,
  KUDOS_BADGE_NAME_MAX,
  KUDOS_BADGE_POSITION_MAX,
  updateKudosBadgeSchema,
} from "@mediaos/contracts";
import { makeBadgeAdmin } from "../../admin/admin-test-doubles";
import {
  BADGE_FIELDS,
  buildCreateBadgeBody,
  buildUpdateBadgeBody,
  draftFromBadge,
  draftIcon,
  emptyBadgeDraft,
  type BadgeDraft,
} from "./badge-form";

const draft = (over: Partial<BadgeDraft> = {}): BadgeDraft => ({
  code: "team-player",
  name: "Đồng đội",
  description: "",
  iconName: "",
  emoji: "",
  position: "0",
  ...over,
});

describe("nháp", () => {
  it("`BADGE_FIELDS` = năm ô có thể mang lỗi (viết tay)", () => {
    expect([...BADGE_FIELDS]).toEqual(["code", "name", "description", "icon", "position"]);
  });

  it("nháp trống: mọi ô rỗng, thứ tự mặc định «0»; mỗi lần gọi một object mới", () => {
    expect(emptyBadgeDraft()).toStrictEqual({
      code: "",
      name: "",
      description: "",
      iconName: "",
      emoji: "",
      position: "0",
    });
    expect(emptyBadgeDraft()).not.toBe(emptyBadgeDraft());
  });

  it("nháp từ huy hiệu: icon có trong danh mục ⇒ ô chọn; emoji / chuỗi lạ ⇒ ô emoji NGUYÊN VĂN; `null` ⇒ cả hai rỗng", () => {
    expect(draftFromBadge(makeBadgeAdmin({ position: 7 }))).toStrictEqual({
      code: "team-player",
      name: "Đồng đội",
      description: "Luôn hỗ trợ đồng nghiệp",
      iconName: "users-round",
      emoji: "",
      position: "7",
    });
    expect(draftFromBadge(makeBadgeAdmin({ icon: "🎉" }))).toMatchObject({
      iconName: "",
      emoji: "🎉",
    });
    // Không tự «sửa hộ» chữ hoa: `Award` ≠ khoá `award` của danh mục ⇒ giữ nguyên văn ở ô emoji.
    expect(draftFromBadge(makeBadgeAdmin({ icon: "Award" }))).toMatchObject({
      iconName: "",
      emoji: "Award",
    });
    expect(draftFromBadge(makeBadgeAdmin({ icon: null, description: null }))).toMatchObject({
      iconName: "",
      emoji: "",
      description: "",
    });
  });

  it("`draftIcon`: ô emoji có chữ THẮNG ô chọn; cả hai rỗng ⇒ `null`", () => {
    expect(draftIcon(draft({ iconName: "rocket", emoji: " 🎉 " }))).toBe("🎉");
    expect(draftIcon(draft({ iconName: "rocket", emoji: "   " }))).toBe("rocket");
    expect(draftIcon(draft())).toBeNull();
  });
});

describe("F1 — body 049 (`buildCreateBadgeBody`)", () => {
  it("nháp tối thiểu ⇒ ĐÚNG `{code,name,position}` — không khoá `description` / `icon`; qua schema", () => {
    const out = buildCreateBadgeBody(draft({ code: "  team-player ", name: "  Đồng đội  " }));
    expect(out).toStrictEqual({
      kind: "ready",
      body: { code: "team-player", name: "Đồng đội", position: 0 },
    });
    if (out.kind !== "ready") throw new Error("kỳ vọng ready");
    expect(createKudosBadgeSchema.safeParse(out.body).success).toBe(true);
  });

  it("nháp đủ ⇒ đủ năm trường, mô tả đã cắt khoảng trắng, thứ tự là SỐ; qua schema", () => {
    const out = buildCreateBadgeBody(
      draft({ description: "  Luôn hỗ trợ  ", iconName: "rocket", position: "12" }),
    );
    expect(out).toStrictEqual({
      kind: "ready",
      body: {
        code: "team-player",
        name: "Đồng đội",
        description: "Luôn hỗ trợ",
        icon: "rocket",
        position: 12,
      },
    });
    if (out.kind !== "ready") throw new Error("kỳ vọng ready");
    expect(createKudosBadgeSchema.safeParse(out.body).success).toBe(true);
  });

  it("emoji ở ô emoji ⇒ `icon` là emoji đó (thắng ô chọn)", () => {
    const out = buildCreateBadgeBody(draft({ iconName: "star", emoji: "🎉" }));
    expect(out).toMatchObject({ kind: "ready", body: { icon: "🎉" } });
  });

  it.each([
    ["A b", "chữ hoa + khoảng trắng"],
    ["a", "ngắn hơn 2"],
    ["", "rỗng"],
    ["đồng-đội", "có dấu"],
    ["a".repeat(33), "dài hơn 32"],
    ["team_player", "gạch dưới"],
  ])("mã `%s` (%s) ⇒ `invalid` tại ô `code`", (code) => {
    expect(buildCreateBadgeBody(draft({ code }))).toStrictEqual({
      kind: "invalid",
      fields: ["code"],
    });
  });

  it("từng ô sai ⇒ đúng ô đó; nhiều ô sai ⇒ đủ các ô, theo thứ tự `BADGE_FIELDS`", () => {
    expect(buildCreateBadgeBody(draft({ name: "   " }))).toStrictEqual({
      kind: "invalid",
      fields: ["name"],
    });
    expect(
      buildCreateBadgeBody(draft({ name: "x".repeat(KUDOS_BADGE_NAME_MAX + 1) })),
    ).toStrictEqual({ kind: "invalid", fields: ["name"] });
    expect(
      buildCreateBadgeBody(draft({ description: "x".repeat(KUDOS_BADGE_DESCRIPTION_MAX + 1) })),
    ).toStrictEqual({ kind: "invalid", fields: ["description"] });
    expect(
      buildCreateBadgeBody(draft({ emoji: "x".repeat(KUDOS_BADGE_ICON_MAX + 1) })),
    ).toStrictEqual({ kind: "invalid", fields: ["icon"] });
    expect(buildCreateBadgeBody(draft({ code: "A b", name: "", position: "x" }))).toStrictEqual({
      kind: "invalid",
      fields: ["code", "name", "position"],
    });
  });

  it.each(["", "  ", "x", "1.5", "-1", "1e3", String(KUDOS_BADGE_POSITION_MAX + 1)])(
    "thứ tự `%s` ⇒ `invalid` tại ô `position` (không gửi NaN, không tự đổi thành 0)",
    (position) => {
      expect(buildCreateBadgeBody(draft({ position }))).toStrictEqual({
        kind: "invalid",
        fields: ["position"],
      });
    },
  );

  it("thứ tự ở hai biên 0 và trần `smallint` ⇒ nhận", () => {
    expect(buildCreateBadgeBody(draft({ position: " 0 " }))).toMatchObject({
      kind: "ready",
      body: { position: 0 },
    });
    expect(
      buildCreateBadgeBody(draft({ position: String(KUDOS_BADGE_POSITION_MAX) })),
    ).toMatchObject({ kind: "ready", body: { position: KUDOS_BADGE_POSITION_MAX } });
  });
});

describe("F1 — body 050 (`buildUpdateBadgeBody`): CHỈ trường đã đổi, không bao giờ có `code`", () => {
  const badge = makeBadgeAdmin({ position: 3 });
  const initial = (): BadgeDraft => draftFromBadge(badge);

  it("không đổi gì ⇒ `unchanged` (không có body để gửi)", () => {
    expect(buildUpdateBadgeBody(badge, initial())).toStrictEqual({ kind: "unchanged" });
  });

  it("chỉ thêm / bớt khoảng trắng ở tên · mô tả ⇒ vẫn `unchanged`", () => {
    expect(
      buildUpdateBadgeBody(badge, {
        ...initial(),
        name: "  Đồng đội ",
        description: "Luôn hỗ trợ đồng nghiệp  ",
      }),
    ).toStrictEqual({ kind: "unchanged" });
  });

  it("đổi MỘT trường ⇒ body `toStrictEqual` đúng một khoá; qua `updateKudosBadgeSchema`", () => {
    const cases: readonly (readonly [Partial<BadgeDraft>, Record<string, unknown>])[] = [
      [{ name: "Đồng đội số 1" }, { name: "Đồng đội số 1" }],
      [{ description: "Mô tả mới" }, { description: "Mô tả mới" }],
      [{ iconName: "rocket" }, { icon: "rocket" }],
      [{ emoji: "🎉" }, { icon: "🎉" }],
      [{ position: "9" }, { position: 9 }],
    ];
    for (const [change, body] of cases) {
      const out = buildUpdateBadgeBody(badge, { ...initial(), ...change });
      expect(out).toStrictEqual({ kind: "ready", body });
      if (out.kind !== "ready") throw new Error("kỳ vọng ready");
      expect(updateKudosBadgeSchema.safeParse(out.body).success).toBe(true);
    }
  });

  it("xoá trắng mô tả / bỏ icon ⇒ gửi `null` TƯỜNG MINH (không phải vắng khoá, không phải chuỗi rỗng)", () => {
    expect(buildUpdateBadgeBody(badge, { ...initial(), description: "  " })).toStrictEqual({
      kind: "ready",
      body: { description: null },
    });
    expect(buildUpdateBadgeBody(badge, { ...initial(), iconName: "" })).toStrictEqual({
      kind: "ready",
      body: { icon: null },
    });
  });

  it("nháp mang `code` KHÁC huy hiệu ⇒ body vẫn KHÔNG có `code` (050 `.strict()` — gửi là 400)", () => {
    const out = buildUpdateBadgeBody(badge, { ...initial(), code: "ma-khac", name: "Tên mới" });
    expect(out).toStrictEqual({ kind: "ready", body: { name: "Tên mới" } });
    expect(buildUpdateBadgeBody(badge, { ...initial(), code: "ma-khac" })).toStrictEqual({
      kind: "unchanged",
    });
  });

  it("trường đã đổi mà sai ⇒ `invalid` đúng ô; trường KHÔNG đổi không bị kiểm lại", () => {
    expect(buildUpdateBadgeBody(badge, { ...initial(), name: " " })).toStrictEqual({
      kind: "invalid",
      fields: ["name"],
    });
    expect(buildUpdateBadgeBody(badge, { ...initial(), position: "" })).toStrictEqual({
      kind: "invalid",
      fields: ["position"],
    });
    // Huy hiệu cũ mang icon lạ (server chấp nhận mọi chuỗi ≤ 64): sửa TÊN không được vấp ở icon.
    const legacy = makeBadgeAdmin({ icon: "Award" });
    expect(
      buildUpdateBadgeBody(legacy, { ...draftFromBadge(legacy), name: "Tên mới" }),
    ).toStrictEqual({ kind: "ready", body: { name: "Tên mới" } });
  });

  it("huy hiệu có `description: null` + `icon: null`, không đổi gì ⇒ `unchanged` (không sinh `null` thừa)", () => {
    const bare = makeBadgeAdmin({ description: null, icon: null });
    expect(buildUpdateBadgeBody(bare, draftFromBadge(bare))).toStrictEqual({ kind: "unchanged" });
  });
});
