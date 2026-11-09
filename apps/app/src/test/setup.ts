import "@testing-library/jest-dom/vitest";
// Khởi tạo i18n (đồng bộ, resources vi nhúng sẵn ở @mediaos/web-core) để `t()` trả đúng
// chuỗi vi trong test — component dùng useTranslation render giống hệt runtime.
import "@/i18n";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { createFetchNetGuard, evaluateGuard, recordProblems } from "./fetch-net-guard";

// S19-QA-FETESTNET-1 — lưới chặn mạng toàn cục. Chi tiết + lý do: `./fetch-net-guard.ts`, docs/plans/S19-QA-FETESTNET-1.md.
const netGuard = createFetchNetGuard();
const recordLog = process.env.FETCH_GUARD === "record" ? process.env.FETCH_GUARD_LOG : undefined;

// Cài ở MỨC MODULE (một lần mỗi tệp spec, TRƯỚC khi spec nạp) — không cài ở beforeEach để không đè `fetch` giả
// mà spec khai ở mức module/beforeAll. Gỡ dòng này ⇒ phép tự kiểm ở afterEach ĐỎ (ca mutant trong fetch-net-guard.spec.ts).
globalThis.fetch = netGuard.guard;

beforeEach(() => {
  netGuard.reset();
});

// Đăng ký TRƯỚC mọi afterEach của spec ⇒ chạy SAU CÙNG (vitest `sequence.hooks: "stack"`): spec đã dọn xong
// (`unstubAllGlobals` trả `fetch` về lưới) thì mới đối chiếu.
afterEach(() => {
  const state = expect.getState();
  const verdict = {
    testFile: state.testPath ?? "?",
    testName: state.currentTestName ?? "?",
    calls: netGuard.calls(),
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
