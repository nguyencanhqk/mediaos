/**
 * tasks-api — contract/URL boundary tests (S4-FE-REGISTRY-1).
 *
 * KHÔNG mock tasksApi; chỉ mock apiFetch tại ranh giới `./api-client` (đúng pattern attendance-api.spec.ts)
 * để kiểm chứng mỗi method gọi ĐÚNG path controller (KHÔNG forward company_id) + truyền schema Zod
 * (arg 2) khớp contract task.ts. List endpoint = z.array(schema) (mảng trần theo service, KHÔNG envelope).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tasksApi } from "./tasks-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [
  string,
  { parse: (v: unknown) => unknown },
  { method?: string; body?: string }?,
] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
});

describe("tasksApi — URL + schema boundary (KHÔNG company_id)", () => {
  it("getMyTasks → GET /tasks + validator z.array (nhận [] OK)", async () => {
    await tasksApi.getMyTasks();
    const [url, schema] = lastCall();
    expect(url).toBe("/tasks");
    expect(url).not.toContain("company");
    expect(schema.parse([])).toEqual([]);
  });

  it("getBoard → GET /tasks/board + query (không company_id)", async () => {
    await tasksApi.getBoard({ status: "in_progress", limit: 20 });
    const [url, schema] = lastCall();
    expect(url).toContain("/tasks/board");
    expect(url).toContain("status=in_progress");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("company");
    expect(schema.parse([])).toEqual([]);
  });

  it("getProjectTasks → GET /tasks/by-project/:projectId", async () => {
    await tasksApi.getProjectTasks(PROJECT_ID);
    const [url, schema] = lastCall();
    expect(url).toContain(`/tasks/by-project/${PROJECT_ID}`);
    expect(schema.parse([])).toEqual([]);
  });

  it("createTask → POST /tasks với body JSON", async () => {
    await tasksApi.createTask({ title: "Việc mới", taskType: "office" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/tasks");
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts!.body!)).toMatchObject({ title: "Việc mới" });
  });

  it("updateStatus → PATCH /tasks/:id/status với status trong body", async () => {
    await tasksApi.updateStatus(TASK_ID, "completed");
    const [url, , opts] = lastCall();
    expect(url).toBe(`/tasks/${TASK_ID}/status`);
    expect(opts?.method).toBe("PATCH");
    expect(JSON.parse(opts!.body!)).toEqual({ status: "completed" });
  });

  it("getComments → GET /tasks/:id/comments + z.array", async () => {
    await tasksApi.getComments(TASK_ID);
    const [url, schema] = lastCall();
    expect(url).toBe(`/tasks/${TASK_ID}/comments`);
    expect(schema.parse([])).toEqual([]);
  });

  it("addComment → POST /tasks/:id/comments", async () => {
    await tasksApi.addComment(TASK_ID, { body: "ghi chú" });
    const [url, , opts] = lastCall();
    expect(url).toBe(`/tasks/${TASK_ID}/comments`);
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts!.body!)).toEqual({ body: "ghi chú" });
  });
});
