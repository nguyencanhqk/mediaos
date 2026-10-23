import { describe, it, expect } from "vitest";
import {
  buildMentionCandidates,
  filterMentionCandidates,
  MENTION_SUGGESTION_LIMIT,
} from "./task-mention-candidates";

describe("buildMentionCandidates (S20-TASK-QUICKENTRY-1)", () => {
  it("giữ thứ tự nguồn: người tham gia trước, danh bạ sau; bỏ trùng theo employee id", () => {
    const out = buildMentionCandidates({
      participants: [
        { employeeId: "a", name: "An" },
        { employeeId: "b", name: "Bình" },
        { employeeId: "a", name: "An (trùng)" },
      ],
      directory: [
        { employeeId: "z", name: "Ánh" },
        { employeeId: "b", name: "Bình (danh bạ)" },
      ],
      selfEmployeeIds: new Set(),
    });
    expect(out).toEqual([
      { id: "a", fullName: "An" },
      { id: "b", fullName: "Bình" },
      { id: "z", fullName: "Ánh" },
    ]);
  });

  it("bỏ chính mình và mục không tên / không id", () => {
    const out = buildMentionCandidates({
      participants: [
        { employeeId: "me", name: "Tôi" },
        { employeeId: "x", name: null },
        { employeeId: "y", name: "   " },
        { employeeId: null, name: "Không id" },
        { employeeId: "c", name: "  Cường  " },
      ],
      directory: [{ employeeId: "me", name: "Tôi" }],
      selfEmployeeIds: new Set(["me"]),
    });
    expect(out).toEqual([{ id: "c", fullName: "Cường" }]);
  });
});

describe("filterMentionCandidates", () => {
  const people = [
    { id: "1", fullName: "Nguyễn Văn An" },
    { id: "2", fullName: "Đặng Thị Bình" },
    { id: "3", fullName: "Trần Cường" },
  ];

  it("không phân biệt hoa thường và dấu (kể cả đ/Đ)", () => {
    expect(filterMentionCandidates(people, "nguyen").map((p) => p.id)).toEqual(["1"]);
    expect(filterMentionCandidates(people, "dang").map((p) => p.id)).toEqual(["2"]);
    expect(filterMentionCandidates(people, "CƯỜNG").map((p) => p.id)).toEqual(["3"]);
  });

  it("chuỗi rỗng ⇒ tất cả (theo thứ tự), cắt ở trần gợi ý", () => {
    expect(filterMentionCandidates(people, "").map((p) => p.id)).toEqual(["1", "2", "3"]);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), fullName: `Người ${i}` }));
    expect(filterMentionCandidates(many, "")).toHaveLength(MENTION_SUGGESTION_LIMIT);
  });
});
