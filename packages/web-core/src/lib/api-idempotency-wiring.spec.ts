/**
 * S5-BE-CONTRACT-1 (WS-D §13.2) — KHẲNG ĐỊNH DÂY NỐI idempotency: đúng những mutation mà
 * IMPLEMENTATION-08 §13.2 liệt kê PHẢI gửi header `Idempotency-Key`, và khoá phải ỔN ĐỊNH giữa các lần
 * thử lại của cùng một thao tác.
 *
 * TẠI SAO test ở TẦNG `fetch` chứ không mock `apiFetch`: bug thật của lớp này là "gắn opts nhưng header
 * không tới nơi" (hoặc gắn nhầm tham số thứ 3 thay vì thứ 4). Mock `apiFetch` sẽ XANH GIẢ với đúng bug
 * đó. Ở đây mock `globalThis.fetch` để đọc header THỰC SỰ được gửi.
 */
import { IDEMPOTENCY_HEADER } from "@mediaos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceApi } from "./attendance-api";
import { hrApi } from "./hr-api";
import { leaveApi } from "./leave-api";
import { taskCoreApi } from "./task-core-api";

/** Envelope thành công tối thiểu — `data` để rỗng vì test chỉ quan tâm HEADER đã gửi. */
function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ success: true, message: "OK", data, error: null, meta: {} }),
    text: async () => "",
  } as unknown as Response;
}

/** Header của lần fetch thứ `index` (mặc định lần cuối). */
function headersOf(index = -1): Record<string, string> {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const call = calls.at(index);
  return (call?.[1] as { headers?: Record<string, string> })?.headers ?? {};
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Payload tối thiểu cho từng mutation §13.2 + hàm gọi. `data` trả về được nới lỏng (schema Zod của mỗi
 * endpoint khác nhau) — mọi lời gọi đều bọc try/catch vì test CHỈ quan tâm request đã gửi gì.
 */
const MUTATIONS: { name: string; run: () => Promise<unknown> }[] = [
  {
    name: "check-in",
    run: () => attendanceApi.checkIn({ method: "web", location: null } as never),
  },
  {
    name: "check-out",
    run: () => attendanceApi.checkOut({ method: "web", location: null } as never),
  },
  {
    name: "tạo đơn nghỉ",
    run: () => leaveApi.createDraft({ leaveTypeId: "lt-1", fromDate: "2026-08-01" } as never),
  },
  { name: "duyệt đơn nghỉ", run: () => leaveApi.approveRequest("req-1", "ok") },
  { name: "từ chối đơn nghỉ", run: () => leaveApi.rejectRequest("req-1", "không hợp lệ") },
  { name: "tạo task", run: () => taskCoreApi.createTask({ title: "việc mới" } as never) },
  { name: "tạo nhân viên", run: () => hrApi.createEmployee({ fullName: "Nguyễn Văn A" } as never) },
];

describe("Idempotency-Key đã nối vào mutation §13.2", () => {
  it.each(MUTATIONS)("$name gửi header Idempotency-Key", async ({ run }) => {
    fetchMock.mockResolvedValue(okResponse({}));
    await run().catch(() => undefined); // lỗi Zod ở response KHÔNG ảnh hưởng: request đã bay
    const key = headersOf()[IDEMPOTENCY_HEADER];
    expect(key, `thiếu header ${IDEMPOTENCY_HEADER}`).toBeTruthy();
    expect(key.length).toBeLessThanOrEqual(200);
  });

  it("thử lại CÙNG payload → CÙNG khoá (điều kiện để server phát lại thay vì tạo bản ghi thứ 2)", async () => {
    fetchMock.mockResolvedValue(okResponse({}));
    const body = { leaveTypeId: "lt-1", fromDate: "2026-08-01", toDate: "2026-08-02" } as never;
    await leaveApi.createDraft(body).catch(() => undefined);
    await leaveApi.createDraft(body).catch(() => undefined);
    expect(headersOf(-1)[IDEMPOTENCY_HEADER]).toBe(headersOf(-2)[IDEMPOTENCY_HEADER]);
  });

  it("thao tác KHÁC → khoá khác (không nuốt nhầm đơn thứ hai hợp lệ)", async () => {
    fetchMock.mockResolvedValue(okResponse({}));
    await leaveApi
      .createDraft({ leaveTypeId: "lt-1", fromDate: "2026-08-01" } as never)
      .catch(() => undefined);
    await leaveApi
      .createDraft({ leaveTypeId: "lt-1", fromDate: "2026-09-15" } as never)
      .catch(() => undefined);
    expect(headersOf(-1)[IDEMPOTENCY_HEADER]).not.toBe(headersOf(-2)[IDEMPOTENCY_HEADER]);
  });

  it("duyệt HAI đơn khác nhau → khoá khác (khoá phải gồm id đơn, không chỉ tên thao tác)", async () => {
    fetchMock.mockResolvedValue(okResponse({}));
    await leaveApi.approveRequest("req-1").catch(() => undefined);
    await leaveApi.approveRequest("req-2").catch(() => undefined);
    expect(headersOf(-1)[IDEMPOTENCY_HEADER]).not.toBe(headersOf(-2)[IDEMPOTENCY_HEADER]);
  });

  it("KHÔNG gắn header cho endpoint đọc (không bơm cache vô ích)", async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    await leaveApi.listTypes().catch(() => undefined);
    expect(headersOf()[IDEMPOTENCY_HEADER]).toBeUndefined();
  });
});
