import { describe, expect, it } from "vitest";
import { APP_REGISTRY, type AppRegistryItem } from "@mediaos/web-core";
import { CROSS_DOMAIN_APP_OPENERS, getCrossDomainOpener, isCurrentApp } from "./cross-domain-apps";

/**
 * S16-SOCIAL-FBPOST-1 — hai lỗi THẬT của master mà bộ test cũ không bắt được, cả hai cùng một gốc:
 * `S16-SOCIAL-FE-1` cho hai ô dùng chung `moduleCode: "SOCIAL"` và ĐỔI NGHĨA `appKey: "social"`.
 *
 * Đo ở tầng dữ liệu/vị từ thuần, KHÔNG đếm chuỗi trong component: ai đó lỡ đổi khoá về `"social"` hay
 * quay lại so sánh theo `moduleCode` là các ca dưới ĐỎ.
 */

function app(appKey: string): AppRegistryItem {
  const found = APP_REGISTRY.find((a) => a.appKey === appKey);
  if (!found) throw new Error(`APP_REGISTRY thiếu ô '${appKey}' — fixture sai, đừng sửa assert`);
  return found;
}

describe("S16-SOCIAL-FBPOST-1 — map app CROSS-DOMAIN", () => {
  it("đúng 2 app cross-domain: `lms` + `fbpost`", () => {
    expect(Object.keys(CROSS_DOMAIN_APP_OPENERS).sort()).toEqual(["fbpost", "lms"]);
  });

  it("🔴 `social` (cổng thông tin nội bộ /feed) KHÔNG phải cross-domain — bấm nó phải điều hướng nội bộ", () => {
    // Nhánh cũ `if (app.appKey === "social")` đẩy người bấm «Mạng xã hội» ra thẳng ứng dụng Facebook.
    expect(getCrossDomainOpener("social")).toBeUndefined();
  });

  it("`fbpost` CÓ opener (vào thẳng qua SSO, không qua trang trung chuyển /social)", () => {
    expect(getCrossDomainOpener("fbpost")).toBeTypeOf("function");
  });

  it("mọi khoá của map đều là `appKey` CÓ THẬT trong APP_REGISTRY (chống khoá chết sau khi đổi tên ô)", () => {
    const keys = Object.keys(CROSS_DOMAIN_APP_OPENERS);
    const known = APP_REGISTRY.map((a) => a.appKey);
    expect(keys.filter((k) => !known.includes(k))).toEqual([]);
  });
});

describe("S16-SOCIAL-FBPOST-1 — isCurrentApp (badge «Đang mở» + nhánh bấm-không-làm-gì)", () => {
  it("🔴 đang ở /feed (module SOCIAL) thì ô `fbpost` KHÔNG phải app đang mở ⇒ vẫn bấm được", () => {
    // Lỗi cũ: so theo moduleCode ⇒ fbpost bị coi là "đang mở" ⇒ handleSelect chỉ đóng overlay = bấm chết.
    expect(isCurrentApp(app("fbpost"), "SOCIAL")).toBe(false);
  });

  it("ô cổng thông tin `social` khi đang ở module SOCIAL ⇒ ĐÚNG là app đang mở", () => {
    expect(isCurrentApp(app("social"), "SOCIAL")).toBe(true);
  });

  it("`lms` cũng cross-domain ⇒ không bao giờ là app đang mở", () => {
    expect(isCurrentApp(app("lms"), "LMS")).toBe(false);
  });

  it("app nội bộ thường: khớp module ⇒ true, khác module ⇒ false", () => {
    expect(isCurrentApp(app("hr"), "HR")).toBe(true);
    expect(isCurrentApp(app("hr"), "SOCIAL")).toBe(false);
  });

  it("chưa ở module nào (undefined) ⇒ không app nào là đang mở", () => {
    expect(isCurrentApp(app("hr"), undefined)).toBe(false);
  });
});
