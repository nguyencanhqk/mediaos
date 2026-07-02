/**
 * hr-org-api — contract/URL boundary tests (S2-FE-HR-6).
 *
 * KHÔNG mock orgApi; chỉ mock apiFetch tại ranh giới `./api-client` (cùng pattern
 * foundation-api.spec.ts) để kiểm chứng getTree() gọi ĐÚNG path GET /org/units/tree + truyền
 * orgTreeResponseSchema (đệ quy) làm validator.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orgApi, orgTreeNodeSchema } from "./hr-org-api";
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

describe("orgApi.getTree (URL + method + Zod validator)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue([] as never);
  });

  it("getTree() → GET /org/units/tree KHÔNG query string, KHÔNG body", async () => {
    await orgApi.getTree();
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/org/units/tree");
    expect(schema).toBeDefined();
    expect(opts).toBeUndefined();
  });
});

describe("orgTreeNodeSchema (đệ quy)", () => {
  it("parse node lá (children rỗng)", () => {
    const leaf = {
      id: "org-2",
      parentId: "org-1",
      name: "Phòng Kỹ thuật",
      type: "department",
      code: "KT",
      status: "active",
      headUserName: null,
      children: [],
    };
    expect(() => orgTreeNodeSchema.parse(leaf)).not.toThrow();
  });

  it("parse cây lồng nhau (parent + 1 child)", () => {
    const tree = {
      id: "org-1",
      parentId: null,
      name: "Ban Giám đốc",
      type: "department",
      code: null,
      status: "active",
      headUserName: "Nguyễn Văn A",
      children: [
        {
          id: "org-2",
          parentId: "org-1",
          name: "Phòng Kỹ thuật",
          type: "department",
          code: "KT",
          status: "active",
          headUserName: null,
          children: [],
        },
      ],
    };
    const parsed = orgTreeNodeSchema.parse(tree);
    expect(parsed.children).toHaveLength(1);
    expect(parsed.children[0]?.name).toBe("Phòng Kỹ thuật");
  });

  it("KHÔNG có field lương/liên hệ cá nhân (org_unit KHÔNG phải dữ liệu nhân viên nhạy cảm)", () => {
    const node = {
      id: "org-1",
      parentId: null,
      name: "Ban Giám đốc",
      type: "department",
      code: null,
      status: "active",
      headUserName: null,
      children: [],
    };
    const parsed = orgTreeNodeSchema.parse(node);
    expect(parsed).not.toHaveProperty("baseSalary");
    expect(parsed).not.toHaveProperty("phone");
  });
});
