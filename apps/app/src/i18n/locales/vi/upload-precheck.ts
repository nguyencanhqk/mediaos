/**
 * S16-SOCIAL-FILEOPENUX-1 (D12) — thông báo lọc sớm ở form tải (`apps/app/src/lib/upload-precheck.ts`), deep-merge
 * vào namespace `common` qua registerI18nResources. Tiền tố khoá riêng `uploadPrecheck.*` để không đè khoá có sẵn.
 */
export default {
  uploadPrecheck: {
    activeMime:
      "Không tải lên được «{{name}}»: hệ thống không nhận loại tệp trình duyệt tự hiển thị thành trang (HTML, SVG, XML).",
    blockedExtension:
      "Không tải lên được «{{name}}»: hệ thống không nhận tệp có đuôi .{{extension}}.",
  },
};
