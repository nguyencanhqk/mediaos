/**
 * SequencesPage — S2-FE-FND-5 (lane FE batch C).
 * Gate: view:foundation-sequence. Preview KHÔNG mutate. Edit gate: update:foundation-sequence.
 * States: forbidden · loading · error · empty · list + preview + edit dialog.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, foundationOpsApi } from "@mediaos/web-core";
import { SequencesPage } from "./SequencesPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    foundationOpsApi: {
      listSequences: vi.fn(),
      previewSequence: vi.fn(),
      updateSequence: vi.fn(),
      listSeeds: vi.fn(),
    },
  };
});

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

const SEQ = {
  id: "seq-1",
  moduleCode: "HR",
  sequenceKey: "employee_code",
  scopeType: "Company" as const,
  scopeReferenceId: null,
  prefix: "NV",
  suffix: null,
  datePattern: null,
  paddingLength: 4,
  incrementBy: 1,
  resetPolicy: "Never" as const,
  status: "Active" as const,
  lastGeneratedCode: "NV0012",
  lastResetAt: null,
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("SequencesPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(foundationOpsApi.listSequences).mockResolvedValue([SEQ]);
  });

  it("shows forbidden when user lacks view:foundation-sequence", () => {
    setCaps({});
    renderWithQuery(<SequencesPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(foundationOpsApi.listSequences).not.toHaveBeenCalled();
  });

  it("renders sequence list", async () => {
    setCaps({ "view:foundation-sequence": true });
    renderWithQuery(<SequencesPage />);
    await waitFor(() => expect(screen.getByText("employee_code")).toBeInTheDocument());
    expect(screen.getByText("NV0012")).toBeInTheDocument();
    expect(screen.getByText("Đang dùng")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    setCaps({ "view:foundation-sequence": true });
    vi.mocked(foundationOpsApi.listSequences).mockRejectedValue(new Error("net"));
    renderWithQuery(<SequencesPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách bộ đếm/i)).toBeInTheDocument(),
    );
  });

  it("shows empty state when there are no sequences", async () => {
    setCaps({ "view:foundation-sequence": true });
    vi.mocked(foundationOpsApi.listSequences).mockResolvedValue([]);
    renderWithQuery(<SequencesPage />);
    await waitFor(() => expect(screen.getByText(/không có bộ đếm/i)).toBeInTheDocument());
  });

  it("previews next code WITHOUT mutating (calls previewSequence only)", async () => {
    setCaps({ "view:foundation-sequence": true });
    vi.mocked(foundationOpsApi.previewSequence).mockResolvedValue({
      sequenceKey: "employee_code",
      value: 13,
      code: "NV0013",
    });
    renderWithQuery(<SequencesPage />);
    await waitFor(() => expect(screen.getByText("employee_code")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Xem mã kế tiếp" }));

    await waitFor(() => expect(foundationOpsApi.previewSequence).toHaveBeenCalledWith("seq-1"));
    await waitFor(() => expect(screen.getByText("NV0013")).toBeInTheDocument());
    expect(foundationOpsApi.updateSequence).not.toHaveBeenCalled();
  });

  it("hides edit action when user lacks update:foundation-sequence", async () => {
    setCaps({ "view:foundation-sequence": true });
    renderWithQuery(<SequencesPage />);
    await waitFor(() => expect(screen.getByText("employee_code")).toBeInTheDocument());
    expect(screen.queryByLabelText("Sửa cấu hình")).not.toBeInTheDocument();
  });

  it("opens edit dialog + confirms before PATCH", async () => {
    setCaps({ "view:foundation-sequence": true, "update:foundation-sequence": true });
    vi.mocked(foundationOpsApi.updateSequence).mockResolvedValue(SEQ);
    renderWithQuery(<SequencesPage />);
    await waitFor(() => expect(screen.getByText("employee_code")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Sửa cấu hình"));
    const dialog = await screen.findByRole("dialog", { name: /sửa cấu hình bộ đếm/i });
    fireEvent.submit(dialog.querySelector("#sequence-edit-form") as HTMLFormElement);

    // Confirm step (ConfirmDialog) trước khi thực sự PATCH.
    const confirmDialog = await screen.findByRole("dialog", {
      name: /xác nhận đổi cấu hình bộ đếm/i,
    });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: /lưu cấu hình/i }));

    await waitFor(() => expect(foundationOpsApi.updateSequence).toHaveBeenCalledTimes(1));
    expect(foundationOpsApi.updateSequence).toHaveBeenCalledWith(
      "seq-1",
      expect.objectContaining({ prefix: "NV", paddingLength: 4, incrementBy: 1 }),
    );
  });
});
