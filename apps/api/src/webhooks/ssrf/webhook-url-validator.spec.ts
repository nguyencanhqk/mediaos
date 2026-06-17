import { describe, expect, it } from "vitest";
import {
  WebhookSsrfError,
  assertRedirectHopWithinCap,
  isBlockedIp,
  validateWebhookUrl,
  type DnsResolver,
} from "./webhook-url-validator";

/** Resolver giả: trả IP cố định cho mọi hostname (mô phỏng DNS-rebinding khi IP nội bộ). */
function fakeResolver(map: Record<string, string[]>): DnsResolver {
  return async (host: string) => {
    const ips = map[host];
    if (!ips) throw new Error(`fake resolver: no entry for ${host}`);
    return ips;
  };
}

const PUBLIC_RESOLVER = fakeResolver({ "hooks.example.com": ["93.184.216.34"] });

describe("WebhookUrlValidator — scheme + host syntax (KHÔNG chỉ regex)", () => {
  it("REJECT non-https scheme (http/ftp/file)", async () => {
    for (const url of [
      "http://hooks.example.com/in",
      "ftp://hooks.example.com/in",
      "file:///etc/passwd",
    ]) {
      await expect(validateWebhookUrl(url, { resolve: PUBLIC_RESOLVER })).rejects.toBeInstanceOf(
        WebhookSsrfError,
      );
    }
  });

  it("REJECT *.internal và bare hostname không FQDN", async () => {
    await expect(
      validateWebhookUrl("https://service.internal/in", { resolve: PUBLIC_RESOLVER }),
    ).rejects.toBeInstanceOf(WebhookSsrfError);
    await expect(
      validateWebhookUrl("https://intranet/in", { resolve: PUBLIC_RESOLVER }),
    ).rejects.toBeInstanceOf(WebhookSsrfError);
  });

  it("ACCEPT https public host → trả pinnedIp đã validate", async () => {
    const res = await validateWebhookUrl("https://hooks.example.com/in", {
      resolve: PUBLIC_RESOLVER,
    });
    expect(res.host).toBe("hooks.example.com");
    expect(res.pinnedIp).toBe("93.184.216.34");
  });
});

describe("WebhookUrlValidator — IP block list (resolve-then-pin, KHÔNG chỉ regex literal)", () => {
  it("REJECT IP literal RFC1918 (10/172.16/192.168)", () => {
    for (const ip of ["10.0.0.5", "172.16.0.1", "192.168.1.1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it("REJECT 169.254.0.0/16 (cloud metadata 169.254.169.254)", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("169.254.0.1")).toBe(true);
  });

  it("REJECT loopback 127/8 + IPv6 ::1", () => {
    for (const ip of ["127.0.0.1", "127.0.0.5", "::1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it("ACCEPT public IP", () => {
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });
});

describe("WebhookUrlValidator — DNS-rebinding + TOCTOU (resolve-then-pin)", () => {
  it("REJECT hostname phân giải thành IP nội bộ (10.x)", async () => {
    const rebind = fakeResolver({ "evil.example.com": ["10.0.0.5"] });
    await expect(
      validateWebhookUrl("https://evil.example.com/in", { resolve: rebind }),
    ).rejects.toBeInstanceOf(WebhookSsrfError);
  });

  it("REJECT hostname phân giải thành metadata 169.254.169.254", async () => {
    const rebind = fakeResolver({ "metadata.example.com": ["169.254.169.254"] });
    await expect(
      validateWebhookUrl("https://metadata.example.com/in", { resolve: rebind }),
    ).rejects.toBeInstanceOf(WebhookSsrfError);
  });

  it("REJECT khi BẤT KỲ IP nào resolve về nội bộ (multi-A record)", async () => {
    const mixed = fakeResolver({ "mixed.example.com": ["93.184.216.34", "10.0.0.5"] });
    await expect(
      validateWebhookUrl("https://mixed.example.com/in", { resolve: mixed }),
    ).rejects.toBeInstanceOf(WebhookSsrfError);
  });

  it("connect dùng IP ĐÃ PIN (không re-resolve giữa validate và connect)", async () => {
    // pinnedIp trả về = IP đã được validate; caller PHẢI connect chính IP này (chống TOCTOU).
    const res = await validateWebhookUrl("https://hooks.example.com/in", {
      resolve: PUBLIC_RESOLVER,
    });
    expect(res.pinnedIp).toBe("93.184.216.34");
    expect(isBlockedIp(res.pinnedIp)).toBe(false);
  });
});

describe("WebhookUrlValidator — redirect hop re-validate (≤3)", () => {
  it("REJECT redirect Location tới IP nội bộ (re-validate mỗi hop)", async () => {
    const rebind = fakeResolver({ "internal.example.com": ["10.1.2.3"] });
    await expect(
      validateWebhookUrl("https://internal.example.com/cb", { resolve: rebind }),
    ).rejects.toBeInstanceOf(WebhookSsrfError);
  });

  it("REJECT khi vượt cap redirect hop (>3)", () => {
    expect(() => assertRedirectHopWithinCap(4)).toThrow(WebhookSsrfError);
    expect(() => assertRedirectHopWithinCap(3)).not.toThrow();
  });
});
