/**
 * Hằng số màn Import nhân viên hàng loạt (S5-HR-IMPORT-FE-1, SPEC-03 §7 "Import hàng loạt" /
 * HR.EMPLOYEE.IMPORT). Cặp NHẠY CẢM `import:employee` (mig 0496) tái dùng từ HR_ENGINE_PAIRS chung
 * (routes/hr/constants.ts) — KHÔNG khai lại literal ở đây (một nguồn sự thật).
 */
import { HR_ENGINE_PAIRS } from "../constants";

/** Gate route + nút "Import nhân viên" — PHẢI dùng useCanExact (xem ghi chú tại HR_ENGINE_PAIRS.IMPORT_EMPLOYEE). */
export const HR_IMPORT_EMPLOYEE_PAIR = HR_ENGINE_PAIRS.IMPORT_EMPLOYEE;

/**
 * Validate CLIENT trước khi gửi (UX sớm — báo lỗi ngay, khỏi chờ round-trip) — mirror giới hạn THẬT của
 * server (MAX_IMPORT_BYTES, hr-employee-import.service.ts). Server VẪN re-check toàn bộ (defence-in-depth,
 * KHÔNG tin client) → validate ở đây chỉ là gợi ý sớm, KHÔNG phải cổng an toàn.
 */
export const HR_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Đuôi file chấp nhận — khớp resolveFileKind (hr-employee-import.service.ts: chỉ .xlsx hoặc .csv). */
export const HR_IMPORT_ACCEPTED_EXTENSIONS = [".xlsx", ".csv"] as const;

/** input[type=file] accept attribute — gợi ý trình duyệt lọc sẵn (KHÔNG phải validate thật). */
export const HR_IMPORT_ACCEPT_ATTR =
  ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

/** 1024-based byte formatter — mirror EmployeeFilesTab.tsx (không export dùng chung, tránh coupling chéo). */
export function formatImportFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/** true nếu tên file có đuôi nằm trong HR_IMPORT_ACCEPTED_EXTENSIONS (so khớp không phân biệt hoa/thường). */
export function hasAcceptedImportExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return HR_IMPORT_ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
