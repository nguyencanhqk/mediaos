import { describe, expect, it } from "vitest";
import {
  SecurityPolicyEvaluator,
  type PolicyEvaluationConfig,
} from "./security-policy-evaluator";

/**
 * CS-9 LOGIC THUẦN — test cô lập (≥95%). RED-first deny-path: IP in/out CIDR (v4+v6), giờ in/out cửa sổ
 * đa-ngày + wrap nửa đêm, exempt, rỗng-OPEN(ip)/rỗng-CLOSED(time), email-domain reject/allow.
 */

const ev = new SecurityPolicyEvaluator();

const baseConfig: PolicyEvaluationConfig = {
  ipRestrictionEnabled: false,
  allowlistCidrs: [],
  timeRestrictionEnabled: false,
  timeWindows: [],
  exemptUserIds: [],
};

const USER = "11111111-1111-1111-1111-111111111111";
const at = (iso: string) => new Date(iso);

describe("evaluate — không cấu hình gì (default)", () => {
  it("cho qua khi mọi cờ tắt", () => {
    const d = ev.evaluate(baseConfig, { userId: USER, ip: "203.0.113.5", now: at("2026-06-18T10:00:00") });
    expect(d.allowed).toBe(true);
  });
});

describe("evaluate — IP restriction", () => {
  const cfg = { ...baseConfig, ipRestrictionEnabled: true, allowlistCidrs: ["203.0.113.0/24"] };

  it("CHO qua khi IP trong CIDR", () => {
    expect(ev.evaluate(cfg, { userId: USER, ip: "203.0.113.42", now: at("2026-06-18T10:00:00") }).allowed).toBe(true);
  });

  it("CHẶN khi IP ngoài CIDR (reason ip_not_allowed)", () => {
    const d = ev.evaluate(cfg, { userId: USER, ip: "198.51.100.7", now: at("2026-06-18T10:00:00") });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("ip_not_allowed");
  });

  it("CHẶN khi IP thiếu (fail-closed — không cho giấu IP để bỏ qua)", () => {
    const d = ev.evaluate(cfg, { userId: USER, ip: undefined, now: at("2026-06-18T10:00:00") });
    expect(d.allowed).toBe(false);
  });

  it("rỗng-OPEN: enabled + allowlist [] ⇒ coi như TẮT (cho qua)", () => {
    const empty = { ...baseConfig, ipRestrictionEnabled: true, allowlistCidrs: [] };
    expect(ev.evaluate(empty, { userId: USER, ip: "1.2.3.4", now: at("2026-06-18T10:00:00") }).allowed).toBe(true);
  });

  it("khớp nhiều CIDR (any-match)", () => {
    const multi = { ...cfg, allowlistCidrs: ["10.0.0.0/8", "203.0.113.0/24"] };
    expect(ev.evaluate(multi, { userId: USER, ip: "10.255.0.1", now: at("2026-06-18T10:00:00") }).allowed).toBe(true);
  });
});

describe("isIpAllowed — IPv4 CIDR bit-prefix", () => {
  it.each([
    ["192.168.1.130", "192.168.1.128/25", true],
    ["192.168.1.127", "192.168.1.128/25", false],
    ["10.0.0.1", "10.0.0.0/8", true],
    ["11.0.0.1", "10.0.0.0/8", false],
    ["1.2.3.4", "1.2.3.4/32", true],
    ["1.2.3.5", "1.2.3.4/32", false],
    ["8.8.8.8", "0.0.0.0/0", true],
  ])("%s in %s = %s", (ip, cidr, expected) => {
    expect(ev.isIpAllowed(ip, [cidr])).toBe(expected);
  });
});

describe("isIpAllowed — IPv6 + mapped", () => {
  it("IPv6 trong /32", () => {
    expect(ev.isIpAllowed("2001:db8:abcd::1", ["2001:db8::/32"])).toBe(true);
  });
  it("IPv6 ngoài /32", () => {
    expect(ev.isIpAllowed("2001:dead::1", ["2001:db8::/32"])).toBe(false);
  });
  it("IPv4-mapped-IPv6 (::ffff:) khớp CIDR v4", () => {
    expect(ev.isIpAllowed("::ffff:203.0.113.5", ["203.0.113.0/24"])).toBe(true);
  });
  it("khác family không match (v6 IP vs v4 CIDR)", () => {
    expect(ev.isIpAllowed("2001:db8::1", ["203.0.113.0/24"])).toBe(false);
  });
  it("IP rác → false", () => {
    expect(ev.isIpAllowed("not-an-ip", ["203.0.113.0/24"])).toBe(false);
  });
});

