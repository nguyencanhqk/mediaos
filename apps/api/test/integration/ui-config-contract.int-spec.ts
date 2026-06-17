/**
 * AC-4 contract — Zod brandingSchema / uiNavigationItemSchema / i18nOverrideSchema parse hợp lệ + reject
 * input rác tại boundary (KHÔNG cần DB). Nguồn sự thật @mediaos/contracts.
 */

import { describe, expect, it } from "vitest";
import {
  i18nOverrideSchema,
  putI18nOverridesRequestSchema,
  putUiNavigationRequestSchema,
  uiNavigationItemSchema,
  updateBrandingRequestSchema,
} from "@mediaos/contracts";

describe("AC-4 ui-config contracts", () => {
  it("updateBrandingRequest: chấp nhận màu hex hợp lệ", () => {
    const r = updateBrandingRequestSchema.safeParse({ primaryColor: "#1a2b3c", logoUrl: "https://x.test/l.png" });
    expect(r.success).toBe(true);
  });

  it("updateBrandingRequest: reject màu KHÔNG hex", () => {
    const r = updateBrandingRequestSchema.safeParse({ primaryColor: "red" });
    expect(r.success).toBe(false);
  });

  it("updateBrandingRequest: reject logoUrl không phải URL", () => {
    const r = updateBrandingRequestSchema.safeParse({ logoUrl: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("updateBrandingRequest: reject field lạ (strict)", () => {
    const r = updateBrandingRequestSchema.safeParse({ evil: "x" });
    expect(r.success).toBe(false);
  });

  it("uiNavigationItem: parse item hợp lệ với moduleKey null", () => {
    const r = uiNavigationItemSchema.safeParse({
      key: "home",
      label: "Home",
      route: "/",
      icon: null,
      parentKey: null,
      displayOrder: 0,
      moduleKey: null,
      isVisible: true,
    });
    expect(r.success).toBe(true);
  });

  it("uiNavigationItem: reject key rỗng", () => {
    const r = uiNavigationItemSchema.safeParse({
      key: "",
      label: "X",
      route: "/",
      icon: null,
      parentKey: null,
      displayOrder: 0,
      moduleKey: null,
      isVisible: true,
    });
    expect(r.success).toBe(false);
  });

  it("putUiNavigation: reject key trùng trong danh sách", () => {
    const item = {
      key: "dup",
      label: "X",
      route: "/",
      icon: null,
      parentKey: null,
      displayOrder: 0,
      moduleKey: null,
      isVisible: true,
    };
    const r = putUiNavigationRequestSchema.safeParse({ items: [item, { ...item, route: "/y" }] });
    expect(r.success).toBe(false);
  });

  it("i18nOverride: reject locale rỗng", () => {
    const r = i18nOverrideSchema.safeParse({ locale: "", namespace: "common", key: "k", value: "v" });
    expect(r.success).toBe(false);
  });

  it("i18nOverride: reject key rỗng", () => {
    const r = i18nOverrideSchema.safeParse({ locale: "vi", namespace: "common", key: "", value: "v" });
    expect(r.success).toBe(false);
  });

  it("putI18nOverrides: reject bộ khoá (locale,namespace,key) trùng", () => {
    const o = { locale: "vi", namespace: "common", key: "greet", value: "a" };
    const r = putI18nOverridesRequestSchema.safeParse({ overrides: [o, { ...o, value: "b" }] });
    expect(r.success).toBe(false);
  });

  it("putI18nOverrides: chấp nhận bộ khoá khác nhau", () => {
    const r = putI18nOverridesRequestSchema.safeParse({
      overrides: [
        { locale: "vi", namespace: "common", key: "a", value: "1" },
        { locale: "vi", namespace: "common", key: "b", value: "2" },
      ],
    });
    expect(r.success).toBe(true);
  });
});
