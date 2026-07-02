// @vitest-environment jsdom
/**
 * [deny-path] EmployeeCodeConfigPage — S2-FE-HR-8.
 *
 * Gate: HR_ENGINE_PAIRS.VIEW/UPDATE_EMPLOYEE_CODE_CONFIG + PREVIEW_EMPLOYEE_CODE (cặp seed THẬT
 * mig 0459/0445) → useCan(action, resourceType) literal, KHÔNG hard-code role.
 *  - THIẾU view → forbidden EmptyState, KHÔNG gọi getConfig.
 *  - view-only (thiếu update) → form render (disabled) NHƯNG nút Lưu ẨN (anti dead-button).
 *  - view + update → nút Lưu hiện; submit → ConfirmDialog xác nhận → confirm gọi updateConfig.
 *  - preview: canPreview=false → panel ẨN hoàn toàn; canPreview=true → gọi previewNextCode + hiện mã.
 *  - loading/error đều có state riêng.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  employeeCodeConfigApi: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    previewNextCode: vi.fn(),
  },
  hrKeys: {
    employeeCodeConfig: {
      all: ["hr", "employee-code-config"],
      config: () => ["hr", "employee-code-config", "config"],
      preview: () => ["hr", "employee-code-config", "preview"],
    },
  },
  hrInvalidation: {
    updateEmployeeCodeConfig: () => [
      ["hr", "employee-code-config", "config"],
      ["hr", "employee-code-config", "preview"],
    ],
  },
  EMPLOYEE_CODE_NUMBER_LENGTH_MIN: 1,
  EMPLOYEE_CODE_NUMBER_LENGTH_MAX: 12,
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

import { useCan, employeeCodeConfigApi } from "@mediaos/web-core";
import type { EmployeeCodeConfigDto } from "@mediaos/web-core";
import { EmployeeCodeConfigPage } from "./EmployeeCodeConfigPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetConfig = employeeCodeConfigApi.getConfig as ReturnType<typeof vi.fn>;
const mockUpdateConfig = employeeCodeConfigApi.updateConfig as ReturnType<typeof vi.fn>;
const mockPreview = employeeCodeConfigApi.previewNextCode as ReturnType<typeof vi.fn>;

const CONFIG: EmployeeCodeConfigDto = {
  id: "cfg-1",
  companyId: "co-1",
  prefix: "NV",
  pattern: null,
  numberLength: 4,
  allowManualOverride: true,
  status: "active",
  createdAt: null,
  updatedAt: null,
};

/** view + preview đủ để render form + preview panel; update mặc định FALSE trừ khi test bật riêng. */
function allowView(extra: { update?: boolean; preview?: boolean } = {}) {
  mockUseCan.mockImplementation((action: string) => {
    if (action === "view") return true;
    if (action === "update") return extra.update ?? false;
    if (action === "preview") return extra.preview ?? false;
    return false;
  });
}

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <EmployeeCodeConfigPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmployeeCodeConfigPage", () => {
  it("[deny] no view:employee-code-config → forbidden EmptyState + getConfig NOT called", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("employee-code-config-forbidden")).toBeInTheDocument();
    expect(mockGetConfig).not.toHaveBeenCalled();
  });

  it("loading state renders skeleton before data resolves", () => {
    allowView();
    mockGetConfig.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage(buildQC());

    expect(screen.getByTestId("employee-code-config-loading")).toBeInTheDocument();
  });

  it("error state renders EmptyState with retry when getConfig fails", async () => {
    allowView();
    mockGetConfig.mockRejectedValue(new Error("network"));
    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText(/không thể tải cấu hình/i)).toBeInTheDocument();
    });
  });

  it("view-only (no update) → form fields render but Save button HIDDEN", async () => {
    allowView({ update: false });
    mockGetConfig.mockResolvedValue(CONFIG);
    renderPage(buildQC());

    await waitFor(() => expect(screen.getByDisplayValue("NV")).toBeInTheDocument());
    expect(screen.queryByTestId("employee-code-config-submit")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("NV")).toBeDisabled();
  });

  it("view + update → submit opens ConfirmDialog; confirm calls updateConfig with mapped body", async () => {
    allowView({ update: true });
    mockGetConfig.mockResolvedValue(CONFIG);
    mockUpdateConfig.mockResolvedValue({ ...CONFIG, prefix: "NS" });
    renderPage(buildQC());

    await waitFor(() => expect(screen.getByDisplayValue("NV")).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue("NV"), { target: { value: "NS" } });
    fireEvent.click(screen.getByTestId("employee-code-config-submit"));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /xác nhận đổi cấu hình/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /xác nhận lưu/i }));

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    const [body] = mockUpdateConfig.mock.calls[0] as [Record<string, unknown>];
    expect(body).toMatchObject({ prefix: "NS", numberLength: 4, status: "active" });
  });

  it("canPreview=false → preview panel NOT rendered, previewNextCode NOT called", async () => {
    allowView({ preview: false });
    mockGetConfig.mockResolvedValue(CONFIG);
    renderPage(buildQC());

    await waitFor(() => expect(screen.getByDisplayValue("NV")).toBeInTheDocument());
    expect(screen.queryByTestId("employee-code-preview-value")).not.toBeInTheDocument();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it("canPreview=true → preview panel fetches + renders next code", async () => {
    allowView({ preview: true });
    mockGetConfig.mockResolvedValue(CONFIG);
    mockPreview.mockResolvedValue({ sequenceKey: "employee_code", value: 42, code: "NV0042" });
    renderPage(buildQC());

    await waitFor(() =>
      expect(screen.getByTestId("employee-code-preview-value")).toHaveTextContent("NV0042"),
    );
  });
});