describe("evaluate — time window (đa-ngày + wrap)", () => {
  // 2026-06-18 là Thứ Năm (getDay()===4).
  const within = { ...baseConfig, timeRestrictionEnabled: true, timeWindows: [{ day: 4, start: "08:00", end: "17:00" }] };

  it("CHO qua trong cửa sổ T5 08:00-17:00", () => {
    expect(ev.evaluate(within, { userId: USER, now: at("2026-06-18T09:30:00") }).allowed).toBe(true);
  });

  it("CHẶN ngoài cửa sổ (sau 17:00) reason outside_time_window", () => {
    const d = ev.evaluate(within, { userId: USER, now: at("2026-06-18T18:00:00") });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("outside_time_window");
  });

  it("CHẶN sai ngày (cùng giờ, T6 không có cửa sổ)", () => {
    expect(ev.evaluate(within, { userId: USER, now: at("2026-06-19T09:30:00") }).allowed).toBe(false);
  });

  it("biên: start inclusive, end exclusive", () => {
    expect(ev.evaluate(within, { userId: USER, now: at("2026-06-18T08:00:00") }).allowed).toBe(true);
    expect(ev.evaluate(within, { userId: USER, now: at("2026-06-18T17:00:00") }).allowed).toBe(false);
  });

  it("rỗng-CLOSED: enabled + windows [] ⇒ CHẶN", () => {
    const empty = { ...baseConfig, timeRestrictionEnabled: true, timeWindows: [] };
    expect(ev.evaluate(empty, { userId: USER, now: at("2026-06-18T09:30:00") }).allowed).toBe(false);
  });

  it("wrap qua nửa đêm: T5 22:00→02:00, kiểm 23:30 T5 (cho qua)", () => {
    const wrap = { ...baseConfig, timeRestrictionEnabled: true, timeWindows: [{ day: 4, start: "22:00", end: "02:00" }] };
    expect(ev.evaluate(wrap, { userId: USER, now: at("2026-06-18T23:30:00") }).allowed).toBe(true);
  });

  it("wrap qua nửa đêm: phần sáng sớm T6 01:00 (cho qua — thuộc cửa sổ T5 wrap)", () => {
    const wrap = { ...baseConfig, timeRestrictionEnabled: true, timeWindows: [{ day: 4, start: "22:00", end: "02:00" }] };
    expect(ev.evaluate(wrap, { userId: USER, now: at("2026-06-19T01:00:00") }).allowed).toBe(true);
  });

  it("wrap qua nửa đêm: 03:00 T6 ngoài cửa sổ (chặn)", () => {
    const wrap = { ...baseConfig, timeRestrictionEnabled: true, timeWindows: [{ day: 4, start: "22:00", end: "02:00" }] };
    expect(ev.evaluate(wrap, { userId: USER, now: at("2026-06-19T03:00:00") }).allowed).toBe(false);
  });
});

describe("evaluate — exempt user bỏ qua IP + giờ", () => {
  const strict: PolicyEvaluationConfig = {
    ipRestrictionEnabled: true,
    allowlistCidrs: ["203.0.113.0/24"],
    timeRestrictionEnabled: true,
    timeWindows: [{ day: 0, start: "00:00", end: "00:01" }], // gần như không bao giờ khớp
    exemptUserIds: [USER],
  };

  it("exempt user CHO qua dù sai IP VÀ ngoài giờ", () => {
    const d = ev.evaluate(strict, { userId: USER, ip: "198.51.100.1", now: at("2026-06-18T18:00:00") });
    expect(d.allowed).toBe(true);
  });

  it("user KHÁC (không exempt) bị chặn cùng điều kiện", () => {
    const d = ev.evaluate(strict, { userId: "99999999-9999-9999-9999-999999999999", ip: "198.51.100.1", now: at("2026-06-18T18:00:00") });
    expect(d.allowed).toBe(false);
  });
});

describe("isEmailDomainAllowed", () => {
  const cfg = { emailDomainRestrictionEnabled: true, allowedEmailDomains: ["company.com"] };

  it("cho qua khi tắt", () => {
    expect(ev.isEmailDomainAllowed("anyone@evil.com", { emailDomainRestrictionEnabled: false, allowedEmailDomains: ["company.com"] })).toBe(true);
  });
  it("cho qua khi rỗng (chưa cấu hình)", () => {
    expect(ev.isEmailDomainAllowed("anyone@evil.com", { emailDomainRestrictionEnabled: true, allowedEmailDomains: [] })).toBe(true);
  });
  it("CHO qua domain chính khớp", () => {
    expect(ev.isEmailDomainAllowed("alice@company.com", cfg)).toBe(true);
  });
  it("CHO qua subdomain khớp", () => {
    expect(ev.isEmailDomainAllowed("bob@hr.company.com", cfg)).toBe(true);
  });
  it("case-insensitive", () => {
    expect(ev.isEmailDomainAllowed("Carol@Company.COM", cfg)).toBe(true);
  });
  it("CHẶN domain ngoài allowlist", () => {
    expect(ev.isEmailDomainAllowed("dave@evil.com", cfg)).toBe(false);
  });
  it("CHẶN domain trùng-đuôi-giả (notcompany.com)", () => {
    expect(ev.isEmailDomainAllowed("e@notcompany.com", cfg)).toBe(false);
  });
  it("CHẶN email rác không có @", () => {
    expect(ev.isEmailDomainAllowed("garbage", cfg)).toBe(false);
  });
});
