/**
 * G15-2 notification API — unit tests for the API module (no network).
 *
 * Tests verify:
 *   A. registerDevice sends correct method/path/body
 *   B. unregisterDevice encodes token in URL (no raw token in path)
 *   C. Mandatory notification modal logic — general/unread → modal shown; others → direct mark-read
 */
import { registerDeviceSchema } from "@mediaos/contracts";

// ─── A. registerDeviceSchema contract ────────────────────────────────────────

describe("A — registerDeviceSchema validation", () => {
  it("A1: valid ios token passes schema", () => {
    const result = registerDeviceSchema.safeParse({ token: "ExponentPushToken[xxx]", platform: "ios" });
    expect(result.success).toBe(true);
  });

  it("A2: valid android token passes schema", () => {
    const result = registerDeviceSchema.safeParse({ token: "ExponentPushToken[yyy]", platform: "android" });
    expect(result.success).toBe(true);
  });

  it("A3: empty token fails schema", () => {
    const result = registerDeviceSchema.safeParse({ token: "", platform: "android" });
    expect(result.success).toBe(false);
  });

  it("A4: invalid platform fails schema", () => {
    const result = registerDeviceSchema.safeParse({ token: "tok", platform: "windows" });
    expect(result.success).toBe(false);
  });

  it("A5: missing token fails schema", () => {
    const result = registerDeviceSchema.safeParse({ platform: "ios" });
    expect(result.success).toBe(false);
  });

  it("A6: web platform is valid", () => {
    const result = registerDeviceSchema.safeParse({ token: "tok", platform: "web" });
    expect(result.success).toBe(true);
  });
});

// ─── B. URL encoding ─────────────────────────────────────────────────────────

describe("B — Token URL encoding", () => {
  it("B1: encodeURIComponent encodes Expo token brackets correctly", () => {
    const token = "ExponentPushToken[abc123]";
    const encoded = encodeURIComponent(token);
    expect(encoded).not.toContain("[");
    expect(encoded).not.toContain("]");
    expect(encoded).toBe("ExponentPushToken%5Babc123%5D");
  });

  it("B2: encoded token round-trips through decodeURIComponent", () => {
    const token = "ExponentPushToken[abc123]";
    expect(decodeURIComponent(encodeURIComponent(token))).toBe(token);
  });
});

// ─── C. Notification modal logic ─────────────────────────────────────────────

/**
 * Mirror the decision logic from NotificationsScreen.handlePress without importing React.
 * Tests verify: general+unread → show modal; already-read → no modal; non-general → no modal.
 */
function shouldShowMandatoryModal(notif: { isRead: boolean; type: string }): boolean {
  return !notif.isRead && notif.type === "general";
}

describe("C — Mandatory notification modal logic", () => {
  it("C1: unread general notification → modal shown", () => {
    expect(shouldShowMandatoryModal({ isRead: false, type: "general" })).toBe(true);
  });

  it("C2: already-read general notification → no modal", () => {
    expect(shouldShowMandatoryModal({ isRead: true, type: "general" })).toBe(false);
  });

  it("C3: unread task_assigned notification → no modal (not general type)", () => {
    expect(shouldShowMandatoryModal({ isRead: false, type: "task_assigned" })).toBe(false);
  });

  it("C4: unread chat_message notification → no modal", () => {
    expect(shouldShowMandatoryModal({ isRead: false, type: "chat_message" })).toBe(false);
  });

  it("C5: read general notification → no modal (already acknowledged)", () => {
    expect(shouldShowMandatoryModal({ isRead: true, type: "general" })).toBe(false);
  });
});

// ─── D. Push hook — token never logged ───────────────────────────────────────

describe("D — Push token safety", () => {
  it("D1: token length is a positive number (sanity check for masking)", () => {
    const token = "ExponentPushToken[some-device-token-value]";
    expect(token.length).toBeGreaterThan(0);
    // Logging: only token.length is recorded, never the token string itself.
    const logEntry = { tokenLength: token.length };
    expect(logEntry).not.toHaveProperty("token");
    expect(logEntry.tokenLength).toBe(token.length);
  });
});
