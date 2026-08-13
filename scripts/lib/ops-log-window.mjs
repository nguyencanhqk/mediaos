/**
 * ops-log-window.mjs — S6-OPS-LOGWINDOW-1 · đếm dòng lỗi trong CỬA SỔ THỜI GIAN của log API.
 *
 * Tách khỏi `scripts/ops-alert-check.mjs` cùng lý do với `ops-alert-rules.mjs`: phần QUYẾT ĐỊNH phải
 * test được mà không cần hạ tầng. File này lo "dòng nào nằm trong cửa sổ", `ops-alert-rules.mjs` lo
 * "bao nhiêu dòng thì kêu".
 *
 * ═══ VÌ SAO CÓ FILE NÀY: `mtime` KHÔNG BAO GIỜ LÀ CĂN CỨ ═══
 * Bản trước gate bằng `mtime` của FILE rồi đếm MỌI chữ `ERROR` trong 2MB cuối. Hỏng cả hai chiều, và
 * cả hai đã xảy ra thật trên máy PROD:
 *
 *   · Dương tính giả (đo 2026-08-01): `api.err.log` có `mtime` 01/08 07:47 nhưng dòng lỗi mới nhất là
 *     30/07 07:52 — service restart chạm vào file mà không ghi lỗi mới nào. Hàm cũ trả **1787**
 *     ("lỗi trong 60 phút") trong khi sự thật là **0**; 1787 ≥ ngưỡng crit 200 ⇒ CRIT giả nổ mỗi 10
 *     phút, 144 lần/ngày, cho một sự cố đã đóng từ hai ngày trước.
 *   · Âm tính giả (nguy hiểm hơn): lỗi ghi ở phút 59 rồi im 61 phút ⇒ `ageMin > WINDOW_MIN` ⇒ trả 0 ⇒
 *     báo XANH ngay sau khi vừa có lỗi.
 *
 * ⇒ `mtime` bị gỡ HOÀN TOÀN. Căn cứ duy nhất là timestamp ĐỌC ĐƯỢC trên từng dòng.
 *
 * ═══ KHÔNG ĐỌC ĐƯỢC GIỜ ⇒ KHÔNG TÍNH ═══
 * Dòng không parse được timestamp (stack trace, dòng đầu bị cắt ngang, rác) KHÔNG được coi là "trong
 * cửa sổ". Đoán chúng vào cửa sổ chính là quay lại đúng lỗi đang sửa.
 */
import fs from "node:fs";

/**
 * Đuôi file đọc mặc định (byte). Bản cũ đọc 2MB — đủ vì đằng nào cũng đếm sai; với đếm-theo-timestamp
 * thì đuôi quá ngắn thành ĐẾM THIẾU khi log đang phun mạnh. 8MB + xoay log (`08-log-rotate.ps1`) giữ
 * cửa sổ 60 phút nằm gọn trong phần đọc. Số đếm ra là CẬN DƯỚI: chỉ có thể thiếu, không thể thừa.
 */
export const DEFAULT_TAIL_BYTES = 8 * 1024 * 1024;

/**
 * Định dạng Nest `Logger` mặc định: `MM/DD/YYYY, h:mm:ss AM|PM`, có mã màu ANSI xen giữa nên KHÔNG
 * neo `^`. Lấy khớp ĐẦU TIÊN — tiền tố Nest luôn đứng trước phần thân, nên ngày tháng nằm trong nội
 * dung thông báo không cướp được vị trí.
 */
const NEST_TIMESTAMP_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/;

/** Phân biệt HOA/thường có chủ ý: `ERROR` là nhãn mức log của Nest, `Error:` là dòng thân stack trace. */
const ERROR_MARK_RE = /\bERROR\b/;

/**
 * Đọc timestamp của một dòng log.
 *
 * Dựng `Date` bằng các thành phần rời ở GIỜ ĐỊA PHƯƠNG — cùng múi giờ với `Date.now()` và với chính
 * Nest khi nó in ra. KHÔNG dùng `new Date(chuỗi)`: cách đó phụ thuộc bộ parse của V8 và im lặng chấp
 * nhận cả những chuỗi vô nghĩa.
 *
 * @param {string} line
 * @returns {number|null} epoch ms, hoặc `null` nếu dòng không mang timestamp đọc được.
 */
export function parseLogTimestamp(line) {
  if (typeof line !== "string") return null;
  const m = NEST_TIMESTAMP_RE.exec(line);
  if (!m) return null;

  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const hour12 = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const isPm = m[7] === "PM";

  // Chặn rác kiểu `13/45/2026, 25:99:99 AM` — regex `\d{1,2}` không chặn được, mà `new Date` thì tràn
  // sang tháng sau trong im lặng.
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour12 < 1 || hour12 > 12) return null;
  if (minute > 59 || second > 59) return null;

  const hour24 = hour12 === 12 ? (isPm ? 12 : 0) : isPm ? hour12 + 12 : hour12;
  const when = new Date(year, month - 1, day, hour24, minute, second, 0);

  // Bắt ngày không tồn tại (30/02): `Date` tràn sang tháng sau thay vì báo lỗi.
  if (when.getFullYear() !== year || when.getMonth() !== month - 1 || when.getDate() !== day) {
    return null;
  }
  return when.getTime();
}

