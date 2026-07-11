// @vitest-environment jsdom
/**
 * [deny-path] SystemJobsPage — S5-FND-JOBS-OBS-1.
 *
 * Gate: view:foundation-job (cặp seed thật mig 0435:365, KHÔNG sensitive).
 *  - THIẾU view → forbidden EmptyState, KHÔNG gọi systemJobsApi.listSummary.
 *  - Có view → list render (job code/status/duration/error); loading/error/empty states.
 *  - BẤT BIẾN READ-ONLY: KHÔNG nút trigger/chạy job — chỉ nút "Xem lịch sử" mở SystemJobRunsDialog.
 * DataTable dùng THẬT (không mock) — chỉ mock PageHeader/EmptyState (mẫu RetentionPoliciesPage.spec.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  systemJobsApi: {
    listSummary: vi.fn(),
    listRuns: vi.fn(),
  },
  foundationKeys: {
    systemJobs: {
      all: ["foundation", "system-jobs"],
      summary: () => ["foundation", "system-jobs", "summary"],
      runs: (jobName: string, params?: unknown) => [
        "foundation",
        "system-jobs",
        "runs",
        jobName,
        params,
      ],
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
    // DataTable = actual (unmocked) — cần render cột "actions" thật (nút Xem lịch sử).
  };
});

// Dialog lịch sử test riêng — ở đây chỉ cần biết nó mở khi bấm "Xem lịch sử".
vi.mock("./SystemJobRunsDialog", () => ({
  SystemJobRunsDialog: ({ jobCode }: { jobCode: string }) => (
    <div data-testid="system-job-runs-dialog">{jobCode}</div>
  ),
}));

import { useCan, systemJobsApi, type SystemJobRunView } from "@mediaos/web-core";
import { SystemJobsPage } from "./SystemJobsPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockListSummary = systemJobsApi.listSummary as ReturnType<typeof vi.fn>;

const RUN_SUCCESS: SystemJobRunView = {
  id: "run-1",
  jobCode: "RETENTION_CLEANUP",
  companyId: "22222222-2222-2222-2222-222222222222",
  status: "Success",
  triggeredBy: "Scheduler",
  startedAt: "2026-07-11T00:00:00.000Z",
  finishedAt: "2026-07-11T00:00:05.000Z",
  durationMs: 5000,
  totalItems: 10,
  successItems: 10,
  failedItems: 0,
  errorMessage: null,
};

const RUN_FAILED: SystemJobRunView = {
  ...RUN_SUCCESS,
  id: "run-2",
  jobCode: "TEMP_FILE_CLEANUP",
  status: "Failed",
  errorMessage: "connect ECONNREFUSED",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <SystemJobsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SystemJobsPage", () => {
  it("[deny] no view:foundation-job → forbidden EmptyState + listSummary NOT called", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("system-jobs-forbidden")).toBeInTheDocument();
    expect(mockListSummary).not.toHaveBeenCalled();
  });

  it("view → renders rows (jobCode/status/error) + NO trigger/run button (READ-ONLY)", async () => {
    mockUseCan.mockReturnValue(true);
    mockListSummary.mockResolvedValue([RUN_SUCCESS, RUN_FAILED]);

    renderPage(buildQC());

    await waitFor(() => expect(screen.getByText("RETENTION_CLEANUP")).toBeInTheDocument());
    expect(screen.getByText("TEMP_FILE_CLEANUP")).toBeInTheDocument();
    expect(screen.getByText("connect ECONNREFUSED")).toBeInTheDocument();
    // READ-ONLY (BẤT BIẾN): KHÔNG nút chạy/trigger job.
    expect(screen.queryByRole("button", { name: /chạy|trigger|run job/i })).not.toBeInTheDocument();
  });

  it("bấm 'Xem lịch sử' mở SystemJobRunsDialog cho ĐÚNG jobCode", async () => {
    mockUseCan.mockReturnValue(true);
    mockListSummary.mockResolvedValue([RUN_SUCCESS]);

    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("RETENTION_CLEANUP")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("system-job-history-btn"));
    const dialog = screen.getByTestId("system-job-runs-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("RETENTION_CLEANUP");
  });

  it("shows error EmptyState when systemJobsApi.listSummary fails", async () => {
    mockUseCan.mockReturnValue(true);
    mockListSummary.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText(/không thể tải danh sách system job/i)).toBeInTheDocument();
    });
  });

  it("shows empty state when listSummary resolves with 0 items", async () => {
    mockUseCan.mockReturnValue(true);
    mockListSummary.mockResolvedValue([]);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByText(/chưa có system job nào chạy/i).length).toBeGreaterThan(0);
    });
  });
});
