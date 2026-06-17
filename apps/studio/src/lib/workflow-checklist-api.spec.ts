import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StepChecklistItemStateDto } from "@mediaos/contracts";
import {
  allRequiredChecked,
  remainingRequired,
  workflowChecklistApi,
} from "./workflow-checklist-api";

const STEP_ID = "22222222-2222-2222-2222-222222222222";
const ITEM_A = "33333333-3333-3333-3333-333333333333";
const ITEM_B = "44444444-4444-4444-4444-444444444444";

function item(over: Partial<StepChecklistItemStateDto> = {}): StepChecklistItemStateDto {
  return { id: ITEM_A, label: "Mục", isRequired: true, checked: false, ...over };
}

// ─── Gate helpers (pure) ────────────────────────────────────────────────────────

describe("allRequiredChecked (submit gate mirror)", () => {
  it("empty list → true (step không có checklist thì nộp được)", () => {
    expect(allRequiredChecked([])).toBe(true);
  });

  it("một required chưa tick → false (submit bị chặn)", () => {
    expect(allRequiredChecked([item({ isRequired: true, checked: false })])).toBe(false);
  });

  it("mọi required đã tick → true (submit mở)", () => {
    expect(
      allRequiredChecked([
        item({ id: ITEM_A, isRequired: true, checked: true }),
        item({ id: ITEM_B, isRequired: true, checked: true }),
      ]),
    ).toBe(true);
  });

  it("optional chưa tick KHÔNG chặn khi required đã đủ", () => {
    expect(
      allRequiredChecked([
        item({ id: ITEM_A, isRequired: true, checked: true }),
        item({ id: ITEM_B, isRequired: false, checked: false }),
      ]),
    ).toBe(true);
  });
});

describe("remainingRequired", () => {
  it("đếm đúng số required chưa tick (bỏ qua optional)", () => {
    expect(
      remainingRequired([
        item({ id: ITEM_A, isRequired: true, checked: false }),
        item({ id: ITEM_B, isRequired: true, checked: true }),
        item({ id: "x", isRequired: false, checked: false }),
      ]),
    ).toBe(1);
  });
});

// ─── Real client (nối fetch) ─────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall(): [string, RequestInit | undefined] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
}

describe("workflowChecklistApi (real client)", () => {
  it("getStepChecklist GETs /workflow/steps/:id/checklist và parse items", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        stepId: STEP_ID,
        items: [{ id: ITEM_A, label: "Có thumbnail", isRequired: true, checked: false }],
      }),
    );
    const result = await workflowChecklistApi.getStepChecklist(STEP_ID);
    const [url, init] = lastCall();
    expect(url).toContain(`/workflow/steps/${STEP_ID}/checklist`);
    expect(init?.method ?? "GET").toBe("GET");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.isRequired).toBe(true);
  });

  it("checkItem POSTs tới checklist-items/:itemId (no body)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ stepId: STEP_ID, checklistItemId: ITEM_A, checked: true, changed: true }),
    );
    await workflowChecklistApi.checkItem(STEP_ID, ITEM_A);
    const [url, init] = lastCall();
    expect(url).toContain(`/workflow/steps/${STEP_ID}/checklist-items/${ITEM_A}`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("uncheckItem DELETEs cùng endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ stepId: STEP_ID, checklistItemId: ITEM_A, checked: false, changed: true }),
    );
    await workflowChecklistApi.uncheckItem(STEP_ID, ITEM_A);
    const [url, init] = lastCall();
    expect(url).toContain(`/workflow/steps/${STEP_ID}/checklist-items/${ITEM_A}`);
    expect(init?.method).toBe("DELETE");
  });
});
