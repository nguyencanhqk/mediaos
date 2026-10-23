/**
 * S14-SEC-CAPWILDCARD-1 gate CW-G4 — `PermissionPairCatalogSnapshot.list()` loại MỌI hàng catalog chứa `*`
 * (tầng lọc thứ ba của bất biến hình dạng, cạnh hai tầng trong `capability-projection.ts`) và giữ nguyên
 * cờ `is_sensitive` của các cặp còn lại.
 */
import { describe, expect, it } from "vitest";
import { PermissionPairCatalogSnapshot } from "./permission-pair-catalog-snapshot";
import { pair } from "../../test/helpers/capability-stub-repo";

describe("S14-SEC-CAPWILDCARD-1 gate CW-G4 — ảnh chụp cặp loại hàng chứa '*'", () => {
  it("list() bỏ ('*','*'), ('view','*'), ('vi*ew','user'); giữ cặp literal kèm cờ", async () => {
    const snap = new PermissionPairCatalogSnapshot({
      load: async () => [
        pair("*", "*", false),
        pair("view", "*", true),
        pair("vi*ew", "user", false),
        pair("view", "user", false),
        pair("view", "salary", true),
      ],
    });

    expect(await snap.list()).toEqual([
      { action: "view", resourceType: "user", isSensitive: false },
      { action: "view", resourceType: "salary", isSensitive: true },
    ]);
  });
});
