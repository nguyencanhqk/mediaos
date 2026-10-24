/**
 * S20-GOAL-DECOMPOSE-1 — `?returnTo=` của /goals/templates chỉ nhận đường dẫn NỘI BỘ. Bảng ca: mỗi
 * dòng bị từ chối là một dạng đường dẫn mà trình duyệt/router có thể hiểu thành đích NGOÀI ứng dụng.
 */
import { describe, expect, it } from "vitest";
import {
  RETURN_TO_MAX_LENGTH,
  sanitizeReturnTo,
  validateTaskTemplateListSearch,
} from "./template-return-to";

describe("sanitizeReturnTo", () => {
  it.each([
    ["/goals/templates"],
    ["/goals/g-1?decompose=resume"],
    ["/goals/g-1?tab=children&decompose=resume"],
    ["/goals/g-1#tasks"],
    ["/"],
    ["/goals/T%E1%BA%BFt"],
  ])("nhận đường dẫn nội bộ %s nguyên văn", (value) => {
    expect(sanitizeReturnTo(value)).toBe(value);
  });

  it.each([
    ["undefined", undefined],
    ["số", 42],
    ["object", { to: "/goals" }],
    ["chuỗi rỗng", ""],
    ["không bắt đầu bằng /", "goals/templates"],
    ["protocol-relative //", "//example.org/x"],
    ["/\\ (trình duyệt coi \\ như /)", "/\\example.org"],
    ["\\\\ đầu chuỗi", "\\\\example.org"],
    ["// giữa đường dẫn", "/goals//example.org"],
    ["scheme https", "https://example.org"],
    ["scheme javascript", "javascript:void(0)"],
    ["scheme data", "data:text/html,x"],
    ["%5C sau giải mã", "/%5Cexample.org"],
    ["%2F%2F sau giải mã", "/%2F%2Fexample.org"],
    ["%2F ghép thành // sau giải mã", "/%2Fexample.org"],
    ["mã kép %252F%252F", "/%252F%252Fexample.org"],
    ["mã lồng quá sâu", "/%25252525"],
    ["giải mã hỏng", "/goals/%E0%A4%A"],
    ["tab (trình duyệt bỏ ⇒ //)", "/\t/example.org"],
    ["xuống dòng", "/\n/example.org"],
    ["%09 sau giải mã", "/%09/example.org"],
    ["khoảng trắng", "/goals/ templates"],
    ["dài quá trần", `/${"a".repeat(RETURN_TO_MAX_LENGTH)}`],
  ])("bỏ %s", (_label, value) => {
    expect(sanitizeReturnTo(value)).toBeNull();
  });
});

describe("validateTaskTemplateListSearch", () => {
  it("giữ returnTo hợp lệ", () => {
    expect(validateTaskTemplateListSearch({ returnTo: "/goals/g-1?decompose=resume" })).toEqual({
      returnTo: "/goals/g-1?decompose=resume",
    });
  });

  it("returnTo sai hoặc vắng ⇒ ghi đè bằng undefined (router trộn search thô), không ném", () => {
    for (const raw of [{ returnTo: "//example.org" }, {}, { other: "x" }]) {
      const out = validateTaskTemplateListSearch(raw);
      expect("returnTo" in out).toBe(true);
      expect(out.returnTo).toBeUndefined();
      // Mô phỏng đúng phép trộn của router: khoá thô KHÔNG được sống sót.
      expect({ ...raw, ...out }.returnTo).toBeUndefined();
    }
  });
});
