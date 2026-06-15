import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateBonusPenaltyDialog } from "./create-bonus-penalty-dialog";
import { bonusPenaltyApi } from "@/lib/bonus-penalty-api";

const UUID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreateBonusPenaltyDialog />
    </QueryClientProvider>,
  );
}

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: /Thêm thưởng\/phạt/ }));
}

beforeEach(() => {
  vi.spyOn(bonusPenaltyApi, "create").mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CreateBonusPenaltyDialog — form validation", () => {
  it("blocks submit and does NOT call create when referenceType='task' but taskId is empty", async () => {
    renderDialog();
    openForm();
    fireEvent.change(screen.getByLabelText(/Nhân sự/), { target: { value: UUID } });
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/Kỳ/), { target: { value: "2026-06" } });
    fireEvent.change(screen.getByLabelText(/Tham chiếu/), { target: { value: "task" } });
    // taskId left empty
    fireEvent.click(screen.getByRole("button", { name: /^Lưu$/ }));

    await waitFor(() => {
      expect(screen.getByText(/Vui lòng nhập ID/i)).toBeInTheDocument();
    });
    expect(bonusPenaltyApi.create).not.toHaveBeenCalled();
  });

  it("blocks submit (no create) when amount <= 0", async () => {
    renderDialog();
    openForm();
    fireEvent.change(screen.getByLabelText(/Nhân sự/), { target: { value: UUID } });
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/Kỳ/), { target: { value: "2026-06" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lưu$/ }));

    await waitFor(() => {
      expect(screen.getByText(/lớn hơn 0/i)).toBeInTheDocument();
    });
    expect(bonusPenaltyApi.create).not.toHaveBeenCalled();
  });

  it("submits a valid bonus with a task reference (exactly-one id)", async () => {
    renderDialog();
    openForm();
    fireEvent.change(screen.getByLabelText(/Nhân sự/), { target: { value: UUID } });
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/Kỳ/), { target: { value: "2026-06" } });
    fireEvent.change(screen.getByLabelText(/Tham chiếu/), { target: { value: "task" } });
    fireEvent.change(screen.getByLabelText(/ID tham chiếu/), { target: { value: UUID } });
    fireEvent.click(screen.getByRole("button", { name: /^Lưu$/ }));

    await waitFor(() => {
      expect(bonusPenaltyApi.create).toHaveBeenCalledTimes(1);
    });
    const arg = vi.mocked(bonusPenaltyApi.create).mock.calls[0][0];
    expect(arg).toMatchObject({
      userId: UUID,
      amount: 500000,
      periodMonth: "2026-06",
      referenceType: "task",
      taskId: UUID,
    });
    // exactly-one reference: other ids not set.
    expect(arg.defectId).toBeUndefined();
    expect(arg.kpiResultId).toBeUndefined();
  });

  it("resets the previous reference id when referenceType changes (exactly-one)", async () => {
    renderDialog();
    openForm();
    fireEvent.change(screen.getByLabelText(/Nhân sự/), { target: { value: UUID } });
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/Kỳ/), { target: { value: "2026-06" } });
    fireEvent.change(screen.getByLabelText(/Tham chiếu/), { target: { value: "task" } });
    fireEvent.change(screen.getByLabelText(/ID tham chiếu/), { target: { value: UUID } });
    // switch to defect — the task id must be cleared so only one id is sent
    fireEvent.change(screen.getByLabelText(/Tham chiếu/), { target: { value: "defect" } });
    fireEvent.change(screen.getByLabelText(/ID tham chiếu/), { target: { value: UUID } });
    fireEvent.click(screen.getByRole("button", { name: /^Lưu$/ }));

    await waitFor(() => {
      expect(bonusPenaltyApi.create).toHaveBeenCalledTimes(1);
    });
    const arg = vi.mocked(bonusPenaltyApi.create).mock.calls[0][0];
    expect(arg.referenceType).toBe("defect");
    expect(arg.defectId).toBe(UUID);
    expect(arg.taskId).toBeUndefined();
  });

  it("submits with no reference when referenceType is empty", async () => {
    renderDialog();
    openForm();
    fireEvent.change(screen.getByLabelText(/Nhân sự/), { target: { value: UUID } });
    fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/Kỳ/), { target: { value: "2026-06" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lưu$/ }));

    await waitFor(() => {
      expect(bonusPenaltyApi.create).toHaveBeenCalledTimes(1);
    });
    const arg = vi.mocked(bonusPenaltyApi.create).mock.calls[0][0];
    expect(arg.referenceType).toBeUndefined();
    expect(arg.taskId).toBeUndefined();
  });
});
