import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/stores/auth";
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
    const { result } = renderHook(() => useCan("read", "platform-company"));
    expect(result.current).toBe(false);
  });

  it("returns true for exact matching capability", () => {
    setCaps({ "read:platform-company": true });
    const { result } = renderHook(() => useCan("read", "platform-company"));
    expect(result.current).toBe(true);
  });

  it("returns true when action wildcard *:resourceType matches", () => {
    setCaps({ "*:platform-company": true });
    const { result } = renderHook(() => useCan("read", "platform-company"));
    expect(result.current).toBe(true);
  });

  it("returns true when resource wildcard action:* matches", () => {
    setCaps({ "read:*": true });
    const { result } = renderHook(() => useCan("read", "platform-company"));
    expect(result.current).toBe(true);
  });

  it("returns true when full wildcard *:* matches", () => {
    setCaps({ "*:*": true });
    const { result } = renderHook(() => useCan("read", "platform-company"));
    expect(result.current).toBe(true);
  });

  it("exact match takes priority over wildcard", () => {
    setCaps({ "read:platform-company": true, "*:*": false });
    const { result } = renderHook(() => useCan("read", "platform-company"));
    expect(result.current).toBe(true);
  });

  it("returns false when no key matches", () => {
    setCaps({ "edit:post": true, "delete:post": true });
    const { result } = renderHook(() => useCan("read", "platform-company"));
    expect(result.current).toBe(false);
  });

  it("re-renders with false after store is cleared", () => {
    setCaps({ "read:platform-company": true });
    const { result } = renderHook(() => useCan("read", "platform-company"));
    expect(result.current).toBe(true);

    act(() => {
      useAuthStore.setState({ capabilities: {} });
    });
    expect(result.current).toBe(false);
  });
});
