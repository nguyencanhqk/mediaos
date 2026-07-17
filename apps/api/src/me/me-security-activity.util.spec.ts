import { describe, expect, it } from "vitest";
import { maskIp, summarizeUserAgent } from "./me-security-activity.util";

/**
 * S5-ME-BE-3 — unit spec (RED-trước) cho util thuần mask IP + rút gọn UA (SPEC-09 §10.6/§17).
 * Nguyên tắc fail-closed: không parse được → null (thà mất hiển thị còn hơn lộ raw).
 */

describe("maskIp", () => {
  it("IPv4 → giữ 2 octet đầu, mask phần còn lại", () => {
    expect(maskIp("203.0.113.77")).toBe("203.0.*.*");
    expect(maskIp("10.9.1.1")).toBe("10.9.*.*");
  });

  it("IPv6 → giữ 2 hextet đầu, mask phần còn lại", () => {
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8::*");
  });

  it("IPv6 dạng ::ffff (IPv4-mapped, supertest localhost) → KHÔNG lộ IPv4 nhúng", () => {
    const masked = maskIp("::ffff:127.0.0.1");
    expect(masked).not.toBeNull();
    expect(masked).not.toContain("127.0.0.1");
  });

  it("null / rỗng / không parse được → null (fail-closed, KHÔNG trả nguyên trạng)", () => {
    expect(maskIp(null)).toBeNull();
    expect(maskIp("")).toBeNull();
    expect(maskIp("not-an-ip")).toBeNull();
  });

  it("KHÔNG BAO GIỜ trả về đúng chuỗi input (chống lộ raw do nhánh sót)", () => {
    for (const ip of ["203.0.113.77", "2001:db8::1", "::ffff:10.0.0.9"]) {
      expect(maskIp(ip)).not.toBe(ip);
    }
  });
});

describe("summarizeUserAgent", () => {
  const CHROME_WIN =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const EDGE_WIN =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
  const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
  const SAFARI_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
  const SAFARI_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const CHROME_ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

  it("nhận diện browser-family + OS phổ biến", () => {
    expect(summarizeUserAgent(CHROME_WIN)).toBe("Chrome trên Windows");
    expect(summarizeUserAgent(EDGE_WIN)).toBe("Edge trên Windows"); // Edg/ phải thắng Chrome
    expect(summarizeUserAgent(FIREFOX_LINUX)).toBe("Firefox trên Linux");
    expect(summarizeUserAgent(SAFARI_MAC)).toBe("Safari trên macOS"); // Safari không dính Chrome
    expect(summarizeUserAgent(SAFARI_IPHONE)).toBe("Safari trên iOS");
    expect(summarizeUserAgent(CHROME_ANDROID)).toBe("Chrome trên Android");
  });

  it("UA lạ → null, TUYỆT ĐỐI không trả fragment raw (chống fingerprint leak — plan-review M3)", () => {
    const weird = "XYZBUILD/9.9.9 (SecretDevice; rooted)";
    const out = summarizeUserAgent(weird);
    expect(out).toBeNull();
  });

  it("null / rỗng → null", () => {
    expect(summarizeUserAgent(null)).toBeNull();
    expect(summarizeUserAgent("")).toBeNull();
  });

  it("output là nhãn cố định từ allowlist — không bao giờ chứa chuỗi con của input tự do", () => {
    const marker = "EVIL-MARKER-123 Chrome/1.0 Windows";
    const out = summarizeUserAgent(marker);
    if (out !== null) expect(out).not.toContain("EVIL-MARKER-123");
  });
});
