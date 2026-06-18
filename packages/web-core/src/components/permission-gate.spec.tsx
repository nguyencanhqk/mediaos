// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../stores/auth";
import { PermissionGate } from "./permission-gate";

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

describe("PermissionGate", () => {
  it("renders children when user has the permission", () => {
    setCaps({ "read:project": true });
    render(
      <PermissionGate action="read" resourceType="project">
        <span>Protected content</span>
      </PermissionGate>,
    );
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("renders nothing when user lacks the permission", () => {
    setCaps({});
    render(
      <PermissionGate action="read" resourceType="project">
        <span>Protected content</span>
      </PermissionGate>,
    );
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders fallback when user lacks the permission and fallback is provided", () => {
    setCaps({});
    render(
      <PermissionGate action="read" resourceType="project" fallback={<span>No access</span>}>
        <span>Protected content</span>
      </PermissionGate>,
    );
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("renders children when *:* wildcard grants access", () => {
    setCaps({ "*:*": true });
    render(
      <PermissionGate action="delete" resourceType="post">
        <span>Admin action</span>
      </PermissionGate>,
    );
    expect(screen.getByText("Admin action")).toBeInTheDocument();
  });

  it("renders children when action:* wildcard matches", () => {
    setCaps({ "read:*": true });
    render(
      <PermissionGate action="read" resourceType="video">
        <span>Read video</span>
      </PermissionGate>,
    );
    expect(screen.getByText("Read video")).toBeInTheDocument();
  });

  it("hides children after logout (capabilities cleared)", () => {
    setCaps({ "read:project": true });
    const { rerender } = render(
      <PermissionGate action="read" resourceType="project">
        <span>Protected content</span>
      </PermissionGate>,
    );
    expect(screen.getByText("Protected content")).toBeInTheDocument();

    act(() => {
      useAuthStore.getState().logout();
    });
    rerender(
      <PermissionGate action="read" resourceType="project">
        <span>Protected content</span>
      </PermissionGate>,
    );
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });
});
