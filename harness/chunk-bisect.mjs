// harness/chunk-bisect.mjs — luật CỨU một nhóm file khi runner test chết vì hạ tầng.
//
// TÁCH RA KHỎI chunk-test.mjs để test được TẤT ĐỊNH (`harness/chunk-bisect.test.mjs`, chạy ở step
// `tooling-tests` của check.sh). Crash KI-014 là NGẪU NHIÊN — đo 2 lần liên tiếp trên cùng cây code:
// lần 1 chunk 8/12 chết 3 lượt liền (mất 40 file), lần 2 chunk 8 xanh còn chunk 10 chết rồi tự khỏi.
// Không thể dựa vào một lần chạy thật để chứng minh nhánh cứu là đúng; phải bơm runner giả.
//
// LUẬT (thứ tự quan trọng):
//   1. status 0            → xong.
//   2. đỏ THẬT             → dừng, KHÔNG chạy lại, KHÔNG chia. Chia một nhóm có đỏ thật chỉ làm
//                            cùng một lỗi bị đếm nhiều lần.
//   3. crash hạ tầng       → chạy lại tại chỗ (mức 0 dùng `retries`; mức đã chia dùng ≤1 vì nhóm đã
//                            nhỏ hơn hẳn).
//   4. hết lượt vẫn crash  → CHIA ĐÔI, đệ quy. Xác suất crash phụ thuộc KÍCH THƯỚC chunk
//                            (RELEASE-06 §4.4), nên chạy lại y nguyên kích thước là lặp lại đúng
//                            điều kiện đã hỏng — đó là lý do bản trước mất trọn 40 file.
//   5. còn 1 file vẫn crash→ file đó LÀ thủ phạm: gọi đúng tên. "1 file crash: <tên>" sửa được;
//                            "thiếu 40 file" thì không.

/** 40 file → 1 file chỉ cần 6 mức. Trần chặn vòng lặp bệnh lý, KHÔNG phải giới hạn chất lượng. */
export const MAX_BISECT_DEPTH = 8;

/**
 * @typedef {{ status: number, crashed: boolean, ranFiles: string[], failed: number }} RunResult
 *
 * @param {object} p
 * @param {string[]} p.files            file của nhóm này
 * @param {string} p.label              nhãn hiển thị
 * @param {(files: string[], label: string, depth: number) => Promise<RunResult>} p.runOne
 * @param {{ retries: number, bisect: boolean }} p.opts
 * @param {(msg: string) => void} [p.log]
 * @returns {Promise<{ ran: Set<string>, realFailures: number, crashedFiles: string[], retriesUsed: number }>}
 */
export async function rescueRun({ files, label, runOne, opts, log = () => {} }) {
  const state = { ran: new Set(), realFailures: 0, crashedFiles: [], retriesUsed: 0 };
  await walk(files, label, 0);
  return state;

  async function walk(group, groupLabel, depth) {
    // Mức đã chia: nhóm nhỏ hơn hẳn nên 1 lượt chạy lại là đủ. Mức 0 giữ nguyên `retries` để đường
    // chạy bình thường không đổi hành vi so với trước khi có bisect.
    const retries = depth === 0 ? opts.retries : Math.min(1, opts.retries);
    let attempt = 0;
    let res;

    for (;;) {
      res = await runOne(
        group,
        groupLabel + (attempt > 0 ? ` — chạy lại lần ${attempt}` : ""),
        depth,
      );
      for (const f of res.ranFiles) state.ran.add(f);

      if (res.status === 0) return;
      if (!res.crashed) break; // đỏ THẬT
      if (attempt >= retries) break;
      attempt++;
      state.retriesUsed++;
      log(`  ⚠️  ${groupLabel}: crash HẠ TẦNG (0 test đỏ) — chạy lại (${attempt}/${retries})`);
    }

    if (!res.crashed) {
      state.realFailures += res.failed || 1;
      log(`  ❌ ${groupLabel}: ${res.failed} test ĐỎ THẬT`);
      return;
    }

    if (opts.bisect && group.length > 1 && depth < MAX_BISECT_DEPTH) {
      const mid = Math.ceil(group.length / 2);
      log(
        `  ✂️  ${groupLabel}: crash không cứu được ở kích thước này — CHIA ĐÔI (${mid} + ${group.length - mid})`,
      );
      await walk(group.slice(0, mid), `${groupLabel} ▸A`, depth + 1);
      await walk(group.slice(mid), `${groupLabel} ▸B`, depth + 1);
      return;
    }

    state.crashedFiles.push(...group);
    log(
      `  ❌ ${groupLabel}: crash hạ tầng KHÔNG cứu được — ${group.length} file:\n` +
        group.map((f) => `        · ${f}`).join("\n"),
    );
  }
}
