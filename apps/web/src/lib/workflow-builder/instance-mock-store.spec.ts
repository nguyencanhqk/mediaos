import { describe, expect, it } from "vitest";
import { mockInstancesStore } from "./instance-mock-store";

const SOCIAL_INSTANCE = "c0000000-0000-4000-8000-000000000001";

describe("mockInstancesStore", () => {
  it("lists seeded running instances", async () => {
    const list = await mockInstancesStore.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((i) => i.status === "active")).toBe(true);
  });

  it("returns instance detail with steps and dependencies", async () => {
    const detail = await mockInstancesStore.get(SOCIAL_INSTANCE);
    expect(detail.steps).toHaveLength(4);
    expect(detail.dependencies).toHaveLength(4);
  });

  it("seeds a fork with two parallel in_progress steps (đa-bước-song-song)", async () => {
    const detail = await mockInstancesStore.get(SOCIAL_INSTANCE);
    const inProgress = detail.steps.filter((s) => s.status === "in_progress");
    expect(inProgress).toHaveLength(2);
    expect(inProgress.map((s) => s.nodeKey).sort()).toEqual(["copy", "design"]);
  });

  it("rejects an unknown instance id", async () => {
    await expect(mockInstancesStore.get("00000000-0000-4000-8000-0000000000ff")).rejects.toThrow(
      /Không tìm thấy/i,
    );
  });
});
