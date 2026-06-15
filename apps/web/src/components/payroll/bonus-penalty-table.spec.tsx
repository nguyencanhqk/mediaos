import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type { BonusPenaltyDto } from "@mediaos/contracts";
import { BonusPenaltyTable } from "./bonus-penalty-table";
import { useAuthStore } from "@/stores/auth";

const CURRENT_USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ROW_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function baseRow(overrides: Partial<BonusPenaltyDto> = {}): BonusPenaltyDto {
  return {
    id: ROW_ID,
    companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    userId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    kind: "bonus",
    amount: 500000,
    currency: "VND",
    periodMonth: "2026-06",
    reason: "Hoàn thành tốt",
    source: "manual",
    referenceType: null,
    taskId: null,
    defectId: null,
    kpiResultId: null,
    status: "draft",
    approvedBy: null,
    approvedAt: null,
    payrollPeriodId: null,
    consumedAt: null,
    createdBy: OTHER_USER,
    createdAt: "2026-06-15T08:00:00.000Z",
    updatedAt: "2026-06-15T08:00:00.000Z",
    ...overrides,
  };
}

function renderTable(rows: BonusPenaltyDto[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BonusPenaltyTable rows={rows} currentUserId={CURRENT_USER} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  useAuthStore.setState({ user: null, capabilities: {} });
});

describe("BonusPenaltyTable — self-approve deny-path (mirror BE SoD)", () => {
  it("hides Duyệt/Từ chối when the current user created the draft row", () => {
    // Approver capability present, but createdBy === currentUser ⇒ self-approve blocked in UI.
    useAuthStore.setState({ capabilities: { "approve-bonus-penalty:bonus_penalty": true } });
    renderTable([baseRow({ status: "draft", createdBy: CURRENT_USER })]);
    expect(screen.queryByRole("button", { name: /Duyệt|Từ chối/ })).toBeNull();
  });

  it("shows Duyệt/Từ chối when another user created the draft and the viewer can approve", () => {
    useAuthStore.setState({ capabilities: { "approve-bonus-penalty:bonus_penalty": true } });
    renderTable([baseRow({ status: "draft", createdBy: OTHER_USER })]);
    expect(screen.getByRole("button", { name: /Duyệt/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Từ chối/ })).toBeInTheDocument();
  });

  it("hides Duyệt/Từ chối for non-draft rows even with approver perm", () => {
    useAuthStore.setState({ capabilities: { "approve-bonus-penalty:bonus_penalty": true } });
    renderTable([baseRow({ status: "approved", createdBy: OTHER_USER })]);
    expect(screen.queryByRole("button", { name: /Duyệt|Từ chối/ })).toBeNull();
  });

  it("hides Duyệt/Từ chối when the viewer lacks approve capability", () => {
    useAuthStore.setState({ capabilities: {} });
    renderTable([baseRow({ status: "draft", createdBy: OTHER_USER })]);
    expect(screen.queryByRole("button", { name: /Duyệt|Từ chối/ })).toBeNull();
  });
});

describe("BonusPenaltyTable — no view perm / empty / amount display", () => {
  it("renders an empty-state when there are no rows (server gated 403 → page handles; table just shows empty)", () => {
    renderTable([]);
    expect(screen.getByText(/Chưa có khoản thưởng\/phạt/)).toBeInTheDocument();
  });

  it("renders the amount as currency for a server-returned row (no client unmask branch)", () => {
    renderTable([baseRow({ amount: 500000 })]);
    expect(screen.getByText(/500\.000\s*VND/)).toBeInTheDocument();
  });
});
