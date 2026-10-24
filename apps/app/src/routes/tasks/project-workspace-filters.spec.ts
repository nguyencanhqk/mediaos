import { describe, expect, it } from "vitest";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import {
  WORKSPACE_WHO_MAX,
  WORKSPACE_WHO_UNASSIGNED,
  buildProjectWorkspaceUrl,
  parseWorkspaceWho,
  toggleWorkspaceWho,
  validateProjectWorkspaceRouteSearch,
  validateWorkspaceFilterSearch,
  workspaceFilterSearchFrom,
  workspaceFiltersFromSearch,
} from "./project-workspace-filters";
import { DEFAULT_WORKSPACE_FILTERS, UNASSIGNED_FILTER_VALUE } from "./workspace-constants";

// S20-TASK-PROJTOOLBARURL-1 (US-TASK-QL-05 phần workspace) — schema search THUẦN của toolbar + rail.
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

/** Đi qua parser THẬT của router — `?overdue=true` tới đây là boolean, `?q=2024` là số. */
const fromUrl = (query: string) => defaultParseSearch(query) as Record<string, unknown>;

describe("validateWorkspaceFilterSearch — giá trị rác ⇒ bỏ khoá, KHÔNG ném", () => {
  it("URL trống ⇒ không khoá nào, bộ lọc = mặc định", () => {
    const search = validateWorkspaceFilterSearch({});
    expect(search).toEqual({});
    expect(workspaceFiltersFromSearch(search)).toEqual(DEFAULT_WORKSPACE_FILTERS);
    expect(parseWorkspaceWho(search.who).size).toBe(0);
  });

  it("giữ giá trị hợp lệ: q · status · priority · overdue · sort · who", () => {
    const search = validateWorkspaceFilterSearch(
      fromUrl(
        `?q=hop%20dong&status=In%20Review&priority=High&overdue=true&sort=dueAsc&who=${U1},unassigned`,
      ),
    );
    expect(search).toEqual({
      q: "hop dong",
      status: "In Review",
      priority: "High",
      overdue: true,
      sort: "dueAsc",
      who: `${U1},unassigned`,
    });
    expect(workspaceFiltersFromSearch(search)).toEqual({
      q: "hop dong",
      status: "In Review",
      priority: "High",
      overdueOnly: true,
      sort: "dueAsc",
    });
  });

  it.each([
    ["status=abc", { status: "abc" }],
    ["status là số", { status: 3 }],
    ["priority=zzz", { priority: "zzz" }],
    ["overdue=maybe", { overdue: "maybe" }],
    ["overdue=false", { overdue: false }],
    ["sort=evil", { sort: "evil" }],
    ["sort=default (mặc định không ghi lên URL)", { sort: "default" }],
    ["q rỗng / chỉ khoảng trắng", { q: "   " }],
    ["q là object", { q: { $ne: 1 } }],
    ["who không phải uuid", { who: "not-a-uuid" }],
    ["who là số", { who: 42 }],
    ["who là object", { who: { a: 1 } }],
  ])("%s ⇒ bỏ khoá", (_label, raw) => {
    expect(() => validateWorkspaceFilterSearch(raw)).not.toThrow();
    expect(validateWorkspaceFilterSearch(raw)).toEqual({});
  });

  it("q dạng số/boolean sau JSON.parse của router vẫn là chữ cần tìm", () => {
    expect(validateWorkspaceFilterSearch(fromUrl("?q=2024")).q).toBe("2024");
  });

  it("q dài bị cắt ở 200 ký tự", () => {
    const q = validateWorkspaceFilterSearch({ q: "a".repeat(500) }).q;
    expect(q).toHaveLength(200);
  });

  it("who: bỏ phần rác, chuẩn chữ thường, bỏ trùng, có trần số người", () => {
    const raw = `${U1.toUpperCase()},xx,${U1},${U2},,unassigned,unassigned`;
    expect(validateWorkspaceFilterSearch({ who: raw }).who).toBe(`${U1},${U2},unassigned`);
    const many = Array.from(
      { length: WORKSPACE_WHO_MAX + 5 },
      (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
    ).join(",");
    const kept = validateWorkspaceFilterSearch({ who: many }).who?.split(",") ?? [];
    expect(kept).toHaveLength(WORKSPACE_WHO_MAX);
  });

  it("who dạng mảng (URL sửa tay `who=[...]`) cũng đọc được", () => {
    expect(validateWorkspaceFilterSearch({ who: [U1, "rác", 7] }).who).toBe(U1);
  });
});

describe("who ⇄ selection của rail", () => {
  it("«unassigned» trên URL ⇄ sentinel nội bộ của rail", () => {
    const selection = parseWorkspaceWho(`${U1},${WORKSPACE_WHO_UNASSIGNED}`);
    expect([...selection]).toEqual([U1, UNASSIGNED_FILTER_VALUE]);
    expect(workspaceFilterSearchFrom(DEFAULT_WORKSPACE_FILTERS, selection)).toEqual({
      who: `${U1},unassigned`,
    });
  });

  it("toggle trả Set MỚI (không sửa Set cũ)", () => {
    const before = parseWorkspaceWho(U1);
    const added = toggleWorkspaceWho(before, U2);
    const removed = toggleWorkspaceWho(added, U1);
    expect([...before]).toEqual([U1]);
    expect([...added]).toEqual([U1, U2]);
    expect([...removed]).toEqual([U2]);
  });

  it("bộ lọc mặc định + selection rỗng ⇒ không ghi khoá nào", () => {
    expect(workspaceFilterSearchFrom(DEFAULT_WORKSPACE_FILTERS, new Set())).toEqual({});
  });
});

describe("validateProjectWorkspaceRouteSearch — search của route workspace dự án", () => {
  it("giữ nguyên ?tab (PROJECTENTRY) và ?task (DRAWER) cạnh bộ lọc", () => {
    const search = validateProjectWorkspaceRouteSearch(
      fromUrl(`?tab=board&task=${U2}&addMembers=1&status=Done&who=${U1}`),
    );
    expect(search).toEqual({ tab: "board", task: U2, addMembers: 1, status: "Done", who: U1 });
  });

  it("toàn rác ⇒ {} (không 404, không ném)", () => {
    expect(
      validateProjectWorkspaceRouteSearch(
        fromUrl("?tab=nope&status=abc&priority=1&overdue=no&who=x&sort=zz"),
      ),
    ).toEqual({});
  });
});

describe("buildProjectWorkspaceUrl — đi vòng qua serializer/parser thật của router", () => {
  it("không bộ lọc ⇒ y như URL tab cũ", () => {
    expect(buildProjectWorkspaceUrl("proj-001", { tab: "list" })).toBe(
      "/tasks/projects/proj-001?tab=list",
    );
    expect(buildProjectWorkspaceUrl("proj-001", {})).toBe("/tasks/projects/proj-001");
  });

  it.each(["2024", "true", "null", "báo cáo & tiến độ", '"trích"'])(
    "q=%s đọc lại đúng nguyên văn",
    (q) => {
      const url = buildProjectWorkspaceUrl("proj-001", { tab: "board", q });
      const reread = validateProjectWorkspaceRouteSearch(fromUrl(url.split("?")[1] ?? ""));
      expect(reread).toEqual({ tab: "board", q });
    },
  );

  it("đủ bộ lọc + task ⇒ đọc lại y nguyên, tab đứng đầu", () => {
    const search = {
      tab: "list" as const,
      q: "hop dong",
      status: "Todo" as const,
      priority: "Urgent" as const,
      overdue: true as const,
      sort: "titleAsc" as const,
      who: `${U1},unassigned`,
      task: U2,
    };
    const url = buildProjectWorkspaceUrl("proj-001", search);
    expect(url.startsWith("/tasks/projects/proj-001?tab=list&")).toBe(true);
    expect(validateProjectWorkspaceRouteSearch(fromUrl(url.split("?")[1] ?? ""))).toEqual(search);
    // cùng một kết quả với serializer mặc định của router (không tự chế mã hoá)
    expect(url.split("?")[1]).toBe(defaultStringifySearch(search).slice(1));
  });
});
