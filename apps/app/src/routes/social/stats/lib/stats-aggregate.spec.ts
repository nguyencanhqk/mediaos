/**
 * S16-SOCIAL-FE-3B (L5a, ca T3 — vế số liệu) — phép gộp của màn Thống kê tương tác.
 *
 * Fixture `makeEngagement()`: 2 tuần, 2 đơn vị (một đã xoá) + một hàng «chưa gán đơn vị»; `rows` THƯA có chủ ý.
 * Số kỳ vọng VIẾT TAY từ fixture, không tính lại bằng chính công thức đang đo.
 */
import { describe, expect, it } from "vitest";
import type { FeedEngagementRowDto, FeedEngagementWeekDto } from "@mediaos/contracts";
import { DELETED_UNIT_ID, UNIT_ID, makeEngagement } from "../../admin/admin-test-doubles";
import {
  formatCount,
  isEngagementEmpty,
  latestWeek,
  sumWeekTotals,
  unitTotals,
  weekInteractions,
} from "./stats-aggregate";

const STRAY_UNIT_ID = "99999999-9999-4999-8999-999999999999";

const row = (over: Partial<FeedEngagementRowDto>): FeedEngagementRowDto => ({
  weekStart: "2026-09-28",
  orgUnitId: UNIT_ID,
  posts: 0,
  comments: 0,
  reactions: 0,
  activeMembers: 0,
  ...over,
});

describe("sumWeekTotals — ba thẻ tổng", () => {
  it("cộng bài · bình luận · cảm xúc qua các tuần", () => {
    expect(sumWeekTotals(makeEngagement().weekTotals)).toStrictEqual({
      posts: 7,
      comments: 10,
      reactions: 19,
    });
  });

  it("0 tuần ⇒ toàn số 0 (không NaN)", () => {
    expect(sumWeekTotals([])).toStrictEqual({ posts: 0, comments: 0, reactions: 0 });
  });
});

describe("latestWeek — thẻ «thành viên hoạt động tuần gần nhất»", () => {
  it("🔴 là hàng `weekTotals` CUỐI (5), KHÔNG phải tổng các tuần (3 + 5 = 8)", () => {
    const latest = latestWeek(makeEngagement().weekTotals);
    expect(latest?.weekStart).toBe("2026-09-28");
    expect(latest?.activeMembers).toBe(5);
  });

  it("tuần cuối không ai hoạt động ⇒ vẫn là tuần cuối với số 0 (không lùi về tuần có số)", () => {
    const weeks: FeedEngagementWeekDto[] = [
      { weekStart: "2026-09-21", posts: 2, comments: 4, reactions: 7, activeMembers: 3 },
      { weekStart: "2026-09-28", posts: 0, comments: 0, reactions: 0, activeMembers: 0 },
    ];
    expect(latestWeek(weeks)).toStrictEqual(weeks[1]);
  });

  it("0 tuần ⇒ null", () => {
    expect(latestWeek([])).toBeNull();
  });
});

describe("unitTotals — bảng «Theo đơn vị»", () => {
  it("gộp `rows` theo đơn vị qua các tuần; thứ tự = `units` của server rồi tới «chưa gán đơn vị»", () => {
    expect(unitTotals(makeEngagement())).toStrictEqual([
      {
        key: UNIT_ID,
        kind: "unit",
        name: "Phòng Kỹ thuật",
        isDeleted: false,
        posts: 5,
        comments: 9,
        reactions: 16,
      },
      {
        key: DELETED_UNIT_ID,
        kind: "unit",
        name: "Phòng Dự án cũ",
        isDeleted: true,
        posts: 1,
        comments: 0,
        reactions: 1,
      },
      {
        key: "unassigned",
        kind: "unassigned",
        name: null,
        isDeleted: false,
        posts: 1,
        comments: 1,
        reactions: 2,
      },
    ]);
  });

  it("`rows` thưa: đơn vị không có hàng nào ⇒ vẫn có hàng với số 0, mọi ô là số hữu hạn", () => {
    const data = makeEngagement({ rows: [row({ orgUnitId: UNIT_ID, posts: 4 })] });
    const totals = unitTotals(data);
    expect(totals.map((r) => [r.key, r.posts, r.comments, r.reactions])).toEqual([
      [UNIT_ID, 4, 0, 0],
      [DELETED_UNIT_ID, 0, 0, 0],
    ]);
    for (const r of totals) {
      expect([r.posts, r.comments, r.reactions].every(Number.isFinite)).toBe(true);
    }
  });

  it("không có hàng `orgUnitId: null` ⇒ KHÔNG có hàng «chưa gán đơn vị»", () => {
    const data = makeEngagement({ rows: [row({ orgUnitId: UNIT_ID, posts: 1 })] });
    expect(unitTotals(data).some((r) => r.kind === "unassigned")).toBe(false);
  });

  it("hàng mang đơn vị KHÔNG có trong `units` ⇒ không bị nuốt: gộp vào hàng `unknown`", () => {
    const data = makeEngagement({
      rows: [row({ orgUnitId: STRAY_UNIT_ID, posts: 2, comments: 1, reactions: 3 })],
    });
    expect(unitTotals(data).at(-1)).toStrictEqual({
      key: "unknown",
      kind: "unknown",
      name: null,
      isDeleted: false,
      posts: 2,
      comments: 1,
      reactions: 3,
    });
  });

  it("đang lọc MỘT đơn vị ⇒ chỉ một hàng của đơn vị đó (các đơn vị khác không hiện như thể bằng 0)", () => {
    const data = makeEngagement({
      rows: [row({ weekStart: "2026-09-21", posts: 2 }), row({ posts: 3, reactions: 1 })],
    });
    expect(unitTotals(data, UNIT_ID)).toStrictEqual([
      {
        key: UNIT_ID,
        kind: "unit",
        name: "Phòng Kỹ thuật",
        isDeleted: false,
        posts: 5,
        comments: 0,
        reactions: 1,
      },
    ]);
  });

  it("khoá hàng không trùng nhau; không sửa dữ liệu đầu vào", () => {
    const data = makeEngagement();
    const snapshot = structuredClone(data);
    const keys = unitTotals(data).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(3);
    expect(data).toStrictEqual(snapshot);
  });
});

describe("weekInteractions · isEngagementEmpty · formatCount", () => {
  it("tổng tương tác một tuần = bài + bình luận + cảm xúc (không cộng thành viên)", () => {
    expect(weekInteractions({ posts: 5, comments: 6, reactions: 12 })).toBe(23);
  });

  it("rỗng ⇔ `units` VÀ `rows` cùng rỗng; có đơn vị mà chưa có hoạt động thì KHÔNG rỗng", () => {
    expect(isEngagementEmpty(makeEngagement({ units: [], rows: [] }))).toBe(true);
    expect(isEngagementEmpty(makeEngagement({ rows: [] }))).toBe(false);
    expect(isEngagementEmpty(makeEngagement({ units: [] }))).toBe(false);
  });

  it("số đếm viết theo kiểu Việt: dấu chấm ngăn nghìn", () => {
    expect(formatCount(1234567)).toBe("1.234.567");
    expect(formatCount(0)).toBe("0");
  });
});
