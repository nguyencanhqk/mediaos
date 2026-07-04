/**
 * S2-FND-FILE-2 — mime-extension đối chiếu (PURE). Chống MIME-spoof lúc register-upload.
 */
import { describe, expect, it } from "vitest";
import { isExtensionConsistentWithMime } from "./mime-extension";

describe("isExtensionConsistentWithMime", () => {
  it.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["pdf", "application/pdf"],
    ["csv", "text/csv"],
    ["txt", "text/plain"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ])("extension %j matches MIME %j → true", (ext, mime) => {
    expect(isExtensionConsistentWithMime(ext, mime)).toBe(true);
  });

  it("uppercase extension normalized (PNG ~ image/png)", () => {
    expect(isExtensionConsistentWithMime("PNG", "image/png")).toBe(true);
  });

  it.each([
    ["pdf", "image/png"], // report.pdf declared as png (spoof)
    ["html", "application/pdf"], // x.html declared as pdf (spoof)
    ["png", "application/pdf"],
    ["exe", "image/png"],
  ])("extension %j does NOT match MIME %j → false (spoof)", (ext, mime) => {
    expect(isExtensionConsistentWithMime(ext, mime)).toBe(false);
  });

  it("null extension → true (nothing to spoof; blocklist/allowlist gate elsewhere)", () => {
    expect(isExtensionConsistentWithMime(null, "image/png")).toBe(true);
  });

  it("MIME outside the map → true (lenient; not enough knowledge to reject)", () => {
    expect(isExtensionConsistentWithMime("bin", "application/octet-stream")).toBe(true);
  });
});
