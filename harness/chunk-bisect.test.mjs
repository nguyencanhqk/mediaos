// harness/chunk-bisect.test.mjs — `node --test`. Chạy ở step `tooling-tests` của check.sh.
//
// Vì sao test bằng runner GIẢ: crash KI-014 là NGẪU NHIÊN (đo 2 lần liên tiếp trên cùng cây code —
// lần 1 chunk 8/12 chết 3 lượt liền làm mất 40 file, lần 2 chunk 8 xanh còn chunk 10 chết rồi tự
// khỏi). Một lần chạy thật KHÔNG chứng minh được nhánh cứu là đúng, và cũng không làm nó ĐỎ được
// khi ai đó gỡ nhánh đó đi.

import assert from "node:assert/strict";
import { test } from "node:test";
import { rescueRun } from "./chunk-bisect.mjs";

const OK = (files) => ({ status: 0, crashed: false, ranFiles: files, failed: 0 });
/** Crash hạ tầng theo chế độ hỏng THẬT: chết trước khi ghi reporter ⇒ 0 file vào báo cáo. */
const CRASH = () => ({ status: 1, crashed: true, ranFiles: [], failed: 0 });
const RED = (files, failed) => ({ status: 1, crashed: false, ranFiles: files, failed });

const files = (n, prefix = "f") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const opts = (o = {}) => ({ retries: 2, bisect: true, ...o });

/** Runner giả: nhóm chứa BẤT KỲ file nào trong `poison` thì crash, còn lại xanh. */
function poisonRunner(poison, trace = []) {
  return async (group, label) => {
    trace.push({ n: group.length, label });
    return group.some((f) => poison.includes(f)) ? CRASH() : OK(group);
  };
}

test("đường thường: không crash → chạy 1 lượt, không chia, không chạy lại", async () => {
  const trace = [];
  const r = await rescueRun({
    files: files(8),
    label: "c1",
    runOne: poisonRunner([], trace),
    opts: opts(),
  });
  assert.equal(trace.length, 1);
  assert.equal(r.ran.size, 8);
  assert.deepEqual(r.crashedFiles, []);
  assert.equal(r.retriesUsed, 0);
});

test("crash rồi tự khỏi ở lượt chạy lại → KHÔNG chia đôi", async () => {
  let calls = 0;
  const r = await rescueRun({
    files: files(8),
    label: "c1",
    runOne: async (g) => (++calls === 1 ? CRASH() : OK(g)),
    opts: opts(),
  });
  assert.equal(calls, 2, "đúng 1 lượt chạy lại, không đi tiếp vào nhánh chia");
  assert.equal(r.ran.size, 8);
  assert.equal(r.retriesUsed, 1);
  assert.deepEqual(r.crashedFiles, []);
});

test("crash dai dẳng: CỨU được phần lành và HỘI TỤ về đích danh 1 file", async () => {
  // Đây là ca đã xảy ra thật (chunk 8/12, 40 file, chết 3 lượt liền). Trước bisect: mất trọn nhóm.
  const all = files(40);
  const r = await rescueRun({
    files: all,
    label: "chunk 8/12",
    runOne: poisonRunner(["f17"]),
    opts: opts(),
  });
  assert.deepEqual(r.crashedFiles, ["f17"], "gọi ĐÚNG TÊN thủ phạm, không phải 'thiếu 40 file'");
  assert.equal(r.ran.size, 39, "39 file còn lại VẪN có bằng chứng");
  assert.ok(!r.ran.has("f17"));
  assert.equal(r.realFailures, 0);
});

test("hai file độc ở hai nửa khác nhau → tìm ra CẢ HAI", async () => {
  const r = await rescueRun({
    files: files(16),
    label: "c1",
    runOne: poisonRunner(["f2", "f11"]),
    opts: opts(),
  });
  assert.deepEqual(r.crashedFiles.sort(), ["f11", "f2"]);
  assert.equal(r.ran.size, 14);
});

test("--no-bisect giữ HÀNH VI CŨ: mất trọn nhóm", async () => {
  const r = await rescueRun({
    files: files(40),
    label: "c1",
    runOne: poisonRunner(["f17"]),
    opts: opts({ bisect: false }),
  });
  assert.equal(r.crashedFiles.length, 40, "đúng thứ bisect sinh ra để thay thế");
  assert.equal(r.ran.size, 0);
});

test("đỏ THẬT: KHÔNG chạy lại, KHÔNG chia — nếu không thì cùng một lỗi bị đếm nhiều lần", async () => {
  const trace = [];
  const r = await rescueRun({
    files: files(8),
    label: "c1",
    runOne: async (g, label) => {
      trace.push(label);
      return RED(g, 3);
    },
    opts: opts(),
  });
  assert.equal(trace.length, 1, "đúng MỘT lượt chạy");
  assert.equal(r.realFailures, 3);
  assert.equal(r.retriesUsed, 0);
  assert.deepEqual(r.crashedFiles, []);
  assert.equal(r.ran.size, 8);
});

test("đỏ THẬT xuất hiện Ở NỬA đã chia vẫn được báo đúng, không bị nuốt thành crash", async () => {
  // Nhóm lớn crash (hạ tầng) nhưng sau khi chia, một nửa có test đỏ thật.
  const r = await rescueRun({
    files: files(8),
    label: "c1",
    runOne: async (g) => {
      if (g.length === 8) return CRASH();
      return g.includes("f0") ? RED(g, 2) : OK(g);
    },
    opts: opts({ retries: 1 }),
  });
  assert.equal(r.realFailures, 2);
  assert.deepEqual(r.crashedFiles, []);
  assert.equal(r.ran.size, 8);
});

test("retries=0: vẫn chia đôi (chia là cơ chế ĐỘC LẬP với chạy lại)", async () => {
  const r = await rescueRun({
    files: files(4),
    label: "c1",
    runOne: poisonRunner(["f3"]),
    opts: opts({ retries: 0 }),
  });
  assert.deepEqual(r.crashedFiles, ["f3"]);
  assert.equal(r.ran.size, 3);
});

test("mọi file đều độc → báo đủ mọi file, không treo, không mất file nào", async () => {
  const all = files(8);
  const r = await rescueRun({
    files: all,
    label: "c1",
    runOne: poisonRunner(all),
    opts: opts({ retries: 0 }),
  });
  assert.deepEqual(r.crashedFiles.sort(), [...all].sort());
  assert.equal(r.ran.size, 0);
});
