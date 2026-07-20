import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskStatesApi } from "@mediaos/web-core";
import type { ProjectStateDto } from "@mediaos/contracts";
import { TaskStateColumnsDialog } from "./TaskStateColumnsDialog";

// ---------------------------------------------------------------------------
// TaskStateColumnsDialog — cơ chế SẮP THỨ TỰ cột bằng nút lên/xuống (thay ô nhập số).
// Hợp đồng cần giữ: renumber 1..n theo vị trí MỚI, chỉ PATCH cột có sortOrder đổi,
// dữ liệu trùng số tự lành, biên (đầu/cuối) disable, thiếu quyền update → không có nút.
// ---------------------------------------------------------------------------

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskStatesApi: {
      listStates: vi.fn(),
      createState: vi.fn(),
      updateState: vi.fn().mockResolvedValue({}),
      deleteState: vi.fn(),
    },
  };
});

function makeState(partial: Partial<ProjectStateDto> & { id: string }): ProjectStateDto {
  return {
    companyId: "co-001",
    projectId: "proj-001",
    name: partial.id,
    stateGroup: "started",
    color: "#3b82f6",
    isDefault: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const MOCK_STATES: ProjectStateDto[] = [
  makeState({ id: "st-1", name: "Ý Tưởng", sortOrder: 1 }),
  makeState({ id: "st-2", name: "Đang Làm", sortOrder: 2 }),
  makeState({ id: "st-3", name: "Hoàn Thành", sortOrder: 3 }),
];

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskStateColumnsDialog projectId="proj-001" open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("TaskStateColumnsDialog — sắp thứ tự cột", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(taskStatesApi.updateState).mockResolvedValue({} as never);
  });

  it("hiện nút lên/xuống theo sortOrder; biên đầu/cuối bị disable", async () => {
    setCapabilities({ "update:project_state": true });
    vi.mocked(taskStatesApi.listStates).mockResolvedValue(MOCK_STATES);
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("state-manage-row-st-1")).toBeInTheDocument());

    expect(screen.getByTestId("state-move-up-st-1")).toBeDisabled();
    expect(screen.getByTestId("state-move-down-st-1")).toBeEnabled();
    expect(screen.getByTestId("state-move-up-st-3")).toBeEnabled();
    expect(screen.getByTestId("state-move-down-st-3")).toBeDisabled();
  });

  it("bấm chuyển xuống → hoán đổi 2 cột kề nhau, CHỈ PATCH cột có sortOrder đổi", async () => {
    setCapabilities({ "update:project_state": true });
    vi.mocked(taskStatesApi.listStates).mockResolvedValue(MOCK_STATES);
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("state-manage-row-st-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("state-move-down-st-1"));

    await waitFor(() => expect(taskStatesApi.updateState).toHaveBeenCalledTimes(2));
    expect(taskStatesApi.updateState).toHaveBeenCalledWith("st-2", { sortOrder: 1 });
    expect(taskStatesApi.updateState).toHaveBeenCalledWith("st-1", { sortOrder: 2 });
    // st-3 giữ nguyên số 3 — không PATCH thừa.
    expect(taskStatesApi.updateState).not.toHaveBeenCalledWith("st-3", expect.anything());
  });

  it("dữ liệu trùng/thủng số thứ tự → một lần bấm tự lành, đánh lại 1..n", async () => {
    setCapabilities({ "update:project_state": true });
    // Trùng số (5,5) + thủng (9): thứ tự hiển thị tie-break theo tên A→B, C cuối.
    vi.mocked(taskStatesApi.listStates).mockResolvedValue([
      makeState({ id: "st-a", name: "A", sortOrder: 5 }),
      makeState({ id: "st-b", name: "B", sortOrder: 5 }),
      makeState({ id: "st-c", name: "C", sortOrder: 9 }),
    ]);
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("state-manage-row-st-a")).toBeInTheDocument());

    // B lên đầu: [B, A, C] → renumber B=1, A=2, C=3 — cả 3 đều đổi số.
    fireEvent.click(screen.getByTestId("state-move-up-st-b"));

    await waitFor(() => expect(taskStatesApi.updateState).toHaveBeenCalledTimes(3));
    expect(taskStatesApi.updateState).toHaveBeenCalledWith("st-b", { sortOrder: 1 });
    expect(taskStatesApi.updateState).toHaveBeenCalledWith("st-a", { sortOrder: 2 });
    expect(taskStatesApi.updateState).toHaveBeenCalledWith("st-c", { sortOrder: 3 });
  });

  it("thiếu update:project_state (và không phải Owner/Manager) → KHÔNG có nút lên/xuống", async () => {
    setCapabilities({});
    vi.mocked(taskStatesApi.listStates).mockResolvedValue(MOCK_STATES);
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("state-manage-row-st-1")).toBeInTheDocument());

    expect(screen.queryByTestId("state-move-up-st-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("state-move-down-st-1")).not.toBeInTheDocument();
  });
});
