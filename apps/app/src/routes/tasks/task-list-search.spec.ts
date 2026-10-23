/**
 * S20-TASK-DRAWER-1 (US-TASK-QL-05) — `validateSearch` của `/tasks`: rác ⇒ mặc định, KHÔNG ném.
 * Đầu vào là ĐẦU RA của parser thật của router (JSON.parse từng giá trị) — không chỉ object tay.
 */
import { describe, it, expect } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import {
  TASK_LIST_SEARCH_MAX,
  hasActiveTaskListFilters,
  toTaskListQuery,
  validateTaskListSearch,
} from "./task-list-search";

const P = "0b9f6a4e-2c1d-4e8f-9a7b-3c5d6e7f8a9b";
const A = "1c8e5b3d-3d2e-4f9a-8b6c-4d6e7f8a9b0c";

const parse = (qs: string) => validateTaskListSearch(defaultParseSearch(qs));

describe("validateTaskListSearch", () => {
  it("giữ đủ bộ lọc hợp lệ từ URL (kể cả `In Review` có dấu cách)", () => {
    expect(
      parse(
        `?status=In%20Review&priority=High&assignee=${A}&project=${P}&department=${P}` +
          "&dueFrom=2026-10-01&dueTo=2026-10-31&overdue=true&search=b%C3%A1o%20c%C3%A1o&page=3",
      ),
    ).toEqual({
      status: "In Review",
      priority: "High",
      assignee: A,
      project: P,
      department: P,
      dueFrom: "2026-10-01",
      dueTo: "2026-10-31",
      overdue: true,
      search: "báo cáo",
      page: 3,
    });
  });

  it("giá trị rác ⇒ bỏ khoá đó (mặc định), không ném", () => {
    expect(
      parse(
        "?status=abc&priority=Max&assignee=not-a-uuid&project=1&dueFrom=2026-13-40" +
          "&dueTo=hom-nay&overdue=maybe&search=%20%20&page=-2",
      ),
    ).toEqual({});
    expect(parse("?page=1")).toEqual({});
    expect(parse("?page=2.5")).toEqual({});
    expect(parse("?page=99999999")).toEqual({});
  });

  it("parser biến `?search=2024` thành SỐ ⇒ vẫn giữ là chuỗi tìm", () => {
    expect(parse("?search=2024")).toEqual({ search: "2024" });
  });

  it("ô tìm bị cắt ở trần của API", () => {
    const long = "a".repeat(TASK_LIST_SEARCH_MAX + 50);
    expect(parse(`?search=${long}`).search).toHaveLength(TASK_LIST_SEARCH_MAX);
  });

  it("không đụng tham số ngoài bộ lọc (vd `task` của drawer) — router giữ chúng ở URL", () => {
    expect(parse(`?task=${P}&status=Todo`)).toEqual({ status: "Todo" });
  });
});

describe("hasActiveTaskListFilters / toTaskListQuery", () => {
  it("chỉ `page` không tính là đang lọc", () => {
    expect(hasActiveTaskListFilters({ page: 2 })).toBe(false);
    expect(hasActiveTaskListFilters({ search: "x" })).toBe(true);
  });

  it("nối đúng tham số sẵn có của GET /tasks (search · assigneeEmployeeId · offset)", () => {
    const q = toTaskListQuery({ search: "báo cáo", assignee: A, overdue: true, page: 2 }, 20);
    expect(q).toMatchObject({
      search: "báo cáo",
      assigneeEmployeeId: A,
      overdue: true,
      limit: 20,
      offset: 20,
    });
    expect(toTaskListQuery({}, 20)).toMatchObject({ offset: 0, search: undefined });
  });
});
