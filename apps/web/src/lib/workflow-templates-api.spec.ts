import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workflowTemplatesApi } from "./workflow-templates-api";
import { ApiError } from "./api-client";

// VITE_WORKFLOW_MOCK chưa set trong test → `workflowTemplatesApi` = client THẬT (nối fetch).

const UUID = "11111111-1111-1111-1111-111111111111";
const STEP_ID = "22222222-2222-2222-2222-222222222222";
const DEP_ID = "33333333-3333-3333-3333-333333333333";

const TEMPLATE = {
  id: UUID,
  companyId: UUID,
  code: "video_standard",
  name: "Video chuẩn",
  appliesTo: "content_item",
  maxApprovalLevel: 1,
  allowParallelSteps: true,
  isActive: true,
  version: 1,
  status: "draft",
  publishedAt: null,
  createdBy: UUID,
  createdAt: "2026-06-01T00:00:00.000Z",
  deletedAt: null,
};

const STEP = {
  id: STEP_ID,
  companyId: UUID,
  workflowDefinitionId: UUID,
  stepOrder: 1,
  code: "script",
  name: "Viết kịch bản",
  assigneeRoleCode: "script_writer",
  reviewerRoleCode: null,
  isRequired: true,
  defaultTaskTitle: "Viết kịch bản",
  nodeKey: "script",
  stepType: "task",
  positionX: 40,
  positionY: 40,
  defaultChecklistId: null,
};

type FetchCall = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall(): FetchCall {
  return fetchMock.mock.calls.at(-1) as FetchCall;
}

describe("workflowTemplatesApi (real client)", () => {
  it("list GETs /workflow-templates and parses the array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([TEMPLATE]));
    const result = await workflowTemplatesApi.list();
    const [url, init] = lastCall();
    expect(url).toContain("/workflow-templates");
    expect(init?.method ?? "GET").toBe("GET");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(UUID);
  });

  it("create POSTs the body to /workflow-templates", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(TEMPLATE));
    await workflowTemplatesApi.create({ code: "video_standard", name: "Video chuẩn", appliesTo: "content_item" });
    const [url, init] = lastCall();
    expect(url).toContain("/workflow-templates");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ code: "video_standard" });
  });

  it("remove DELETEs and tolerates a { id, deleted } body (not 204)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: UUID, deleted: true }));
    await expect(workflowTemplatesApi.remove(UUID)).resolves.toBeUndefined();
    const [url, init] = lastCall();
    expect(url).toContain(`/workflow-templates/${UUID}`);
    expect(init?.method).toBe("DELETE");
  });

  it("updateStepPosition PATCHes the step endpoint with positionX/Y (no /position route)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(STEP));
    await workflowTemplatesApi.updateStepPosition(UUID, STEP_ID, { positionX: 100, positionY: 250 });
    const [url, init] = lastCall();
    expect(url).toContain(`/workflow-templates/${UUID}/steps/${STEP_ID}`);
    expect(url).not.toContain("/position");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ positionX: 100, positionY: 250 });
  });

  it("validate derives the DAG result client-side from the fetched detail (no /validate route)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ template: TEMPLATE, steps: [STEP], dependencies: [], checklists: [] }),
    );
    const result = await workflowTemplatesApi.validate(UUID);
    const [url] = lastCall();
    expect(url).toContain(`/workflow-templates/${UUID}`);
    expect(url).not.toContain("/validate");
    // 1 bước, không cạnh → root hợp lệ, không lỗi.
    expect(result.valid).toBe(true);
  });

  it("publish surfaces a 422 as an ApiError with status 422 (DAG invalid)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, data: null, error: { code: "UNPROCESSABLEENTITY", message: "DAG invalid" } },
        422,
      ),
    );
    await expect(workflowTemplatesApi.publish(UUID)).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
    });
  });

  it("publish surfaces a 409 (double-publish / already published) as ApiError status 409", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, data: null, error: { code: "CONFLICT", message: "already published" } },
        409,
      ),
    );
    const err = await workflowTemplatesApi.publish(UUID).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });

  it("apply POSTs the target and returns the created instance id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ instance: { id: DEP_ID }, steps: [] }),
    );
    const res = await workflowTemplatesApi.apply(UUID, { contentItemId: UUID, projectId: null });
    const [url, init] = lastCall();
    expect(url).toContain(`/workflow-templates/${UUID}/apply`);
    expect(init?.method).toBe("POST");
    expect(res.instanceId).toBe(DEP_ID);
  });
});
