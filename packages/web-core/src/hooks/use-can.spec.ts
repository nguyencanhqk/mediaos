// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../stores/auth";
import { useCan } from "./use-can";

function setCaps(caps: Record<string, boolean>) {
  act(() => {
    useAuthStore.setState({ capabilities: caps });
  });
}

afterEach(() => {
  act(() => {
    useAuthStore.setState({ capabilities: {} });
  });
});

describe("useCan", () => {
  it("returns false when capabilities map is empty", () => {
    setCaps({});
    const { result } = renderHook(() => useCan("read", "project"));
    expect(result.current).toBe(false);
  });

  it("returns true for exact matching capability", () => {
    setCaps({ "read:project": true });
    const { result } = renderHook(() => useCan("read", "project"));
    expect(result.current).toBe(true);
  });

  it("returns true when action wildcard *:resourceType matches", () => {
    setCaps({ "*:project": true });
    const { result } = renderHook(() => useCan("read", "project"));
    expect(result.current).toBe(true);
  });

  it("returns true when resource wildcard action:* matches", () => {
    setCaps({ "read:*": true });
    const { result } = renderHook(() => useCan("read", "project"));
    expect(result.current).toBe(true);
  });

  it("returns true when full wildcard *:* matches", () => {
    setCaps({ "*:*": true });
    const { result } = renderHook(() => useCan("read", "project"));
    expect(result.current).toBe(true);
  });

  it("exact match takes priority (exact true, wildcard false value is irrelevant)", () => {
    setCaps({ "read:project": true, "*:*": false });
    const { result } = renderHook(() => useCan("read", "project"));
    expect(result.current).toBe(true);
  });

  it("returns false when no key matches", () => {
    setCaps({ "edit:post": true, "delete:post": true });
    const { result } = renderHook(() => useCan("read", "project"));
    expect(result.current).toBe(false);
  });

  it("re-renders with false after store is cleared", () => {
    setCaps({ "read:project": true });
    const { result } = renderHook(() => useCan("read", "project"));
    expect(result.current).toBe(true);

    act(() => {
      useAuthStore.setState({ capabilities: {} });
    });
    expect(result.current).toBe(false);
  });
});
