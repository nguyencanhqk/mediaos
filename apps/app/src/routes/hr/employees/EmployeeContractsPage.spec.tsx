import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, contractsApi, hrApi, filesApi } from "@mediaos/web-core";
import type {
  EmployeeContractDto,
  HrEmployeeDetail,
  HrContractTypeLookup,
} from "@mediaos/contracts";
import { EmployeeContractsPage } from "./EmployeeContractsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    contractsApi: {
      listEmployeeContracts: vi.fn(),
      createContract: vi.fn(),
      updateContract: vi.fn(),
      deleteContract: vi.fn(),
      linkContractFile: vi.fn(),
    },
    filesApi: {
      getDownloadUrl: vi.fn(),
    },
    hrApi: {
      ...actual.hrApi,
      getEmployee: vi.fn(),
      listContractTypes: vi.fn(),
    },
  };
});
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const EMPLOYEE: HrEmployeeDetail = {
  id: "emp-1",
  employeeCode: "NV001",
  fullName: "Nguyễn Văn A",
  email: "a@demo.local",
  orgUnitName: null,
  positionName: null,
  status: "active",
  startDate: null,
  endDate: null,
  workType: null,
  phone: null,
  notes: null,
  contractType: null,
  baseSalary: null,
} as unknown as HrEmployeeDetail;

const CONTRACT_TYPE: HrContractTypeLookup = {
  id: "ct-1",
  name: "Toàn thời gian",
  code: "FT",
  requiresEndDate: false,
};

const CONTRACT: EmployeeContractDto = {
  id: "c-1",
  companyId: "co1",
  employeeId: "emp-1",
  contractTypeId: "ct-1",
  contractCode: "HD-001",
  title: "Hợp đồng chính thức",
  startDate: "2026-01-01",
  endDate: null,
  signedDate: null,
  status: "Active",
  isPrimary: true,
  fileId: null,
  note: null,
  expiringSoon: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("EmployeeContractsPage (gate = view/manage:contract)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(contractsApi.listEmployeeContracts).mockResolvedValue([CONTRACT]);
    vi.mocked(hrApi.getEmployee).mockResolvedValue(EMPLOYEE);
    vi.mocked(hrApi.listContractTypes).mockResolvedValue([CONTRACT_TYPE]);
  });

  it("shows forbidden and does not fetch without view:contract", () => {
    setCaps({ "read:employee": true });
    renderWithQuery(<EmployeeContractsPage employeeId="emp-1" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(contractsApi.listEmployeeContracts).not.toHaveBeenCalled();
  });

  it("renders contract list read-only with view:contract only (no add button)", async () => {
    setCaps({ "view:contract": true });
    renderWithQuery(<EmployeeContractsPage employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("HD-001")).toBeInTheDocument());
    expect(screen.queryByText(/thêm hợp đồng/i)).not.toBeInTheDocument();
  });

  it("shows create/edit/delete affordances with manage:contract", async () => {
    setCaps({ "view:contract": true, "manage:contract": true });
    renderWithQuery(<EmployeeContractsPage employeeId="emp-1" />);
    await waitFor(() => expect(screen.getByText("HD-001")).toBeInTheDocument());
    expect(screen.getByText(/thêm hợp đồng/i)).toBeInTheDocument();
    expect(screen.getByText(/gắn file/i)).toBeInTheDocument();
  });
});

/**
 * S16-SOCIAL-FILEOPENUX-1 L-1 — tệp hợp đồng (PDF) được server phục vụ dạng TẢI XUỐNG ⇒ nhãn chờ không được
 * hứa «mở». Đo bằng `textContent` so với chuỗi literal (so với chính khoá i18n thì ca không bao giờ đỏ).
 */
describe("EmployeeContractsPage — nhãn nút tải hợp đồng (S16-SOCIAL-FILEOPENUX-1)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(contractsApi.listEmployeeContracts).mockResolvedValue([
      { ...CONTRACT, fileId: "file-9" },
    ]);
    vi.mocked(hrApi.getEmployee).mockResolvedValue(EMPLOYEE);
    vi.mocked(hrApi.listContractTypes).mockResolvedValue([CONTRACT_TYPE]);
  });

  it("[L-1 FILEOPENUX] đang chờ URL ⇒ nhãn «Đang tải…», không «Đang mở…»", async () => {
    setCaps({ "view:contract": true, "download:foundation-file": true });
    vi.mocked(filesApi.getDownloadUrl).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<EmployeeContractsPage employeeId="emp-1" />);
    // Bảng dựng lại ô hành động khi dữ liệu khác về ⇒ đọc lại nút SAU click, không giữ tham chiếu cũ.
    const downloadButton = () => screen.getByRole("button", { name: /tải hợp đồng/i });
    await screen.findByRole("button", { name: /tải hợp đồng/i });

    fireEvent.click(downloadButton());

    await waitFor(() => expect(downloadButton()).toBeDisabled());
    expect(filesApi.getDownloadUrl).toHaveBeenCalledWith("file-9");
    const button = downloadButton();
    expect(button.textContent?.trim()).toBe("Đang tải…");
    expect(button.textContent).not.toContain("Đang mở");
  });
});