/**
 * Đọc MỘT dòng log JSON có cấu trúc (S10-FND-JSONLOG-1, `JsonConsoleLogger` ở `apps/api`) — mỗi dòng
 * là MỘT object phẳng `{level, pid, timestamp, message, context?, request_id?}`, `timestamp` là
 * epoch-ms nên đọc thẳng được, không cần regex ngày-giờ như định dạng Nest văn xuôi cũ.
 *
 * Dòng không bắt đầu bằng `{`, không parse được, hoặc thiếu field bắt buộc (`timestamp` số +
 * `level` chuỗi) ⇒ `null` — KHÔNG SUY ĐOÁN. `countErrorLinesInWindow` rơi về nhánh định dạng cũ khi
 * gặp `null`, để tail đọc lẫn dòng cũ (trước lúc đổi format) + dòng mới (sau restart/deploy) trong
 * cùng cửa sổ vẫn đếm đúng thay vì mất trắng — đúng luật nền "không đọc được ⇒ không suy đoán, KHÔNG
 * phải bỏ qua cả file".
 *
 * @param {string} line
 * @returns {{ts:number, isError:boolean}|null}
 */
export function parseJsonLogLine(line) {
  const trimmed = typeof line === "string" ? line.trim() : "";
  if (!trimmed.startsWith("{")) return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object") return null;
  if (typeof obj.timestamp !== "number" || typeof obj.level !== "string") return null;
  // Khớp ĐÚNG hành vi cũ (đếm nhãn ERROR, không đếm FATAL) — xem ERROR_MARK_RE ở trên: bản Nest
  // text chỉ in "ERROR" cho `.error()`, `.fatal()` in "FATAL" và KHÔNG khớp `\bERROR\b`.
  return { ts: obj.timestamp, isError: obj.level === "error" };
}

/**
 * Đếm dòng lỗi nằm trong cửa sổ quan sát.
 *
 * Một dòng được tính khi thoả CẢ HAI: mang nhãn `ERROR` **và** có timestamp ≥ mốc cắt. Không có chặn
 * TRÊN: dòng có giờ ở tương lai (đồng hồ lệch) vẫn được tính — với công cụ giám sát, bỏ sót lỗi thật
 * nguy hiểm hơn một cảnh báo thừa.
 *
 * Đọc được CẢ HAI định dạng — JSON có cấu trúc (mới, `parseJsonLogLine`) VÀ Nest văn xuôi (cũ,
 * `ERROR_MARK_RE` + `parseLogTimestamp`) — để đổi định dạng log không làm rớt phép đếm trong cửa sổ
 * chuyển tiếp (xem docblock `parseJsonLogLine`).
 *
 * @param {string} text nội dung log (có thể là phần đuôi của file).
 * @param {object} [opts]
 * @param {number} [opts.nowMs] mốc "bây giờ" (tiêm vào để test tất định).
 * @param {number} [opts.windowMin] độ rộng cửa sổ, phút.
 * @param {boolean} [opts.dropFirstLine] bỏ dòng đầu vì `text` bắt đầu từ giữa file.
 * @returns {number}
 */
export function countErrorLinesInWindow(text, opts = {}) {
  const { nowMs = Date.now(), windowMin = 60, dropFirstLine = false } = opts;
  if (typeof text !== "string" || text === "") return 0;

  const cutoffMs = nowMs - windowMin * 60_000;
  const lines = text.split(/\r?\n/);
  let count = 0;

  for (let i = dropFirstLine ? 1 : 0; i < lines.length; i++) {
    const line = lines[i];

    const jsonLine = parseJsonLogLine(line);
    if (jsonLine !== null) {
      if (jsonLine.isError && jsonLine.ts >= cutoffMs) count++;
      continue;
    }

    if (!ERROR_MARK_RE.test(line)) continue;
    const ts = parseLogTimestamp(line);
    if (ts === null) continue; // không đọc được giờ ⇒ KHÔNG suy đoán là mới
    if (ts >= cutoffMs) count++;
  }
  return count;
}

/**
 * Đếm dòng lỗi trong cửa sổ, đọc từ ĐUÔI file log.
 *
 * @param {string} filePath
 * @param {object} [opts] như `countErrorLinesInWindow`, thêm `maxBytes`.
 * @returns {number|null} `null` = KHÔNG ĐỌC ĐƯỢC (luật nền: khác hẳn `0`; rule sẽ ra `unknown`).
 */
export function countErrorLinesInFile(filePath, opts = {}) {
  const { nowMs = Date.now(), windowMin = 60, maxBytes = DEFAULT_TAIL_BYTES } = opts;
  let fd = null;
  try {
    const size = fs.statSync(filePath).size;
    const readBytes = Math.min(size, Math.max(0, maxBytes));
    if (readBytes === 0) return 0;

    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, size - readBytes);

    // Đọc từ giữa file ⇒ dòng đầu gần như chắc chắn bị cắt ngang (và có thể cắt giữa một ký tự UTF-8
    // nhiều byte). Bỏ nó đi thay vì đếm một mảnh dòng.
    return countErrorLinesInWindow(buf.toString("utf8"), {
      nowMs,
      windowMin,
      dropFirstLine: readBytes < size,
    });
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* fd đã đóng hoặc chưa mở được — không có gì để cứu */
      }
    }
  }
}
