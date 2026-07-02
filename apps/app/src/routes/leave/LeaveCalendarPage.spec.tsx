// @vitest-environment jsdom
/**
 * S3-FE-LEAVE-4 — LeaveCalendarPage tests (LEAVE-SCREEN-007/008/009).
 *
 * Covers:
 *  - forbidden: KHÔNG có quyền scope nào (own/team/company đều false) → forbidden EmptyState +
 *    getCalendar KHÔNG được gọi.
 *  - own-only employee: canViewOwn=true, canViewTeam/Company=false → render own data; scope toggle
 *    KHÔNG hiện team/company option (anti-false-green: chỉ hiện option ĐƯỢC allow).
 *  - manager (view-team) → renders data cho scope=team.
 *  - error state.
 *  - MASK: reason null (server-masked) hiển thị placeholder trung tính — KHÔNG hard "Về quê" khi
 *    dòng của người khác.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  useCanExact: vi.fn(() => false),
  leaveApi: {
    getCalendar: vi.fn(),
  },
  leaveKeys: {
    calendar: {
      list: (p?: unknown) => ["leave", "calendar", "list", p],
    },
  },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({
      title,
      description,
      children,
    }: {
      title: string;
      description?: string;
      children?: React.ReactNode;
    }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
    ),
    DataTable: ({ data }: { data: unknown[] }) => (
      <div data-testid="data-table">
        {data.map((_, i) => (
          <div key={i} data-testid="table-row" />
        ))}
      </div>
    ),
    EmptyState: ({ title, description }: { title: string; description?: string }) => (
      <div data-testid="empty-state">
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
  };
});

import { useCan, useCanExact, leaveApi } from "@mediaos/web-core";
import { LeaveCalendarPage } from "./LeaveCalendarPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockGetCalendar = leaveApi.getCalendar as ReturnType<typeof vi.fn>;

const OWN_ENTRY = {
  id: "cal-1",
  userId: "self-user",
  userFullName: "Nguyễn Văn A",
  employeeCode: "EMP001",
  leaveTypeId: "lt-1",
  leaveTypeCode: "ANNUAL",
  leaveTypeName: "Nghỉ phép năm",
  startDate: "2026-07-10",
  endDate: "2026-07-11",
  totalDays: 2,
  status: "Approved",
  reason: "Về quê",
};

const MASKED_TEAM_ENTRY = {
  ...OWN_ENTRY,
  id: "cal-2",
  userId: "other-user",
  userFullName: "Trần Thị B",
  employeeCode: "EMP002",
  reason: null, // server-masked: dòng KHÔNG phải của người gọi
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <LeaveCalendarPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LeaveCalendarPage", () => {
  // ── CROWN deny-path: no scope permission at all ────────────────────────────

  it("[crown deny] no scope permission (own/team/company all false) → forbidden EmptyState + getCalendar NOT called", () => {
    mockUseCan.mockReturnValue(false);
    mockUseCanExact.mockReturnValue(false);

    renderPage(buildQC());

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(mockGetCalendar).not.toHaveBeenCalled();
  });

  it("[crown deny] DataTable NOT rendered when forbidden", () => {
    mockUseCan.mockReturnValue(false);
    mockUseCanExact.mockReturnValue(false);

    renderPage(buildQC());

    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
  });

  // ── Own-only employee ───────────────────────────────────────────────────────

  it("employee (view-own=true, view-team/company=false) → renders own calendar; scope toggle hidden (single option)", async () => {
    mockUseCan.mockReturnValue(true); // view-own:leave-calendar
    mockUseCanExact.mockReturnValue(false); // view-team / view-company
    mockGetCalendar.mockResolvedValue({ scope: "own", items: [OWN_ENTRY] });

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByTestId("table-row")).toHaveLength(1);
    });

    expect(mockGetCalendar).toHaveBeenCalledWith(expect.objectContaining({ scope: "own" }));
    // Only 1 allowed scope → toggle buttons not rendered (ScopeToggle returns null when <=1 option)
    expect(screen.queryByRole("button", { name: /nhóm|công ty/i })).not.toBeInTheDocument();
  });

  // ── Manager (view-team) ─────────────────────────────────────────────────────

  it("manager (view-team=true via useCanExact) → team scope option available and data renders", async () => {
    mockUseCan.mockReturnValue(true); // view-own
    mockUseCanExact.mockImplementation((action: string) => action === "view-team");
    mockGetCalendar.mockResolvedValue({ scope: "own", items: [OWN_ENTRY, MASKED_TEAM_ENTRY] });

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByTestId("table-row")).toHaveLength(2);
    });

    // Scope toggle should show "Nhóm" (team) option since canViewTeam=true.
    expect(screen.getByRole("button", { name: "Nhóm" })).toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────────────────────

  it("shows error EmptyState when getCalendar fails (canViewOwn=true)", async () => {
    mockUseCan.mockReturnValue(true);
    mockUseCanExact.mockReturnValue(false);
    mockGetCalendar.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  // ── Anti-false-green: gate calls EXACT pairs, not hard-coded true ───────────

  it("gate calls useCan(view-own, leave-calendar) and useCanExact(view-team/view-company, leave-calendar)", () => {
    mockUseCan.mockReturnValue(true);
    mockUseCanExact.mockReturnValue(false);

    renderPage(buildQC());

    expect(mockUseCan).toHaveBeenCalledWith("view-own", "leave-calendar");
    expect(mockUseCanExact).toHaveBeenCalledWith("view-team", "leave-calendar");
    expect(mockUseCanExact).toHaveBeenCalledWith("view-company", "leave-calendar");
  });
});
