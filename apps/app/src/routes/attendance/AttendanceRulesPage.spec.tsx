// @vitest-environment jsdom
/**
 * [deny-path] AttendanceRulesPage — gate useCanExact('view','attendance-rule'), fail-closed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCanExact: vi.fn(() => false),
  attendanceApi: {
    listRules: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
  },
  attendanceKeys: {
    rules: { all: ["attendance", "rules"], list: () => ["attendance", "rules", "list"] },
  },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
      </div>
    ),
    DataTable: ({ data, emptyState }: { data: unknown[]; emptyState?: React.ReactNode }) => (
      <div data-testid="data-table">
        {data.length === 0
          ? emptyState
          : data.map((_, i) => <div key={i} data-testid="table-row" />)}
      </div>
    ),
    EmptyState: ({
      title,
      description,
      "data-testid": testId,
    }: {
      title: string;
      description?: string;
      "data-testid"?: string;
    }) => (
      <div data-testid={testId ?? "empty-state"}>
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
  };
});

import { useCanExact, attendanceApi } from "@mediaos/web-core";
import { AttendanceRulesPage } from "./AttendanceRulesPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockListRules = attendanceApi.listRules as ReturnType<typeof vi.fn>;

const RULES_RESPONSE = [
  {
    id: "rule-1",
    ruleCode: "DEFAULT_COMPANY_RULE",
    name: "Rule công ty mặc định",
    ruleScope: "Company",
    departmentId: null,
    employeeId: null,
    priority: 100,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    status: "Active",
  },
];

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <AttendanceRulesPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AttendanceRulesPage", () => {
  it("[crown deny] no view:attendance-rule (useCanExact false) → forbidden EmptyState + API NOT called", () => {
    mockUseCanExact.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("rules-forbidden")).toBeInTheDocument();
    expect(mockListRules).not.toHaveBeenCalled();
    expect(screen.queryByTestId("data-table")).not.toBeInTheDocument();
  });

  it("has view:attendance-rule → calls listRules and renders rows", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListRules.mockResolvedValue(RULES_RESPONSE);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByTestId("table-row")).toHaveLength(1);
    });
    expect(mockListRules).toHaveBeenCalled();
  });

  it("shows error EmptyState when API fails", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockListRules.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });
});
