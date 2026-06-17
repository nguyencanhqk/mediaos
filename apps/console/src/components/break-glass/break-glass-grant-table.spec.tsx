import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BreakGlassGrantDto } from "@mediaos/contracts";
import { BreakGlassGrantTable } from "./break-glass-grant-table";

const UUID = "11111111-1111-1111-1111-111111111111";
const ACCT = "22222222-2222-2222-2222-222222222222";

function grant(overrides: Partial<BreakGlassGrantDto>): BreakGlassGrantDto {
  return {
    id: UUID,
    platformAccountId: ACCT,
    requesterUserId: UUID,
    reason: "incident #42",
    requiredApprovals: 2,
    approvalCount: 2,
    status: "active",
    expiresAt: new Date(Date.now() + 3_600_000),
    activatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function renderTable(g: BreakGlassGrantDto, onRequestReveal = vi.fn(async () => "pw")) {
  render(<BreakGlassGrantTable grants={[g]} onRequestReveal={onRequestReveal} />);
}

afterEach(() => vi.restoreAllMocks());

describe("BreakGlassGrantTable — reveal gated to active grants", () => {
  it("renders grant metadata without exposing any plaintext by default", () => {
    renderTable(grant({}));
    expect(screen.getByText("incident #42")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    // No plaintext is shown until the user explicitly reveals.
    expect(screen.queryByTestId("secret-plaintext")).not.toBeInTheDocument();
  });

  it("shows the Reveal control for an ACTIVE, non-expired grant", () => {
    renderTable(grant({ status: "active" }));
    expect(screen.getByTestId("secret-field")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hiện/i })).toBeInTheDocument();
    expect(screen.queryByTestId("reveal-unavailable")).not.toBeInTheDocument();
  });

  it("hides the Reveal control for a PENDING grant (not yet approved)", () => {
    renderTable(grant({ status: "pending", approvalCount: 1 }));
    expect(screen.queryByTestId("secret-field")).not.toBeInTheDocument();
    expect(screen.getByTestId("reveal-unavailable")).toBeInTheDocument();
  });

  it("hides the Reveal control for a REVOKED grant", () => {
    renderTable(grant({ status: "revoked" }));
    expect(screen.queryByTestId("secret-field")).not.toBeInTheDocument();
    expect(screen.getByTestId("reveal-unavailable")).toBeInTheDocument();
  });

  it("hides the Reveal control for an ACTIVE but EXPIRED grant (TTL passed)", () => {
    renderTable(grant({ status: "active", expiresAt: new Date(Date.now() - 1_000) }));
    expect(screen.queryByTestId("secret-field")).not.toBeInTheDocument();
    expect(screen.getByTestId("reveal-unavailable")).toBeInTheDocument();
  });
});
