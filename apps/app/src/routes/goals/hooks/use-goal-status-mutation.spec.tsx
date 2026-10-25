/**
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-02) — hook đổi trạng thái mục tiêu dùng chung (chi tiết · thẻ /me ·
 * kích hoạt hàng loạt về sau): PATCH {status} lạc quan, 403/422 ⇒ trả cache về trạng thái cũ + toast
 * theo mã. Ca từ chối viết TRƯỚC.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, goalApi: { ...actual.goalApi, updateGoal: vi.fn() } };
});

import { ApiError, goalApi, goalKeys, meKeys } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import { toast } from "@mediaos/ui";
import { patchGoalStatusInCache, useGoalStatusMutation } from "./use-goal-status-mutation";

const mockUpdateGoal = goalApi.updateGoal as ReturnType<typeof vi.fn>;

const GOAL_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function makeGoal(over: Partial<GoalCoreResponseDto> = {}): GoalCoreResponseDto {
  return {
    id: GOAL_ID,
    companyId: "co-1",
    goalCode: "GOAL-0001",
    name: "Doanh số quý",
    description: null,
    level: "employee",
    departmentId: null,
    projectId: null,
    employeeId: "emp-1",
    parentGoalId: null,
    ownerEmployeeId: "emp-1",
    periodType: "quarter",
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    measureType: "percent",
    targetValue: null,
    currentValue: null,
    unit: null,
    progressMode: "manual",
    progressPercent: null,
    weight: 1,
    status: "Draft",
    finalizedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const ME_PARAMS = { periodFrom: "2026-10-01", periodTo: "2026-12-31", limit: 20 };

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(goalKeys.detail(GOAL_ID), makeGoal());
  client.setQueryData(meKeys.goals(ME_PARAMS), [
    makeGoal(),
    makeGoal({ id: OTHER_ID, status: "Active" }),
  ]);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
  const view = renderHook(() => useGoalStatusMutation(), { wrapper });
  const detailStatus = () =>
    client.getQueryData<GoalCoreResponseDto>(goalKeys.detail(GOAL_ID))?.status;
  const meStatuses = () =>
    client.getQueryData<GoalCoreResponseDto[]>(meKeys.goals(ME_PARAMS))?.map((g) => g.status);
  return { client, view, detailStatus, meStatuses };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useGoalStatusMutation — ca từ chối (rollback)", () => {
  it("403 ngoài phạm vi ⇒ trạng thái về Draft ở mọi cache + toast «Bạn không có quyền sửa mục tiêu này»", async () => {
    const error = vi.spyOn(toast, "error");
    const pending = deferred<GoalCoreResponseDto>();
    mockUpdateGoal.mockReturnValue(pending.promise);
    const { view, detailStatus, meStatuses } = setup();

    act(() => {
      void view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
    });
    // Lạc quan: đổi ngay trước khi server trả lời.
    await waitFor(() => expect(detailStatus()).toBe("Active"));
    expect(meStatuses()).toEqual(["Active", "Active"]);

    await act(async () => {
      pending.reject(new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }));
      await pending.promise.catch(() => undefined);
    });

    await waitFor(() => expect(detailStatus()).toBe("Draft"));
    expect(meStatuses()).toEqual(["Draft", "Active"]);
    expect(error).toHaveBeenCalledWith("Bạn không có quyền sửa mục tiêu này");
  });

  it("422 GOAL-ERR-005 (đã chốt kỳ) ⇒ rollback + thông điệp theo mã", async () => {
    const error = vi.spyOn(toast, "error");
    mockUpdateGoal.mockRejectedValue(
      new ApiError({ status: 422, code: "GOAL-ERR-005", message: "Goal finalized" }),
    );
    const { view, detailStatus } = setup();

    await act(async () => {
      await view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
    });

    expect(detailStatus()).toBe("Draft");
    expect(error).toHaveBeenCalledWith("Mục tiêu đã chốt kỳ — mở lại kỳ trước khi đổi trạng thái.");
  });

  it("422 mã khác ⇒ rollback + thông điệp của server qua error-mapper", async () => {
    const error = vi.spyOn(toast, "error");
    mockUpdateGoal.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "GOAL-ERR-010",
        message: "Nhân viên của mục tiêu không còn làm việc.",
      }),
    );
    const { view, detailStatus } = setup();

    await act(async () => {
      await view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
    });

    expect(detailStatus()).toBe("Draft");
    expect(error).toHaveBeenCalledWith("Nhân viên của mục tiêu không còn làm việc.");
  });

  it("lỗi không phải ApiError ⇒ rollback + thông điệp chung, changeStatus trả null (không ném)", async () => {
    const error = vi.spyOn(toast, "error");
    mockUpdateGoal.mockRejectedValue(new TypeError("Failed to fetch"));
    const { view, detailStatus } = setup();

    let result: unknown = "unset";
    await act(async () => {
      result = await view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
    });

    expect(result).toBeNull();
    expect(detailStatus()).toBe("Draft");
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("useGoalStatusMutation — nhiều lần đổi song song (kích hoạt hàng loạt)", () => {
  it("một lần bị 403 chỉ trả về mục tiêu ĐÓ, không đè lần đổi khác đang thành công", async () => {
    const first = deferred<GoalCoreResponseDto>();
    const second = deferred<GoalCoreResponseDto>();
    mockUpdateGoal.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { client, view, meStatuses } = setup();
    client.setQueryData(meKeys.goals(ME_PARAMS), [
      makeGoal(),
      makeGoal({ id: OTHER_ID, status: "Draft" }),
    ]);

    act(() => {
      void view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
      void view.result.current.changeStatus({ goalId: OTHER_ID, status: "Active" });
    });
    await waitFor(() => expect(meStatuses()).toEqual(["Active", "Active"]));

    await act(async () => {
      first.reject(new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }));
      await first.promise.catch(() => undefined);
    });

    await waitFor(() => expect(meStatuses()).toEqual(["Draft", "Active"]));
  });
});

describe("useGoalStatusMutation — thành công", () => {
  it("Kích hoạt ⇒ PATCH chỉ {status}, giữ Active, toast thành công kèm tên", async () => {
    const success = vi.spyOn(toast, "success");
    mockUpdateGoal.mockResolvedValue(makeGoal({ status: "Active" }));
    const { view, detailStatus } = setup();

    await act(async () => {
      await view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
    });

    expect(mockUpdateGoal).toHaveBeenCalledWith(GOAL_ID, { status: "Active" });
    expect(detailStatus()).toBe("Active");
    expect(success).toHaveBeenCalledWith("Đã kích hoạt mục tiêu «Doanh số quý».");
  });

  it("Đánh dấu Hoàn thành ⇒ toast riêng", async () => {
    const success = vi.spyOn(toast, "success");
    mockUpdateGoal.mockResolvedValue(makeGoal({ status: "Completed" }));
    const { view } = setup();

    await act(async () => {
      await view.result.current.changeStatus({ goalId: GOAL_ID, status: "Completed" });
    });

    expect(success).toHaveBeenCalledWith("Đã đánh dấu Hoàn thành «Doanh số quý».");
  });

  it("đang chờ ⇒ pendingGoalIds chứa mục tiêu đang đổi; xong ⇒ rỗng", async () => {
    const pending = deferred<GoalCoreResponseDto>();
    mockUpdateGoal.mockReturnValue(pending.promise);
    const { view } = setup();

    act(() => {
      void view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
    });
    await waitFor(() => expect(view.result.current.pendingGoalIds.has(GOAL_ID)).toBe(true));

    await act(async () => {
      pending.resolve(makeGoal({ status: "Active" }));
      await pending.promise;
    });
    await waitFor(() => expect(view.result.current.pendingGoalIds.size).toBe(0));
  });

  it("hai lần đổi song song trên CÙNG hook ⇒ cả hai mục tiêu đều đang chờ; xong một ⇒ mục kia vẫn chờ", async () => {
    const first = deferred<GoalCoreResponseDto>();
    const second = deferred<GoalCoreResponseDto>();
    mockUpdateGoal.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { view } = setup();

    act(() => {
      void view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
      void view.result.current.changeStatus({ goalId: OTHER_ID, status: "Completed" });
    });
    await waitFor(() => expect(view.result.current.pendingGoalIds.has(OTHER_ID)).toBe(true));
    expect(view.result.current.pendingGoalIds.has(GOAL_ID)).toBe(true);

    await act(async () => {
      first.resolve(makeGoal({ status: "Active" }));
      await first.promise;
    });
    await waitFor(() => expect(view.result.current.pendingGoalIds.has(GOAL_ID)).toBe(false));
    expect(view.result.current.pendingGoalIds.has(OTHER_ID)).toBe(true);

    await act(async () => {
      second.resolve(makeGoal({ id: OTHER_ID, status: "Completed" }));
      await second.promise;
    });
    await waitFor(() => expect(view.result.current.pendingGoalIds.size).toBe(0));
  });
});

describe("useGoalStatusMutation({ notify: false }) — kích hoạt hàng loạt tự tổng kết", () => {
  function setupSilent() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    client.setQueryData(goalKeys.detail(GOAL_ID), makeGoal());
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    );
    const view = renderHook(() => useGoalStatusMutation({ notify: false }), { wrapper });
    const detailStatus = () =>
      client.getQueryData<GoalCoreResponseDto>(goalKeys.detail(GOAL_ID))?.status;
    return { view, detailStatus };
  }

  it("bị từ chối ⇒ vẫn rollback, KHÔNG toast từng mục, settleStatus trả lỗi gốc", async () => {
    const error = vi.spyOn(toast, "error");
    const forbidden = new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
    mockUpdateGoal.mockRejectedValue(forbidden);
    const { view, detailStatus } = setupSilent();

    let settled: unknown;
    await act(async () => {
      settled = await view.result.current.settleStatus({ goalId: GOAL_ID, status: "Active" });
    });

    expect(settled).toEqual({ ok: false, error: forbidden });
    expect(detailStatus()).toBe("Draft");
    expect(error).not.toHaveBeenCalled();
  });

  it("thành công ⇒ KHÔNG toast từng mục, settleStatus trả mục tiêu đã lưu", async () => {
    const success = vi.spyOn(toast, "success");
    const saved = makeGoal({ status: "Active" });
    mockUpdateGoal.mockResolvedValue(saved);
    const { view } = setupSilent();

    let settled: unknown;
    await act(async () => {
      settled = await view.result.current.settleStatus({ goalId: GOAL_ID, status: "Active" });
    });

    expect(settled).toEqual({ ok: true, goal: saved });
    expect(success).not.toHaveBeenCalled();
  });
});

describe("useGoalStatusMutation — trạng thái cũ trong cache phải hợp lệ", () => {
  it("cache chi tiết giữ giá trị lạ ⇒ rollback dùng trạng thái HỢP LỆ từ cache khác, không chép giá trị lạ", async () => {
    const pending = deferred<GoalCoreResponseDto>();
    mockUpdateGoal.mockReturnValue(pending.promise);
    const { client, view, detailStatus, meStatuses } = setup();
    // Dữ liệu lạ (không thuộc GoalStatusDto) — chỉ ép kiểu để dựng ca, không phải dạng server trả.
    client.setQueryData(goalKeys.detail(GOAL_ID), {
      ...makeGoal(),
      status: "Archived" as unknown as GoalCoreResponseDto["status"],
    });

    act(() => {
      void view.result.current.changeStatus({ goalId: GOAL_ID, status: "Active" });
    });
    await waitFor(() => expect(detailStatus()).toBe("Active"));

    await act(async () => {
      pending.reject(new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }));
      await pending.promise.catch(() => undefined);
    });

    await waitFor(() => expect(meStatuses()).toEqual(["Draft", "Active"]));
    expect(detailStatus()).toBe("Draft");
  });
});

describe("patchGoalStatusInCache — thuần, không sửa tại chỗ", () => {
  it("một mục tiêu · mảng · trang {items} ⇒ bản sao đổi đúng mục tiêu", () => {
    const one = makeGoal();
    const list = [makeGoal(), makeGoal({ id: OTHER_ID })];
    const page = { items: list, meta: { total: 2 } };

    expect(patchGoalStatusInCache(one, GOAL_ID, "Active")).toMatchObject({ status: "Active" });
    expect(one.status).toBe("Draft");

    const patchedList = patchGoalStatusInCache(list, GOAL_ID, "Active") as GoalCoreResponseDto[];
    expect(patchedList.map((g) => g.status)).toEqual(["Active", "Draft"]);
    expect(list[0]?.status).toBe("Draft");

    const patchedPage = patchGoalStatusInCache(page, GOAL_ID, "Active") as typeof page;
    expect(patchedPage.items[0]?.status).toBe("Active");
    expect(patchedPage.meta).toBe(page.meta);
  });

  it("không chứa mục tiêu đó / dữ liệu lạ ⇒ trả NGUYÊN tham chiếu", () => {
    const list = [makeGoal({ id: OTHER_ID })];
    expect(patchGoalStatusInCache(list, GOAL_ID, "Active")).toBe(list);
    expect(patchGoalStatusInCache(undefined, GOAL_ID, "Active")).toBeUndefined();
    expect(patchGoalStatusInCache("x", GOAL_ID, "Active")).toBe("x");
  });
});
