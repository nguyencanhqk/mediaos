// reconcile-merged.test.mjs — chốt chống mọc lại cho harness/lib/reconcile-merged.mjs.
//
// Lỗ gốc (ĐÃ XẢY RA 2 LẦN, đều là "WO chưa thi công bị đóng dấu Đã xong"):
//   L1 2026-07-29 — `chore(docs): regen STATUS/INDEX … + gỡ 2 bẫy trong WO S6-SEC-MV-1` (54fa86c6)
//      chỉ sửa chú thích, nhưng subject mang mã WO ⇒ stamp 'finished'. Vá: thêm `docs` vào BOOKKEEPING_RE.
//   L2 2026-07-31 — `chore(gov): HOÃN S6-SEC-IDENTITY-PROJ-1 …` (555ed415, squash PR #314). Commit HOÃN
//      bị đọc thành commit SHIP vì scope `gov` không có trong danh sách ⇒ WO đang hoãn (KI-053 + KI-054
//      VẪN MỞ) hiện lên "Đã xong (v2)".
//
// Vì sao phải có test chứ không chỉ vá: commit gây lỗi nằm VĨNH VIỄN trong lịch sử master, nên dấu sai
// TÁI PHÁT ở mọi lần chạy `gen-status`/`init.sh` sau đó — im lặng, không ai thấy.
//
// Chạy trong step `tooling-tests` của harness/check.sh (node --test) — không cần DB, không cần git.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isBookkeeping, shouldAutoStamp } from "./lib/reconcile-merged.mjs";

// ── B1: commit ghi sổ/quản trị KHÔNG BAO GIỜ là "WO đã ship" ────────────────────────────────
test("B1 — chore(harness|docs|gov) là bookkeeping ⇒ bị loại khỏi nguồn stamp", () => {
  const cases = [
    "chore(gov): HOÃN S6-SEC-IDENTITY-PROJ-1 ra ngoài cửa sổ RC + chặn WIP ảo tái phát (lần 3) (#314)",
    "chore(docs): regen STATUS/INDEX sau merge #313 + gỡ WIP ảo S6-SEC-IDENTITY-PROJ-1 (lần 2)",
    "chore(docs): regen STATUS/INDEX sau merge #301·#302·#303 + gỡ 2 bẫy trong WO S6-SEC-MV-1",
    "chore(harness): cập nhật backlog + ledger cho S5-ME-DB-1",
  ];
  for (const s of cases) {
    assert.ok(isBookkeeping(s), `phải nhận là bookkeeping: ${s}`);
  }
});

// ── B2: commit SHIP THẬT vẫn phải lọt qua (không được vá quá tay) ───────────────────────────
// Nếu luật lọc nới rộng tới mức nuốt cả commit ship, board sẽ kẹt ready dù việc đã vào master —
// đúng bẫy ngược mà chính reconcile sinh ra để chữa (S2-INT-1 · S2-INT-2).
test("B2 — commit ship thật KHÔNG bị coi là bookkeeping", () => {
  const cases = [
    "feat(release): S6-GOLIVE-1 — WS10: biên bản Go/No-go + bộ bàn giao 10/10, vá lỗ backup chặn go-live (#315)",
    'fix(sec): S6-SEC-XTENANTFK-1 — KI-046: bịt LỚP lỗ "FK một-cột nối hai bảng tenant" (#313)',
    "docs(spec): S5-ME-DOC-1 — bộ spec ME", // WO tài liệu ship bằng docs(...), KHÔNG phải chore(docs)
    "chore(release): S6-REL-1 — hồ sơ phát hành", // chore scope KHÁC ⇒ vẫn là ship
  ];
  for (const s of cases) {
    assert.ok(!isBookkeeping(s), `KHÔNG được coi là bookkeeping: ${s}`);
  }
});

// ── B3: 'blocked' = quyết định NGƯỜI, heuristic không được lật ──────────────────────────────
// Lớp chắn thứ hai, độc lập với B1: kể cả khi một scope commit mới lọt qua bộ lọc subject, WO đang
// hoãn vẫn KHÔNG được auto-stamp. Đây là thứ làm dấu hoãn GIỮ ĐƯỢC thay vì tái phát mỗi lần regen.
test("B3 — KHÔNG auto-stamp WO đang 'blocked' (hoãn có chủ đích)", () => {
  assert.equal(shouldAutoStamp("blocked"), false, "WO hoãn/chặn phải được giữ nguyên");
});

test("B3b — KHÔNG auto-stamp WO đã 'done' (không drift)", () => {
  assert.equal(shouldAutoStamp("done"), false);
});

// Vế NGƯỢC LẠI: reconcile vẫn phải làm đúng việc của nó với WO thật sự bị bỏ sót dấu.
test("B3c — VẪN auto-stamp WO còn todo/in_progress/reopened (đúng mục đích ban đầu)", () => {
  for (const s of ["todo", "in_progress", "reopened", undefined]) {
    assert.equal(shouldAutoStamp(s), true, `phải còn stamp được khi status = ${s}`);
  }
});
