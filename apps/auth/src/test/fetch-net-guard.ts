/**
 * S19-QA-FETESTNET-1 — lưới chặn mạng của suite test (logic THUẦN, không đụng vitest toàn cục).
 *
 * `fetch` toàn cục dưới test = `guard`: luôn từ chối + ghi vào sổ. `setup.ts` cài lưới ở `beforeEach` và đối chiếu ở
 * `afterEach` (xem `assertCleanAfterTest`). Spec cần `fetch` giả thì TỰ khai trong file (`vi.stubGlobal("fetch", vi.fn…)`
 * hoặc `vi.spyOn(globalThis, "fetch")`) — lưới chỉ coi `fetch` là hợp lệ khi nó là lưới HOẶC một mock của vitest.
 *
 * Chế độ `FETCH_GUARD=record` (chỉ để ĐO): không làm đỏ, mỗi lời gọi lọt / lần tự kiểm hỏng được nối vào tệp JSONL
 * `FETCH_GUARD_LOG` kèm tên spec + tên ca + URL. Lời gọi vẫn bị từ chối (KHÔNG bao giờ đi ra ngoài tiến trình).
 *
 * Giới hạn: chỉ phủ `fetch` (socket · `XMLHttpRequest` không đi qua nó).
 */
import { appendFileSync } from "node:fs";

export interface LeakedCall {
  readonly url: string;
}

export interface FetchNetGuard {
  /** Hàm thế chỗ `fetch`: ghi sổ rồi từ chối. */
  readonly guard: typeof fetch;
  /** Sổ lời gọi lọt kể từ lần `reset()` gần nhất (bản sao bất biến). */
  calls(): readonly LeakedCall[];
  reset(): void;
  /** `fetch` hiện tại có phải lưới này không. */
  isGuard(candidate: unknown): boolean;
}

export function describeRequestTarget(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

export function createFetchNetGuard(): FetchNetGuard {
  let ledger: readonly LeakedCall[] = [];
  const guard = ((input: unknown) => {
    ledger = [...ledger, { url: describeRequestTarget(input) }];
    return Promise.reject(new TypeError("mạng bị chặn trong test (fetch-net-guard)"));
  }) as unknown as typeof fetch;
  return {
    guard,
    calls: () => ledger,
    reset: () => {
      ledger = [];
    },
    isGuard: (candidate) => candidate === guard,
  };
}

export interface GuardVerdictInput {
  readonly testFile: string;
  readonly testName: string;
  readonly calls: readonly LeakedCall[];
  /** `fetch` toàn cục lúc kết thúc ca. */
  readonly currentFetch: unknown;
  readonly isGuard: boolean;
  /** `fetch` có phải mock của vitest (spec tự khai) hay không. */
  readonly isDeclaredMock: boolean;
}

/** Trả danh sách lỗi (rỗng = sạch). Thuần: không ném, không đọc toàn cục ⇒ thử được bằng spec dò. */
export function evaluateGuard(input: GuardVerdictInput): readonly string[] {
  const where = `${input.testFile} › ${input.testName}`;
  const problems: string[] = [];
  if (input.calls.length > 0) {
    const urls = input.calls.map((c) => c.url).join(", ");
    problems.push(
      `fetch-net-guard: ca để lọt ${input.calls.length} lời gọi mạng chưa mock — ${where} — URL: ${urls}. ` +
        `Cách sửa: mock đúng hàm API/hook mà component gọi (vi.mock), hoặc tự khai fetch giả trong spec ` +
        `(vi.stubGlobal("fetch", vi.fn(...))). KHÔNG nới lưới.`,
    );
  }
  if (!input.isGuard && !input.isDeclaredMock) {
    problems.push(
      `fetch-net-guard TỰ KIỂM HỎNG: fetch toàn cục không còn là lưới và cũng không phải mock do spec khai — ${where}. ` +
        `Lưới chưa được cài (setup.ts) hoặc một spec đã gán đè fetch bằng hàm thật; dùng vi.stubGlobal với vi.fn().`,
    );
  }
  return problems;
}

/** Ghi một dòng JSONL khi đo (`FETCH_GUARD=record`). Lỗi ghi tệp KHÔNG nuốt: ném ra để phép đo không im lặng thiếu. */
export function recordProblems(logPath: string, input: GuardVerdictInput): void {
  const lines = input.calls.map((call) =>
    JSON.stringify({ kind: "leak", file: input.testFile, test: input.testName, url: call.url }),
  );
  if (!input.isGuard && !input.isDeclaredMock) {
    lines.push(JSON.stringify({ kind: "selfcheck", file: input.testFile, test: input.testName }));
  }
  // MỘT lời gọi ghi cho mọi dòng của ca ⇒ nhiều worker không xen kẽ giữa dòng.
  if (lines.length > 0) appendFileSync(logPath, lines.map((line) => `${line}\n`).join(""));
}
