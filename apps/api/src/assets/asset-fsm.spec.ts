import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  ASSET_TRANSITIONS,
  assertTransition,
  canTransition,
  type AssetAction,
  type AssetStatus,
} from "./asset-fsm";

/**
 * S11-ASSET-BE-1 — pin 100% ma trận SPEC-13 §13.1. Danh sách hợp lệ dưới đây là LITERAL chép từ SPEC (cố ý
 * KHÔNG import `ASSET_TRANSITIONS` để suy ra — assert hằng bằng chính nó là tautology); mọi tổ hợp còn lại
 * PHẢI ném 409 ASSET-ERR-001.
 */
const STATUSES: AssetStatus[] = ["In Stock", "Assigned", "Under Maintenance", "Disposed", "Lost"];
const ACTIONS: AssetAction[] = [
  "assign",
  "revoke",
  "openMaintenance",
  "closeMaintenance",
  "dispose",
  "recover",
];

const ALLOWED: Array<[AssetStatus, AssetStatus, AssetAction]> = [
  ["In Stock", "Assigned", "assign"],
  ["In Stock", "Under Maintenance", "openMaintenance"],
  ["In Stock", "Disposed", "dispose"],
  ["In Stock", "Lost", "dispose"],
  ["Assigned", "In Stock", "revoke"],
  ["Assigned", "Under Maintenance", "openMaintenance"],
  ["Assigned", "Lost", "revoke"],
  ["Assigned", "Lost", "dispose"],
  ["Under Maintenance", "In Stock", "closeMaintenance"],
  ["Under Maintenance", "Assigned", "closeMaintenance"],
  ["Under Maintenance", "Under Maintenance", "revoke"],
  ["Under Maintenance", "Disposed", "dispose"],
  ["Under Maintenance", "Lost", "revoke"],
  ["Under Maintenance", "Lost", "dispose"],
  ["Lost", "In Stock", "recover"],
];

describe("asset-fsm — ma trận SPEC-13 §13.1", () => {
  it("đúng 15 chuyển tiếp hợp lệ, không hơn không kém", () => {
    expect(ASSET_TRANSITIONS.size).toBe(ALLOWED.length);
    for (const [from, to, action] of ALLOWED) {
      expect(canTransition(from, to, action), `${from} → ${to} (${action})`).toBe(true);
      expect(() => assertTransition(from, to, action)).not.toThrow();
    }
  });

  it("mọi tổ hợp còn lại ⇒ 409 ASSET-ERR-001 kèm details from/to/action", () => {
    const allowedKeys = new Set(ALLOWED.map(([f, t, a]) => `${f}→${t}:${a}`));
    let denied = 0;
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        for (const action of ACTIONS) {
          if (allowedKeys.has(`${from}→${to}:${action}`)) continue;
          denied += 1;
          expect(canTransition(from, to, action)).toBe(false);
          let caught: unknown;
          try {
            assertTransition(from, to, action);
          } catch (err) {
            caught = err;
          }
          expect(caught).toBeInstanceOf(ConflictException);
          const body = (caught as ConflictException).getResponse() as {
            code: string;
            details: Array<{ field: string; message: string }>;
          };
          expect(body.code).toBe("ASSET-ERR-001");
          expect(body.details.find((d) => d.field === "from")?.message).toBe(from);
          expect(body.details.find((d) => d.field === "action")?.message).toBe(action);
        }
      }
    }
    expect(denied).toBe(STATUSES.length * STATUSES.length * ACTIONS.length - ALLOWED.length);
  });

  it("Disposed là trạng thái cuối — không đi đâu được", () => {
    for (const to of STATUSES) {
      for (const action of ACTIONS) {
        expect(canTransition("Disposed", to, action)).toBe(false);
      }
    }
  });

  it("Assigned → Disposed KHÔNG có trong ma trận (SPEC đánh ô đó là ASSET-ERR-008, service guard trước)", () => {
    expect(canTransition("Assigned", "Disposed", "dispose")).toBe(false);
  });

  it("đường chéo Under Maintenance × Under Maintenance chỉ mở cho revoke", () => {
    expect(canTransition("Under Maintenance", "Under Maintenance", "revoke")).toBe(true);
    for (const action of ACTIONS.filter((a) => a !== "revoke")) {
      expect(canTransition("Under Maintenance", "Under Maintenance", action)).toBe(false);
    }
  });
});
