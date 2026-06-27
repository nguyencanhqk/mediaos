/**
 * api-params.spec.ts — Unit tests cho buildQueryString + toApiListParams (FRONTEND-04 §12, §25.2).
 *
 * RED phase: viết trước khi implement. Land BƯỚC 1.
 */
import { describe, expect, it } from "vitest";
import { buildQueryString } from "./api-params";
import { toApiListParams } from "./api-types";

describe("buildQueryString", () => {
  it("rỗng / undefined → ''", () => {
    expect(buildQueryString()).toBe("");
    expect(buildQueryString({})).toBe("");
  });

  it("có '?' ở đầu khi có param", () => {
    const qs = buildQueryString({ page: 1 });
    expect(qs).toMatch(/^\?/);
  });

  it("bỏ undefined/null/chuỗi rỗng", () => {
    const qs = buildQueryString({ a: undefined, b: null, c: "", d: 1 });
    expect(qs).not.toContain("a=");
    expect(qs).not.toContain("b=");
    expect(qs).not.toContain("c=");
    expect(qs).toContain("d=1");
  });

  it("array → multi-value: status=a&status=b", () => {
    const qs = buildQueryString({ status: ["active", "inactive"] });
    expect(qs).toContain("status=active");
    expect(qs).toContain("status=inactive");
  });

  it("object lồng → bracket notation: filters[dept]=uuid", () => {
    const qs = buildQueryString({ filters: { dept: "uuid-123" } });
    expect(qs).toContain("filters%5Bdept%5D=uuid-123");
  });

  it("search + page được encode đúng", () => {
    const qs = buildQueryString({ search: "Nguyễn Văn A", page: 2 });
    expect(qs).toMatch(/search=/);
    expect(qs).toMatch(/page=2/);
  });
});

describe("toApiListParams", () => {
  it("sort + order → 'field:dir'", () => {
    const params = toApiListParams({ page: 1, per_page: 20, sort: "created_at", order: "desc" });
    expect(params.sort).toBe("created_at:desc");
  });

  it("sort mà không có order → 'field:asc' mặc định", () => {
    const params = toApiListParams({ page: 1, per_page: 20, sort: "name" });
    expect(params.sort).toBe("name:asc");
  });

  it("không sort → sort undefined", () => {
    const params = toApiListParams({ page: 1, per_page: 20 });
    expect(params.sort).toBeUndefined();
  });

  it("search.trim() — xoá khoảng trắng đầu cuối", () => {
    const params = toApiListParams({ page: 1, per_page: 20, search: "  hello  " });
    expect(params.search).toBe("hello");
  });

  it("search rỗng sau trim → undefined", () => {
    const params = toApiListParams({ page: 1, per_page: 20, search: "   " });
    expect(params.search).toBeUndefined();
  });

  it("page + per_page được pass through", () => {
    const params = toApiListParams({ page: 3, per_page: 50 });
    expect(params.page).toBe(3);
    expect(params.per_page).toBe(50);
  });
});
