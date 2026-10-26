/**
 * S20-TASK-QUICKEDIT-1 — RATCHET: bảng chuyển trạng thái của FE phải trùng TỪNG CẶP với bảng của API.
 *
 * `apps/app` không import được `apps/api` (mẫu `chat-preview.parity.spec.ts`), nên ca này đọc file
 * NGUỒN `apps/api/src/tasks/task-fsm.ts`, bóc khối `const TRANSITIONS … = { … };` rồi so 5 × 5 cặp.
 * Lệch một cặp thì đỏ và nêu đích danh cặp đó — người sửa biết phải đồng bộ chỗ nào.
 *
 * Chỉ bóc trong khối `TRANSITIONS` (không quét cả file): phần chú thích của file nguồn cũng nhắc tên
 * trạng thái, quét thô sẽ khớp phần văn xuôi.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskCoreStatusDto } from "@mediaos/contracts";
import { TASK_CORE_STATUS_OPTIONS } from "./constants";
import {
  canTransitionTaskStatus,
  statusMenuOptions,
  TASK_STATUS_TRANSITIONS,
} from "./task-status-transitions";

/** `apps/app/src/routes/tasks` → `apps/api/src/tasks/task-fsm.ts`. */
const API_FSM = join(__dirname, "..", "..", "..", "..", "api", "src", "tasks", "task-fsm.ts");

const BLOCK_RE = /const TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\};/;
const ROW_RE = /^\s*("?)([A-Za-z ]+)\1:\s*new Set\(\[([^\]]*)\]\)/;

function parseApiTransitions(): Map<string, Set<string>> {
  const source = readFileSync(API_FSM, "utf8");
  const block = BLOCK_RE.exec(source)?.[1];
  if (!block) throw new Error(`Không tìm thấy khối TRANSITIONS trong ${API_FSM}`);
  const table = new Map<string, Set<string>>();
  for (const line of block.split("\n")) {
    const match = ROW_RE.exec(line);
    if (!match) continue;
    const targets = [...(match[3] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
    table.set(match[2] ?? "", new Set(targets));
  }
  return table;
}

describe("task-status-transitions — đối chiếu task-fsm.ts của API", () => {
  const api = parseApiTransitions();

  it("bóc được đủ 5 hàng nguồn (bộ bóc không lặng lẽ trả bảng rỗng)", () => {
    expect([...api.keys()].sort()).toEqual([...TASK_CORE_STATUS_OPTIONS].sort());
  });

  for (const from of TASK_CORE_STATUS_OPTIONS) {
    for (const to of TASK_CORE_STATUS_OPTIONS) {
      if (from === to) continue;
      it(`${from} → ${to} khớp API (${API_FSM.split(/[\\/]/).slice(-3).join("/")})`, () => {
        const apiAllows = api.get(from)?.has(to) ?? false;
        expect(TASK_STATUS_TRANSITIONS[from].includes(to)).toBe(apiAllows);
      });
    }
  }
});

describe("statusMenuOptions — menu chỉ có chuyển hợp lệ", () => {
  it("từ Cancelled chỉ còn Todo / In Progress (cùng trạng thái hiện tại)", () => {
    expect(statusMenuOptions("Cancelled")).toEqual(["Todo", "In Progress", "Cancelled"]);
  });

  it("Done mở lại được (D-18): đủ 5 lựa chọn", () => {
    expect(statusMenuOptions("Done")).toEqual([...TASK_CORE_STATUS_OPTIONS]);
  });

  it("NULL coi như Todo: chuyển được tới mọi trạng thái", () => {
    expect(statusMenuOptions(null)).toEqual([...TASK_CORE_STATUS_OPTIONS]);
    expect(canTransitionTaskStatus(null, "Done")).toBe(true);
  });

  it("chọn lại đúng trạng thái hiện tại là hợp lệ (no-op của server)", () => {
    const all: TaskCoreStatusDto[] = [...TASK_CORE_STATUS_OPTIONS];
    for (const s of all) expect(canTransitionTaskStatus(s, s)).toBe(true);
    expect(canTransitionTaskStatus("Cancelled", "Done")).toBe(false);
  });
});
