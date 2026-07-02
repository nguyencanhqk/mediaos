// @vitest-environment jsdom
/**
 * [deny-path] OrgChartPage — S2-FE-HR-6.
 *
 * Gate: HR_ENGINE_PAIRS.ORG_CHART_VIEW (= read:department, cặp seed thật mig 0444/0005 — KHÔNG
 * sensitive) → useCan (wildcard fallback OK, cùng cặp "phòng ban" HR).
 *  - THIẾU quyền → forbidden EmptyState, KHÔNG gọi orgApi.getTree.
 *  - Có quyền → cây org_unit render đệ quy; loading/error/empty states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  orgApi: {
    getTree: vi.fn(),
  },
  hrKeys: {
    orgChart: {
      all: ["hr", "org-chart"],
      tree: () => ["hr", "org-chart", "tree"],
    },
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

import { useCan, orgApi, type OrgTreeNode } from "@mediaos/web-core";
import { OrgChartPage } from "./OrgChartPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetTree = orgApi.getTree as ReturnType<typeof vi.fn>;

const TREE: OrgTreeNode[] = [
  {
    id: "org-1",
    parentId: null,
    name: "Ban Giám đốc",
    type: "department",
    code: "BGD",
    status: "active",
    headUserName: "Nguyễn Văn A",
    children: [
      {
        id: "org-2",
        parentId: "org-1",
        name: "Phòng Kỹ thuật",
        type: "department",
        code: "KT",
        status: "active",
        headUserName: null,
        children: [],
      },
    ],
  },
];

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <OrgChartPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrgChartPage", () => {
  it("[deny] no read:department → forbidden EmptyState + getTree NOT called", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("org-chart-forbidden")).toBeInTheDocument();
    expect(mockGetTree).not.toHaveBeenCalled();
  });

  it("allow → renders tree nodes (parent + nested child)", async () => {
    mockUseCan.mockReturnValue(true);
    mockGetTree.mockResolvedValue(TREE);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText("Ban Giám đốc")).toBeInTheDocument();
    });
    expect(screen.getByText("Phòng Kỹ thuật")).toBeInTheDocument();
    expect(screen.getByText(/Nguyễn Văn A/)).toBeInTheDocument();
  });

  it("shows loading state while fetching", () => {
    mockUseCan.mockReturnValue(true);
    mockGetTree.mockReturnValue(new Promise(() => {}));
    renderPage(buildQC());
    expect(screen.getByTestId("org-chart-loading")).toBeInTheDocument();
  });

  it("shows error EmptyState when orgApi.getTree fails", async () => {
    mockUseCan.mockReturnValue(true);
    mockGetTree.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText(/không thể tải sơ đồ tổ chức/i)).toBeInTheDocument();
    });
  });

  it("shows empty state when tree resolves with 0 nodes", async () => {
    mockUseCan.mockReturnValue(true);
    mockGetTree.mockResolvedValue([]);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText(/chưa có cơ cấu tổ chức/i)).toBeInTheDocument();
    });
  });
});
