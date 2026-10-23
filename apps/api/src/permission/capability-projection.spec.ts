/**
 * S14-SEC-CAPWILDCARD-1 — #24 ở mức HÀM CHIẾU THUẦN (plan D-v4-5, §15.9-F2): `capability-projection.ts`
 * nhận grants + catalog cặp + now ⇒ caps/scopes, không I/O. Ca đặt ở mức hàm (không chỉ /auth/me) vì
 * `/auth/me` gộp `{...allowlisted, ...caps}` — một cặp đối chứng thuộc allowlist sẽ để đột biến sống.
 *
 * Giết cả hai đột biến: «loại theo RESOURCE» (break-glass) lẫn «loại MỌI sensitive»; và đột biến thu hẹp
 * EXCLUDED về `reveal-secret` / 1 cặp (§9.3 đột biến 12).
 */
import { describe, expect, it } from "vitest";
import { projectCapabilities, projectCapabilityScopes } from "./capability-projection";
import { grant, pair } from "../../test/helpers/capability-stub-repo";

const NOW = new Date("2026-10-23T08:00:00.000Z");

describe("S14-SEC-CAPWILDCARD-1 #24 — hàm chiếu thuần loại mọi action tiền tố reveal-", () => {
  const grants = [
    grant("reveal-break-glass", "break-glass", { isSensitive: true }),
    grant("request-break-glass", "break-glass", { isSensitive: true }),
    grant("reveal-secret", "platform-account", { isSensitive: true }),
  ];
  const catalog = [
    pair("reveal-break-glass", "break-glass", true),
    pair("request-break-glass", "break-glass", true),
    pair("reveal-secret", "platform-account", true),
  ];

  it("caps: reveal-break-glass + reveal-secret VẮNG; request-break-glass (sensitive, ngoài allowlist) CÓ", () => {
    expect(projectCapabilities({ grants, catalog, now: NOW })).toEqual({
      "request-break-glass:break-glass": true,
    });
  });

  it("scopes: cùng keyset với caps", () => {
    expect(projectCapabilityScopes({ grants, catalog, now: NOW })).toEqual({
      "request-break-glass:break-glass": ["Company"],
    });
  });
});
