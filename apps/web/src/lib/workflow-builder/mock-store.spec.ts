import { afterEach, describe, expect, it } from "vitest";
import { __resetMockStore, mockTemplatesStore } from "./mock-store";

const VIDEO_PUBLISHED = "a0000000-0000-4000-8000-000000000001";
const SOCIAL_DRAFT = "b0000000-0000-4000-8000-000000000001";

afterEach(() => {
  __resetMockStore();
});

describe("mockTemplatesStore", () => {
  it("lists seeded templates with a stepCount", async () => {
    const list = await mockTemplatesStore.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const video = list.find((t) => t.id === VIDEO_PUBLISHED);
    expect(video?.stepCount).toBe(4);
    expect(video?.status).toBe("published");
  });

  it("creates a new draft template at version 1", async () => {
    const created = await mockTemplatesStore.create({ name: "Quy trình mới", appliesTo: "content" });
    expect(created.status).toBe("draft");
    expect(created.version).toBe(1);
    const detail = await mockTemplatesStore.get(created.id);
    expect(detail.steps).toHaveLength(0);
  });

  it("adds a step to a draft and increments the count immutably", async () => {
    const before = await mockTemplatesStore.get(SOCIAL_DRAFT);
    await mockTemplatesStore.addStep(SOCIAL_DRAFT, { code: "extra", title: "Bước thêm" });
    const after = await mockTemplatesStore.get(SOCIAL_DRAFT);
    expect(after.steps).toHaveLength(before.steps.length + 1);
    // `before` snapshot is not mutated by the later add.
    expect(before.steps).toHaveLength(4);
  });

  it("rejects editing a published template (immutable D4)", async () => {
    await expect(
      mockTemplatesStore.addStep(VIDEO_PUBLISHED, { code: "x", title: "X" }),
    ).rejects.toThrow(/xuất bản/i);
  });

  it("rejects a self-dependency", async () => {
    const detail = await mockTemplatesStore.get(SOCIAL_DRAFT);
    const stepId = detail.steps[0]!.id;
    await expect(
      mockTemplatesStore.addDependency(SOCIAL_DRAFT, { fromStepId: stepId, toStepId: stepId }),
    ).rejects.toThrow(/tự phụ thuộc/i);
  });

  it("publishes a draft whose DAG is valid", async () => {
    const published = await mockTemplatesStore.publish(SOCIAL_DRAFT);
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();
  });

  it("blocks publish when the DAG is invalid (cycle)", async () => {
    const detail = await mockTemplatesStore.get(SOCIAL_DRAFT);
    // brief→design and design→review exist; add review→brief to create a cycle.
    const byKey = new Map(detail.steps.map((s) => [s.nodeKey, s.id]));
    await mockTemplatesStore.addDependency(SOCIAL_DRAFT, {
      fromStepId: byKey.get("review")!,
      toStepId: byKey.get("brief")!,
    });
    await expect(mockTemplatesStore.publish(SOCIAL_DRAFT)).rejects.toThrow(/DAG/i);
  });

  it("clones a template into a draft at version+1 with copied steps and deps", async () => {
    const clone = await mockTemplatesStore.clone(VIDEO_PUBLISHED);
    expect(clone.status).toBe("draft");
    expect(clone.version).toBe(2);
    const detail = await mockTemplatesStore.get(clone.id);
    expect(detail.steps).toHaveLength(4);
    expect(detail.dependencies).toHaveLength(3);
    // cloned deps reference cloned step ids (not the originals).
    const clonedStepIds = new Set(detail.steps.map((s) => s.id));
    for (const d of detail.dependencies) {
      expect(clonedStepIds.has(d.fromStepId)).toBe(true);
      expect(clonedStepIds.has(d.toStepId)).toBe(true);
    }
  });
});
