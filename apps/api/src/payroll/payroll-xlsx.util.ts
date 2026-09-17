/**
 * Chống formula injection cho MỌI tệp XLSX của PAYROLL (017 · 071 · 082): ô văn bản bắt đầu bằng `= + - @` được tiền tố
 * `'` để Excel/LibreOffice hiển thị như chữ. Tên người · mã NV · tên ngân hàng · lý do điều chỉnh là dữ liệu người
 * dùng nhập — không tin.
 *
 * exceljs vốn ghi chuỗi thành ô văn bản (không gắn thẻ công thức), nên tệp vừa tải chưa tự chạy công thức; tiền tố
 * chặn nhánh CÒN LẠI: người dùng sửa ô (F2 + Enter), lưu lại dạng CSV, hoặc cổng ngân hàng chuyển đổi tệp.
 *
 * Tách file riêng (S15-PAYROLL-QA-1): trước đây hàm sống trong `payroll-payment-export.service.ts`, nên 017 import nó
 * sẽ đóng vòng với import `PAYROLL_EXPORT_MAX_ROWS` theo chiều ngược lại.
 */
export function xlsxSafe(s: string): string {
  // S15-PAYROLL-BE-5 (security-review LOW): thêm TAB/CR đầu chuỗi — OWASP CSV-injection coi chúng cùng lớp với `= + - @`.
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
