/**
 * S19-QA-FETESTNET-1 — lưới chặn mạng của suite test (logic THUẦN, không đụng vitest toàn cục).
 *
 * `fetch` toàn cục dưới test = `guard`: luôn từ chối + ghi vào sổ. `setup.ts` cài lưới ở MỨC MODULE (một lần mỗi tệp
 * spec) và đối chiếu ở `afterEach` + `afterAll` bằng `take()` (rút TOÀN BỘ sổ tích luỹ, KHÔNG xoá ở đầu ca) ⇒ lời gọi từ
 * `beforeAll`, giữa các ca, hay sau ca cuối / trong `afterAll` đều bị đối chiếu; mỗi lời gọi mang nhãn ca LÚC GỌI. Spec cần `fetch` giả thì TỰ khai trong file (`vi.stubGlobal("fetch", vi.fn…)`
 * hoặc `vi.spyOn(globalThis, "fetch")`) — lưới chỉ coi `fetch` là hợp lệ khi nó là lưới HOẶC một mock của vitest.
 *
 * Chế độ `FETCH_GUARD=record` (chỉ để ĐO): không làm đỏ, mỗi lời gọi lọt / lần tự kiểm hỏng được nối vào tệp JSONL
 * `FETCH_GUARD_LOG` kèm tên spec + tên ca + URL. Lời gọi vẫn bị từ chối (KHÔNG bao giờ đi ra ngoài tiến trình).
 *
 * Giới hạn: nhãn `during` lấy từ `expect.getState().currentTestName` nên lời gọi giữa các ca mang tên ca VỪA XONG;
 * chỉ phủ `fetch` (socket · `XMLHttpRequest` không đi qua nó).
 */
import { appendFileSync } from "node:fs";

export interface LeakedCall {
  readonly url: string;
  /** Tên ca (hoặc nhãn hook) lúc lời gọi xảy ra — do `setup.ts` cấp; vắng khi không có bộ cấp nhãn. */
  readonly during?: string;
}

export interface FetchNetGuard {
  /** Hàm thế chỗ `fetch`: ghi sổ rồi từ chối. */
  readonly guard: typeof fetch;
  /** Sổ lời gọi lọt chưa được rút (bản sao bất biến). */
  calls(): readonly LeakedCall[];
  /** Rút toàn bộ sổ chưa xét và xoá nó (gọi ở afterEach/afterAll; KHÔNG gọi ở đầu ca). */
  take(): readonly LeakedCall[];
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

export function createFetchNetGuard(label?: () => string): FetchNetGuard {
  let ledger: readonly LeakedCall[] = [];
  const guard = ((input: unknown) => {
    ledger = [...ledger, { url: describeRequestTarget(input), during: label?.() }];
    return Promise.reject(new TypeError("mạng bị chặn trong test (fetch-net-guard)"));
  }) as unknown as typeof fetch;
  return {
    guard,
    calls: () => ledger,
    take: () => {
      const drained = ledger;
      ledger = [];
      return drained;
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
    const urls = input.calls.map((c) => (c.during ? `${c.url} [lúc gọi: ${c.during}]` : c.url)).join(", ");
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

/** Nhãn lúc gọi cho lưới ở setup.ts: ngoài ca (beforeAll/giữa ca/afterAll) vẫn cho nhãn dễ đọc. */
export const OUTSIDE_TEST_LABEL = "(ngoài ca: beforeAll / giữa các ca / afterAll)";

/** Ghi một dòng JSONL khi đo (`FETCH_GUARD=record`). Lỗi ghi tệp KHÔNG nuốt: ném ra để phép đo không im lặng thiếu. */
export function recordProblems(logPath: string, input: GuardVerdictInput): void {
  const lines = input.calls.map((call) =>
    JSON.stringify({ kind: "leak", file: input.testFile, test: input.testName, url: call.url, during: call.during }),
  );
  if (!input.isGuard && !input.isDeclaredMock) {
    lines.push(JSON.stringify({ kind: "selfcheck", file: input.testFile, test: input.testName }));
  }
  // MỘT lời gọi ghi cho mọi dòng của ca ⇒ nhiều worker không xen kẽ giữa dòng.
  if (lines.length > 0) appendFileSync(logPath, lines.map((line) => `${line}\n`).join(""));
}
