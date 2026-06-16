import { hasCapability } from "./use-can";

describe("hasCapability — wildcard resolution (mirrors web useCan)", () => {
  it("returns false when capabilities are undefined (not yet loaded / logged out)", () => {
    expect(hasCapability(undefined, "read", "task")).toBe(false);
  });

  it("matches an exact action:resourceType key", () => {
    expect(hasCapability({ "read:task": true }, "read", "task")).toBe(true);
  });

  it("denies when the exact key is explicitly false", () => {
    expect(hasCapability({ "read:task": false }, "read", "task")).toBe(false);
  });

  it("falls back to the action wildcard *:resourceType", () => {
    expect(hasCapability({ "*:task": true }, "update", "task")).toBe(true);
  });

  it("falls back to the resource wildcard action:*", () => {
    expect(hasCapability({ "approve:*": true }, "approve", "approval-request")).toBe(true);
  });

  it("falls back to the full wildcard *:*", () => {
    expect(hasCapability({ "*:*": true }, "delete", "anything")).toBe(true);
  });

  it("returns false when no key matches", () => {
    expect(hasCapability({ "read:task": true }, "approve", "approval-request")).toBe(false);
  });
});
