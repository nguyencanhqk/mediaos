/**
 * task-file-api.spec.ts — contract/URL boundary tests (S4-FE-TASK-4).
 *
 * Mock `apiFetch`/`apiFetchBlob` tại ranh giới `./api-client` (mirror employee-file-api.spec.ts) để kiểm
 * chứng taskFileApi gọi ĐÚNG path + method + body cho list/delete/download, và ĐÚNG chuỗi 4 pha
 * (register → PUT XHR → confirm → link) cho upload — mỗi pha lỗi phải chặn pha sau (KHÔNG silent-failure).
 * XMLHttpRequest được stub qua vi.stubGlobal (Vitest env "node" không có XHR built-in).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { taskFileApi } from "./task-file-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn(), apiFetchBlob: vi.fn() };
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
  expiresAt: "2026-07-13T00:10:00.000Z",
};

const CONFIRM_RESPONSE = {
  fileId: REGISTER_RESPONSE.fileId,
  uploadStatus: "Uploaded",
  sizeBytes: 10,
};

const TASK_FILE_DTO = {
  linkId: "22222222-2222-2222-2222-222222222222",
  fileId: REGISTER_RESPONSE.fileId,
  originalName: "spec.pdf",
  mimeType: "application/pdf",
  sizeBytes: 10,
  scanStatus: "NotRequired",
  uploadStatus: "Uploaded",
  uploadedAt: "2026-07-13T00:00:00.000Z",
  category: "Spec",
};

function makeFile(bytes = "hello", name = "spec.pdf", type = "application/pdf"): File {
  return new File([bytes], name, { type });
}

describe("taskFileApi", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetchBlob).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getTaskFiles(taskId) → GET /tasks/:taskId/files (không query)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([TASK_FILE_DTO] as never);
    await taskFileApi.getTaskFiles("task-1");
    const [url, , init] = lastCall();
    expect(url).toBe("/tasks/task-1/files");
    expect(init).toBeUndefined();
  });

  it("getTaskFiles(taskId, {category}) → gắn query string", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
    await taskFileApi.getTaskFiles("task-1", { category: "Spec" });
    const [url] = lastCall();
    expect(url).toBe("/tasks/task-1/files?category=Spec");
  });

  it("deleteTaskFile(taskId, fileId) → DELETE /tasks/:taskId/files/:fileId", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
    await taskFileApi.deleteTaskFile("task-1", "file-1");
    const [url, , init] = lastCall();
    expect(url).toBe("/tasks/task-1/files/file-1");
    expect(init?.method).toBe("DELETE");
  });

  it("downloadTaskFile(taskId, fileId) → apiFetchBlob (KHÔNG apiFetch) tới GET .../download", async () => {
    vi.mocked(apiClient.apiFetchBlob).mockResolvedValue({
      blob: new Blob(["x"]),
      filename: "spec.pdf",
    });
    await taskFileApi.downloadTaskFile("task-1", "file-1");
    expect(apiClient.apiFetchBlob).toHaveBeenCalledWith("/tasks/task-1/files/file-1/download");
    expect(apiClient.apiFetch).not.toHaveBeenCalled();
  });

  // ── Upload: chuỗi 4 pha ĐÚNG thứ tự + đúng payload ─────────────────────────────
  it("uploadTaskFile: register → PUT (XHR) → confirm → link, đúng thứ tự + payload (moduleCode=TASK)", async () => {
    stubXhr({ status: 200 });
    vi.mocked(apiClient.apiFetch)
      .mockResolvedValueOnce(REGISTER_RESPONSE as never) // (1) register
      .mockResolvedValueOnce(CONFIRM_RESPONSE as never) // (3) confirm
      .mockResolvedValueOnce(TASK_FILE_DTO as never); // (4) link

    const file = makeFile();
    const onProgress = vi.fn();
    const result = await taskFileApi.uploadTaskFile("task-1", file, {
      category: "Spec",
      onProgress,
    });

    expect(result).toEqual(TASK_FILE_DTO);

    const calls = vi.mocked(apiClient.apiFetch).mock.calls;
    expect(calls).toHaveLength(3);

    // (1) register
    expect(calls[0][0]).toBe("/foundation/files/upload");
    const registerBody = JSON.parse((calls[0][2] as { body: string }).body);
    expect(registerBody).toMatchObject({
      originalName: "spec.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: 5,
      visibility: "Private",
      moduleCode: "TASK",
      entityType: "task",
      entityId: "task-1",
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
    expect(calls[2][0]).toBe("/tasks/task-1/files");
    expect(JSON.parse((calls[2][2] as { body: string }).body)).toEqual({
      fileId: REGISTER_RESPONSE.fileId,
      category: "Spec",
    });
  });

  it("uploadTaskFile: register thất bại (403 file-upload:task) → KHÔNG PUT/confirm/link", async () => {
    stubXhr();
    vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
      new apiClient.ApiError(403, "AUTH-ERR-FORBIDDEN", "forbidden"),
    );

    await expect(taskFileApi.uploadTaskFile("task-1", makeFile())).rejects.toThrow();

    expect(vi.mocked(apiClient.apiFetch)).toHaveBeenCalledTimes(1);
    expect(MockXhr.instances).toHaveLength(0);
  });

  it("uploadTaskFile: PUT bytes thất bại (network/HTTP lỗi) → KHÔNG gọi confirm/link", async () => {
    stubXhr({ networkError: true });
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(REGISTER_RESPONSE as never);

    await expect(taskFileApi.uploadTaskFile("task-1", makeFile())).rejects.toThrow();

    expect(vi.mocked(apiClient.apiFetch)).toHaveBeenCalledTimes(1);
  });

  it("uploadTaskFile: confirm thất bại (409 scan/size mismatch) → KHÔNG gọi link", async () => {
    stubXhr({ status: 200 });
    vi.mocked(apiClient.apiFetch)
      .mockResolvedValueOnce(REGISTER_RESPONSE as never)
      .mockRejectedValueOnce(
        new apiClient.ApiError(409, "FOUNDATION-FILE-ERR-CONFIRM-MISMATCH", "mismatch"),
      );

    await expect(taskFileApi.uploadTaskFile("task-1", makeFile())).rejects.toThrow();

    expect(vi.mocked(apiClient.apiFetch)).toHaveBeenCalledTimes(2);
  });
});
