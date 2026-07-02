// @vitest-environment jsdom
/**
 * [deny-path] FileAccessLogsPage — S2-FE-FND-6.
 *
 * Gate: view:foundation-file-access-log (cặp seed thật mig 0435, S2-FND-BE-3, KHÔNG sensitive).
 *  - THIẾU view → forbidden EmptyState, KHÔNG gọi fileAccessLogApi.list.
 *  - Có view → list render; loading/error/empty states; filter action → refetch với query param.
 * BẤT BIẾN #2 (APPEND-ONLY): page KHÔNG có nút sửa/xoá (server chỉ có route GET) — assert KHÔNG có
 * testid mutate nào render. BẤT BIẾN #3: DTO fileAccessLogViewSchema WHITELIST — test dùng field an toàn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  fileAccessLogApi: {
    list: vi.fn(),
  },
  foundationKeys: {
    fileAccessLogs: {
      all: ["foundation", "file-access-logs"],
      list: (params?: unknown) => ["foundation", "file-access-logs", "list", params],
    },
  },
  FILE_ACCESS_ACTIONS: [
    "Upload",
    "Download",
    "Preview",
    "Link",
    "Unlink",
    "Delete",
    "GenerateSignedUrl",
  ],
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

import { useCan, fileAccessLogApi, type FileAccessLogView } from "@mediaos/web-core";
import { FileAccessLogsPage } from "./FileAccessLogsPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockList = fileAccessLogApi.list as ReturnType<typeof vi.fn>;

const LOG: FileAccessLogView = {
  id: "fal-1",
  fileId: "file-001",
  action: "Download",
  accessGranted: true,
  deniedReason: null,
  actorUserId: "user-001",
  moduleCode: "HR",
  entityType: "employee_document",
  entityId: "ent-001",
  permissionCode: "download:foundation-file",
  requestId: "req-001",
  createdAt: "2026-06-25T10:00:00.000Z",
};

const DENIED_LOG: FileAccessLogView = {
  ...LOG,
  id: "fal-2",
  action: "Delete",
  accessGranted: false,
  deniedReason: "MissingPermission",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <FileAccessLogsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileAccessLogsPage", () => {
  it("[deny] no view:foundation-file-access-log → forbidden EmptyState + list NOT called", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("file-access-logs-forbidden")).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("view → renders rows (masked DTO fields only) + NO mutate controls (append-only)", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([LOG, DENIED_LOG]);

    renderPage(buildQC());

    // "Download" xuất hiện cả ở filter <option> lẫn cell hành động — scope vào table để tránh trùng match;
    // chờ tới khi data thật render (KHÔNG phải skeleton loading).
    await waitFor(() => {
      const table = document.querySelector("table") as HTMLTableElement;
      expect(within(table).getByText("Download")).toBeInTheDocument();
    });
    const table = document.querySelector("table") as HTMLTableElement;
    expect(within(table).getByText("MissingPermission")).toBeInTheDocument();
    // BẤT BIẾN #2: append-only viewer — KHÔNG nút sửa/xoá.
    expect(screen.queryByRole("button", { name: /sửa|xoá/i })).not.toBeInTheDocument();
  });

  it("shows table while fetching (loading state)", () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockReturnValue(new Promise(() => {}));
    renderPage(buildQC());
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  it("shows error EmptyState when fileAccessLogApi.list fails", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText(/không thể tải nhật ký truy cập tệp/i)).toBeInTheDocument();
    });
  });

  it("shows empty state when list resolves with 0 items", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([]);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByText(/không có nhật ký truy cập tệp/i).length).toBeGreaterThan(0);
    });
  });

  it("filter by action → re-queries with action param", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([LOG]);

    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("Download")).toBeInTheDocument());

    const actionSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(actionSelect, { target: { value: "Delete" } });
    fireEvent.click(screen.getByRole("button", { name: /^lọc$/i }));

    await waitFor(() => {
      const calls = mockList.mock.calls;
      expect(calls.some((c) => (c[0] as { action?: string })?.action === "Delete")).toBe(true);
    });
  });
});
