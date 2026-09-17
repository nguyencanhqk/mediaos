/**
 * S15-PAYROLL-BE-5B — định danh tệp PDF/ZIP phiếu lương: link sở hữu (`file_links.module_code/entity_type`) và
 * sự kiện outbox của 085. Một nguồn cho service 083–085, consumer và `PayrollExportFileResolver` (resolver chặn
 * route file chung theo đúng cặp module/entity này).
 */

export const PAYROLL_FILE_MODULE = "PAYROLL";
/** Link của tệp PDF một phiếu (083/084). */
export const PAYSLIP_PDF_ENTITY = "payslip-pdf";
/** Link của tệp ZIP cả kỳ (085). */
export const PAYSLIP_PDF_BATCH_ENTITY = "payslip-pdf-batch";
/** Event outbox yêu cầu sinh lô ZIP — payload chỉ `{ fileId, periodId, requestedBy }`. */
export const PAYSLIP_PDF_BATCH_EVENT = "payroll.payslip_pdf_batch.requested";
