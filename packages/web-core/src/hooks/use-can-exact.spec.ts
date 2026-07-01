// @vitest-environment jsdom
/**
 * [crown-deny-path] useCanExact — fail-closed exact-match permission check.
 *
 * S3-FE-ATT-2: useCanExact(action, resourceType) khớp CHÍNH XÁC
 * caps[`${action}:${resourceType}`] === true — KHÔNG wildcard fallback.
 *
 * Test cốt lõi: caps={'*:*':true} → useCanExact('view-team','attendance') = FALSE
 * trong khi useCan(...)=TRUE — chứng minh fail-closed khác biệt cốt lõi so với useCan.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthStore } from "../stores/auth";
import { useCanExact } from "./use-can";
import { useCan } from "./use-can";

function setCaps(caps: Record<string, boolean>) {
  act(() => {
    useAuthStore.setState({ capabilities: caps });
  });
}

describe("useCanExact — exact-match fail-closed", () => {
  beforeEach(() => {
    act(() => {
      useAuthStore.setState({ capabilities: {} });
    });
  });

  // ── CROWN: fail-closed proof ──────────────────────────────────────────────────

  it("[crown] caps={'*:*':true} → useCanExact=FALSE, useCan=TRUE (wildcard gap)", () => {
    setCaps({ "*:*": true });
    const { result: exactResult } = renderHook(() => useCanExact("view-team", "attendance"));
    const { result: canResult } = renderHook(() => useCan("view-team", "attendance"));
    expect(exactResult.current).toBe(false); // fail-closed: exact key absent → false
    expect(canResult.current).toBe(true); // wildcard fallback
  });

  // ── Exact match → true ────────────────────────────────────────────────────────

  it("exact key present and true → true", () => {
    setCaps({ "view-team:attendance": true });
    const { result } = renderHook(() => useCanExact("view-team", "attendance"));
    expect(result.current).toBe(true);
  });

  it("exact key present and false → false (explicit deny)", () => {
    setCaps({ "view-team:attendance": false });
    const { result } = renderHook(() => useCanExact("view-team", "attendance"));
    expect(result.current).toBe(false);
  });

  // ── Fail-closed: wildcard variants must NOT satisfy useCanExact ───────────────

  it("action wildcard (*:attendance present) → false (no exact match)", () => {
    setCaps({ "*:attendance": true });
    const { result } = renderHook(() => useCanExact("view-team", "attendance"));
    expect(result.current).toBe(false);
  });

  it("resource wildcard (view-team:* present) → false (no exact match)", () => {
    setCaps({ "view-team:*": true });
    const { result } = renderHook(() => useCanExact("view-team", "attendance"));
    expect(result.current).toBe(false);
  });

  it("empty capabilities → false", () => {
    setCaps({});
    const { result } = renderHook(() => useCanExact("view-own", "attendance"));
    expect(result.current).toBe(false);
  });

  // ── Multiple caps: exact wins among others ────────────────────────────────────

  it("multiple caps including exact key → true for the exact pair", () => {
    setCaps({
      "view-own:attendance": true,
      "view-team:attendance": true,
      "view-company:attendance": false,
    });
    const { result: own } = renderHook(() => useCanExact("view-own", "attendance"));
    const { result: team } = renderHook(() => useCanExact("view-team", "attendance"));
    const { result: company } = renderHook(() => useCanExact("view-company", "attendance"));
    expect(own.current).toBe(true);
    expect(team.current).toBe(true);
    expect(company.current).toBe(false);
  });

  // ── Different resource type: no cross-contamination ───────────────────────────

  it("caps for leave resource do not affect attendance exact check", () => {
    setCaps({ "view-team:leave": true });
    const { result } = renderHook(() => useCanExact("view-team", "attendance"));
    expect(result.current).toBe(false);
  });
});
