/**
 * S20-GOAL-BULKACTIVATE-1 (US-GOAL-QL-11) — chạy lô kích hoạt THUẦN: mỗi mục một lời gọi, giới hạn đồng
 * thời, báo theo dòng (thành công · bị từ chối · chưa xử lý). Ca lỗi một phần + mất mạng viết TRƯỚC.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@mediaos/web-core";
import {
  GOAL_BULK_ACTIVATE_CONCURRENCY,
  bulkActivateToast,
  draftGoalIds,
  runGoalBulkActivate,
  type GoalBulkSettled,
} from "./goal-bulk-activate";

const IDS = ["g-1", "g-2", "g-3", "g-4", "g-5", "g-6"] as const;
const OK: GoalBulkSettled = { ok: true };
const FORBIDDEN = new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
const FINALIZED = new ApiError({ status: 422, code: "GOAL-ERR-005", message: "Goal finalized" });
const OFFLINE = new TypeError("Failed to fetch");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Nhường hết microtask để worker kế tiếp kịp nhận mục mới. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** t giả: trả khoá + tham số để so sánh thông điệp mà không phụ thuộc bản dịch. */
const fakeT = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;
const reasonOf = (error: unknown) =>
  error instanceof ApiError && error.status === 403 ? "không có quyền" : "đã chốt";

describe("runGoalBulkActivate — lỗi một phần (TC2)", () => {
  it("1/6 bị 403 ⇒ 5 thành công, dòng đó báo bị từ chối kèm lỗi, không mục nào «chưa xử lý»", async () => {
    const activate = vi.fn((id: string) =>
      Promise.resolve<GoalBulkSettled>(id === "g-4" ? { ok: false, error: FORBIDDEN } : OK),
    );

    const result = await runGoalBulkActivate(IDS, activate);

    expect(result.activated).toEqual(["g-1", "g-2", "g-3", "g-5", "g-6"]);
    expect(result.rejected).toEqual([{ goalId: "g-4", error: FORBIDDEN }]);
    expect(result.unprocessed).toEqual([]);
    expect(activate).toHaveBeenCalledTimes(6);
  });

  it("mọi mục bị từ chối (đã chốt) ⇒ 0 thành công, KHÔNG thành công giả", async () => {
    const result = await runGoalBulkActivate(["g-1", "g-2"], () =>
      Promise.resolve<GoalBulkSettled>({ ok: false, error: FINALIZED }),
    );
    expect(result.activated).toEqual([]);
    expect(result.rejected.map((r) => r.goalId)).toEqual(["g-1", "g-2"]);
  });
});

describe("runGoalBulkActivate — mất mạng giữa chừng (TC5)", () => {
  it("lỗi kết nối ⇒ dừng gửi tiếp; mục lỗi + mục chưa gửi là «chưa xử lý», chỉ mục server xác nhận là thành công", async () => {
    const pending = new Map(IDS.map((id) => [id, deferred<GoalBulkSettled>()]));
    const activate = vi.fn((id: string) => pending.get(id as (typeof IDS)[number])!.promise);

    const run = runGoalBulkActivate(IDS, activate, { concurrency: 2 });
    await flush();
    expect(activate.mock.calls.map(([id]) => id)).toEqual(["g-1", "g-2"]);

    pending.get("g-1")!.resolve(OK);
    await flush();
    expect(activate.mock.calls.map(([id]) => id)).toEqual(["g-1", "g-2", "g-3"]);

    pending.get("g-3")!.resolve({ ok: false, error: OFFLINE });
    await flush();
    pending.get("g-2")!.resolve(OK);
    const result = await run;

    expect(activate).toHaveBeenCalledTimes(3);
    expect(result.activated).toEqual(["g-1", "g-2"]);
    expect(result.rejected).toEqual([]);
    expect(result.unprocessed).toEqual(["g-3", "g-4", "g-5", "g-6"]);
  });

  it("ApiError kind NETWORK cũng là mất kết nối", async () => {
    const network = new ApiError({ status: 0, kind: "NETWORK", message: "offline" });
    const result = await runGoalBulkActivate(["g-1", "g-2"], () =>
      Promise.resolve<GoalBulkSettled>({ ok: false, error: network }),
    );
    expect(result.unprocessed).toEqual(["g-1", "g-2"]);
    expect(result.rejected).toEqual([]);
  });

  it("hàm kích hoạt NÉM (trái hợp đồng) ⇒ coi như mất kết nối, không nuốt thành công", async () => {
    const result = await runGoalBulkActivate(["g-1"], () => Promise.reject(OFFLINE));
    expect(result.activated).toEqual([]);
    expect(result.unprocessed).toEqual(["g-1"]);
  });
});

