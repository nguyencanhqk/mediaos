/**
 * employee-file-api.spec.ts — contract/URL boundary tests (S2-FE-HR-9).
 *
 * Mock `apiFetch` tại ranh giới `./api-client` (cùng pattern hr-employee-code-config-api.spec.ts) để
 * kiểm chứng employeeFilesApi gọi ĐÚNG path + method + body cho list/delete, và ĐÚNG chuỗi 4 pha
 * (register → PUT XHR → confirm → link) cho upload — mỗi pha lỗi phải chặn pha sau (KHÔNG silent-failure).
 * XMLHttpRequest được stub qua vi.stubGlobal (Vitest env "node" không có XHR built-in).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { employeeFilesApi } from "./employee-file-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [string, unknown, { method?: string; body?: string }?] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

// ── Mock XMLHttpRequest (pha PUT bytes) ─────────────────────────────────────────

interface MockXhrOptions {
  status?: number;
  networkError?: boolean;
}

class MockXhr {
  static instances: MockXhr[] = [];
  status = 200;
  upload = {
    onprogress: null as
      | ((evt: { lengthComputable: boolean; loaded: number; total: number }) => void)
      | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private headers: Record<string, string> = {};
  private opts: MockXhrOptions;
  method = "";
  url = "";
  sentBody: unknown;

  constructor(opts: MockXhrOptions = {}) {
    this.opts = opts;
    this.status = opts.status ?? 200;
    MockXhr.instances.push(this);
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }
  getHeader(key: string): string | undefined {
    return this.headers[key];
  }
  abort(): void {
    this.onabort?.();
  }
  send(body: unknown): void {
    this.sentBody = body;
    // Simulate progress then completion asynchronously (matches real XHR behaviour).
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
      if (this.opts.networkError) {
        this.onerror?.();
        return;
      }
      this.onload?.();
    });
  }
}

function stubXhr(opts: MockXhrOptions = {}): void {
  MockXhr.instances = [];
  vi.stubGlobal(
    "XMLHttpRequest",
    class extends MockXhr {
      constructor() {
        super(opts);
      }
    },
  );
}

const REGISTER_RESPONSE = {
  fileId: "11111111-1111-1111-1111-111111111111",
  uploadStatus: "Pending",
  uploadUrl: "https://storage.local/presigned-put",
  expiresAt: "2026-07-09T00:10:00.000Z",
};

const CONFIRM_RESPONSE = {
  fileId: REGISTER_RESPONSE.fileId,
  uploadStatus: "Uploaded",
  sizeBytes: 10,
};

const EMPLOYEE_FILE_DTO = {
  linkId: "22222222-2222-2222-2222-222222222222",
  fileId: REGISTER_RESPONSE.fileId,
  originalName: "cccd.pdf",
  mimeType: "application/pdf",
  sizeBytes: 10,
  scanStatus: "NotRequired",
  uploadStatus: "Uploaded",
  uploadedAt: "2026-07-09T00:00:00.000Z",
  category: "CCCD",
};

function makeFile(bytes = "hello", name = "cccd.pdf", type = "application/pdf"): File {
  return new File([bytes], name, { type });
}

describe("employeeFilesApi", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getEmployeeFiles(employeeId) → GET /hr/employees/:id/files (không query)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([EMPLOYEE_FILE_DTO] as never);
    await employeeFilesApi.getEmployeeFiles("emp-1");
    const [url, , init] = lastCall();
    expect(url).toBe("/hr/employees/emp-1/files");
    expect(init).toBeUndefined();
  });

  it("getEmployeeFiles(employeeId, {category}) → gắn query string", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
    await employeeFilesApi.getEmployeeFiles("emp-1", { category: "CCCD" });
    const [url] = lastCall();
    expect(url).toBe("/hr/employees/emp-1/files?category=CCCD");
  });

  it("deleteEmployeeFile(employeeId, fileId) → DELETE /hr/employees/:id/files/:fileId", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
    await employeeFilesApi.deleteEmployeeFile("emp-1", "file-1");
    const [url, , init] = lastCall();
    expect(url).toBe("/hr/employees/emp-1/files/file-1");
    expect(init?.method).toBe("DELETE");
  });

  // ── Upload: chuỗi 4 pha ĐÚNG thứ tự + đúng payload ─────────────────────────────
  it("uploadEmployeeFile: register → PUT (XHR) → confirm → link, đúng thứ tự + payload", async () => {
    stubXhr({ status: 200 });
    vi.mocked(apiClient.apiFetch)
      .mockResolvedValueOnce(REGISTER_RESPONSE as never) // (1) register
      .mockResolvedValueOnce(CONFIRM_RESPONSE as never) // (3) confirm
      .mockResolvedValueOnce(EMPLOYEE_FILE_DTO as never); // (4) link

    const file = makeFile();
    const onProgress = vi.fn();
    const result = await employeeFilesApi.uploadEmployeeFile("emp-1", file, {
      category: "CCCD",
      onProgress,
    });

    expect(result).toEqual(EMPLOYEE_FILE_DTO);

    const calls = vi.mocked(apiClient.apiFetch).mock.calls;
    expect(calls).toHaveLength(3);

    // (1) register
    expect(calls[0][0]).toBe("/foundation/files/upload");
    const registerBody = JSON.parse((calls[0][2] as { body: string }).body);
    expect(registerBody).toMatchObject({
      originalName: "cccd.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: 5,
      visibility: "Private",
      moduleCode: "HR",
      entityType: "employee_profile",
      entityId: "emp-1",
    });

    // (2) PUT to presigned URL with matching Content-Type
    expect(MockXhr.instances).toHaveLength(1);
    expect(MockXhr.instances[0].method).toBe("PUT");
    expect(MockXhr.instances[0].url).toBe(REGISTER_RESPONSE.uploadUrl);
    expect(MockXhr.instances[0].getHeader("Content-Type")).toBe("application/pdf");
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(100);

    // (3) confirm
    expect(calls[1][0]).toBe(`/foundation/files/${REGISTER_RESPONSE.fileId}/confirm`);
    expect(JSON.parse((calls[1][2] as { body: string }).body)).toEqual({});

    // (4) link
    expect(calls[2][0]).toBe("/hr/employees/emp-1/files");
    expect(JSON.parse((calls[2][2] as { body: string }).body)).toEqual({
      fileId: REGISTER_RESPONSE.fileId,
      category: "CCCD",
    });
  });

  it("uploadEmployeeFile: register thất bại (403 upload:foundation-file) → KHÔNG PUT/confirm/link", async () => {
    stubXhr();
    vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
      new apiClient.ApiError(403, "AUTH-ERR-FORBIDDEN", "forbidden"),
    );

    await expect(employeeFilesApi.uploadEmployeeFile("emp-1", makeFile())).rejects.toThrow();

    expect(vi.mocked(apiClient.apiFetch)).toHaveBeenCalledTimes(1);
    expect(MockXhr.instances).toHaveLength(0);
  });

  it("uploadEmployeeFile: PUT bytes thất bại (network/HTTP lỗi) → KHÔNG gọi confirm/link", async () => {
    stubXhr({ networkError: true });
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(REGISTER_RESPONSE as never);

    await expect(employeeFilesApi.uploadEmployeeFile("emp-1", makeFile())).rejects.toThrow();

    // Only the register call happened — confirm/link never fired after PUT failure.
    expect(vi.mocked(apiClient.apiFetch)).toHaveBeenCalledTimes(1);
  });

  it("uploadEmployeeFile: confirm thất bại (409 scan/size mismatch) → KHÔNG gọi link", async () => {
    stubXhr({ status: 200 });
    vi.mocked(apiClient.apiFetch)
      .mockResolvedValueOnce(REGISTER_RESPONSE as never)
      .mockRejectedValueOnce(
        new apiClient.ApiError(409, "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH", "mismatch"),
      );

    await expect(employeeFilesApi.uploadEmployeeFile("emp-1", makeFile())).rejects.toThrow();

    expect(vi.mocked(apiClient.apiFetch)).toHaveBeenCalledTimes(2);
  });
});
