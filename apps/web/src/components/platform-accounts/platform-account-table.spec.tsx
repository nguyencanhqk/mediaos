import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SafePlatformAccountDto } from "@mediaos/contracts";
import { useAuthStore } from "@/stores/auth";
import { PlatformAccountTable } from "./platform-account-table";

const UUID = "11111111-1111-1111-1111-111111111111";
const ACCOUNT: SafePlatformAccountDto = {
  id: UUID,
  companyId: UUID,
  platformId: UUID,
  accountName: "Kênh chính",
  accountEmail: "ops@example.com",
  accountIdentifier: "@kenh-chinh",
  ownerUserId: UUID,
  securityLevel: "high",
  status: "active",
  lastRotatedAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

function setCaps(caps: Record<string, boolean>) {
  act(() => useAuthStore.setState({ capabilities: caps }));
}

afterEach(() => {
  setCaps({});
  vi.restoreAllMocks();
});

function renderTable() {
  render(
    <PlatformAccountTable
      accounts={[ACCOUNT]}
      platformName={() => "YouTube"}
      onRequestReveal={vi.fn(async () => "pw")}
      onEditSecret={vi.fn()}
    />,
  );
}

describe("PlatformAccountTable — masking + gating", () => {
  it("renders the masked row without exposing any secret value", () => {
    setCaps({});
    renderTable();
    expect(screen.getByText("Kênh chính")).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    // Không có plaintext nào hiển thị mặc định.
    expect(screen.queryByTestId("secret-plaintext")).not.toBeInTheDocument();
  });

  it("hides the reveal button when the user lacks reveal-secret", () => {
    setCaps({});
    renderTable();
    expect(screen.queryByRole("button", { name: /hiện/i })).not.toBeInTheDocument();
  });

  it("shows the reveal button when the user has reveal-secret", () => {
    setCaps({ "reveal-secret:platform-account": true });
    renderTable();
    expect(screen.getByRole("button", { name: /hiện/i })).toBeInTheDocument();
  });

  it("hides the edit-secret action without edit-platform-account", () => {
    setCaps({ "reveal-secret:platform-account": true });
    renderTable();
    expect(screen.queryByRole("button", { name: /đổi secret/i })).not.toBeInTheDocument();
  });

  it("shows the edit-secret action with edit-platform-account", () => {
    setCaps({ "edit-platform-account:platform-account": true });
    renderTable();
    expect(screen.getByRole("button", { name: /đổi secret/i })).toBeInTheDocument();
  });
});