describe("runGoalBulkActivate — giới hạn đồng thời", () => {
  it(`mặc định không quá ${GOAL_BULK_ACTIVATE_CONCURRENCY} lời gọi cùng lúc, mỗi mục ĐÚNG một lần`, async () => {
    let inFlight = 0;
    let peak = 0;
    const activate = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await flush();
      inFlight -= 1;
      return OK;
    });
    const many = Array.from({ length: 10 }, (_v, i) => `g-${i}`);

    const result = await runGoalBulkActivate([...many, "g-0"], activate);

    expect(peak).toBe(GOAL_BULK_ACTIVATE_CONCURRENCY);
    expect(activate).toHaveBeenCalledTimes(10);
    expect(result.activated).toEqual(many);
  });

  it("báo tiến độ sau mỗi mục xong", async () => {
    const onProgress = vi.fn();
    await runGoalBulkActivate(["g-1", "g-2"], () => Promise.resolve(OK), { onProgress });
    expect(onProgress.mock.calls).toEqual([[1], [2]]);
  });
});

describe("draftGoalIds — chọn lẫn trạng thái (TC4)", () => {
  it("chỉ lấy mục Draft, giữ thứ tự", () => {
    expect(
      draftGoalIds([
        { id: "a", status: "Draft" },
        { id: "b", status: "Active" },
        { id: "c", status: "Draft" },
        { id: "d", status: "Completed" },
      ]),
    ).toEqual(["a", "c"]);
  });
});

describe("bulkActivateToast — thông điệp tổng kết, không thành công giả", () => {
  it("6/6 ⇒ success «allDone» với count 6", () => {
    expect(
      bulkActivateToast({ activated: [...IDS], rejected: [], unprocessed: [] }, reasonOf, fakeT),
    ).toEqual({ variant: "success", message: 'bulkActivate.toast.allDone {"count":6}' });
  });

  it("5 thành công + 1 lỗi ⇒ warning kèm lý do; lý do trùng chỉ ghi một lần", () => {
    const toast = bulkActivateToast(
      {
        activated: ["g-1", "g-2", "g-3", "g-4"],
        rejected: [
          { goalId: "g-5", error: FORBIDDEN },
          { goalId: "g-6", error: FORBIDDEN },
        ],
        unprocessed: [],
      },
      reasonOf,
      fakeT,
    );
    expect(toast).toEqual({
      variant: "warning",
      message: 'bulkActivate.toast.partial {"ok":4,"failed":2,"reason":"không có quyền"}',
    });
  });

  it("0 thành công ⇒ error", () => {
    expect(
      bulkActivateToast(
        { activated: [], rejected: [{ goalId: "g-1", error: FINALIZED }], unprocessed: [] },
        reasonOf,
        fakeT,
      ).variant,
    ).toBe("error");
  });

  it("có mục chưa xử lý ⇒ thông điệp mất kết nối kèm số dòng chưa xử lý, KHÔNG success", () => {
    const toast = bulkActivateToast(
      { activated: ["g-1"], rejected: [], unprocessed: ["g-2", "g-3"] },
      reasonOf,
      fakeT,
    );
    expect(toast).toEqual({
      variant: "warning",
      message: 'bulkActivate.toast.unprocessed {"ok":1,"failed":0,"unprocessed":2}',
    });
  });
});
