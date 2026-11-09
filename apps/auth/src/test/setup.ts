import "@testing-library/jest-dom/vitest";
// Khởi tạo i18n dùng chung của @mediaos/web-core (đồng bộ, namespace common/nav/auth nhúng sẵn) để `t()` trả
// đúng chuỗi vi trong test — apps/auth chỉ dùng namespace `auth`/`common`, không khai feature namespace riêng.
import "@mediaos/web-core";
import { afterAll, afterEach, expect, vi } from "vitest";
import {
  createFetchNetGuard,
  evaluateGuard,
  OUTSIDE_TEST_LABEL,
  recordProblems,
} from "./fetch-net-guard";

// S19-QA-FETESTNET-1 — lưới chặn mạng toàn cục. Chi tiết + lý do: `./fetch-net-guard.ts`, docs/plans/S19-QA-FETESTNET-1.md.
const netGuard = createFetchNetGuard(() => expect.getState().currentTestName ?? OUTSIDE_TEST_LABEL);
const recordLog = process.env.FETCH_GUARD === "record" ? process.env.FETCH_GUARD_LOG : undefined;

// Cài ở MỨC MODULE (một lần mỗi tệp spec, TRƯỚC khi spec nạp) — không cài ở beforeEach để không đè `fetch` giả
// mà spec khai ở mức module/beforeAll. Gỡ dòng này ⇒ phép tự kiểm ở afterEach ĐỎ (ca mutant trong fetch-net-guard.spec.ts).
globalThis.fetch = netGuard.guard;

// Đăng ký TRƯỚC mọi afterEach của spec ⇒ chạy SAU CÙNG (vitest `sequence.hooks: "stack"`): spec đã dọn xong
// (`unstubAllGlobals` trả `fetch` về lưới) thì mới đối chiếu.
afterEach(() => {
  const state = expect.getState();
  const verdict = {
    testFile: state.testPath ?? "?",
    testName: state.currentTestName ?? "?",
    calls: netGuard.take(),
    currentFetch: globalThis.fetch,
    isGuard: netGuard.isGuard(globalThis.fetch),
    isDeclaredMock: vi.isMockFunction(globalThis.fetch),
  };
  if (recordLog) {
    recordProblems(recordLog, verdict);
    return;
  }
  const problems = evaluateGuard(verdict);
  if (problems.length > 0) throw new Error(problems.join("\n"));
});

// Lời gọi bắn SAU afterEach của ca cuối (cleanup/timer) hoặc từ chính afterAll của spec: chạy SAU CÙNG (hook "stack").
afterAll(() => {
  const calls = netGuard.take();
  if (calls.length === 0) return;
  const verdict = {
    testFile: expect.getState().testPath ?? "?",
    testName: "(afterAll)",
    calls,
    currentFetch: globalThis.fetch,
    isGuard: true,
    isDeclaredMock: false,
  };
  if (recordLog) {
    recordProblems(recordLog, verdict);
    return;
  }
  throw new Error(evaluateGuard(verdict).join("\n"));
});
