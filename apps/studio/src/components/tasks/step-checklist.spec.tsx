import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StepChecklistDto } from "@mediaos/contracts";
import { StepChecklist, stepChecklistQueryKey } from "./step-checklist";
import { allRequiredChecked } from "@/lib/workflow-checklist-api";

// Mock chỉ client (giữ allRequiredChecked/remainingRequired thật — chúng là pure).
vi.mock("@/lib/workflow-checklist-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workflow-checklist-api")>();
  return {
    ...actual,
    workflowChecklistApi: {
      getStepChecklist: vi.fn(),
      checkItem: vi.fn(),
      uncheckItem: vi.fn(),
    },
  };
});

import { workflowChecklistApi } from "@/lib/workflow-checklist-api";

const STEP_ID = "22222222-2222-2222-2222-222222222222";
const ITEM_A = "33333333-3333-3333-3333-333333333333";
const ITEM_B = "44444444-4444-4444-4444-444444444444";

const getMock = vi.mocked(workflowChecklistApi.getStepChecklist);
const checkMock = vi.mocked(workflowChecklistApi.checkItem);

function checklist(over: Partial<StepChecklistDto> = {}): StepChecklistDto {
  return {
    stepId: STEP_ID,
    items: [
      { id: ITEM_A, label: "Có thumbnail", isRequired: true, checked: false },
      { id: ITEM_B, label: "Đặt tiêu đề SEO", isRequired: false, checked: false },
    ],
    ...over,
  };
}

function renderWithClient(ui: ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  getMock.mockReset();
  checkMock.mockReset();
  checkMock.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("StepChecklist — render", () => {
  it("hiện item required với nhãn 'Bắt buộc' và checkbox phản ánh trạng thái", async () => {
    getMock.mockResolvedValue(checklist());
    renderWithClient(<StepChecklist stepId={STEP_ID} editable />);

    const requiredBox = await screen.findByRole("checkbox", { name: /Có thumbnail/ });
    expect(requiredBox).not.toBeChecked();
    expect(screen.getByText("Bắt buộc")).toBeInTheDocument();
  });

  it("rỗng → không render gì (step không có checklist)", async () => {
    getMock.mockResolvedValue(checklist({ items: [] }));
    const { container } = renderWithClient(<StepChecklist stepId={STEP_ID} editable />);
    // Sau khi load xong, không render section nào.
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(container.querySelector("section")).toBeNull();
  });

  it("editable=false → checkbox bị disable (read-only)", async () => {
    getMock.mockResolvedValue(checklist());
    renderWithClient(<StepChecklist stepId={STEP_ID} editable={false} />);
    const box = await screen.findByRole("checkbox", { name: /Có thumbnail/ });
    expect(box).toBeDisabled();
  });
});

describe("StepChecklist — tick", () => {
  it("tick item required → gọi checkItem(stepId, itemId)", async () => {
    getMock.mockResolvedValue(checklist());
    renderWithClient(<StepChecklist stepId={STEP_ID} editable />);
    const box = await screen.findByRole("checkbox", { name: /Có thumbnail/ });
    fireEvent.click(box);
    await waitFor(() => expect(checkMock).toHaveBeenCalledWith(STEP_ID, ITEM_A));
  });
});

// Harness soi gate y như SubmitWorkForm: đọc cùng query key + allRequiredChecked.
function SubmitGate({ stepId }: { stepId: string }) {
  const { data } = useQuery({
    queryKey: stepChecklistQueryKey(stepId),
    queryFn: () => workflowChecklistApi.getStepChecklist(stepId),
  });
  return (
    <button disabled={!allRequiredChecked(data?.items ?? [])}>Nộp bài</button>
  );
}

describe("Submit gate (4b) — mirror BE", () => {
  it("required chưa tick → nút Nộp bài bị disable", async () => {
    getMock.mockResolvedValue(checklist());
    renderWithClient(<SubmitGate stepId={STEP_ID} />);
    // Chờ data resolve → required chưa tick → nút chuyển sang disabled.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Nộp bài" })).toBeDisabled(),
    );
  });

  it("mọi required đã tick → nút Nộp bài mở", async () => {
    getMock.mockResolvedValue(
      checklist({
        items: [
          { id: ITEM_A, label: "Có thumbnail", isRequired: true, checked: true },
          { id: ITEM_B, label: "Đặt tiêu đề SEO", isRequired: false, checked: false },
        ],
      }),
    );
    renderWithClient(<SubmitGate stepId={STEP_ID} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Nộp bài" })).toBeEnabled(),
    );
  });
});
