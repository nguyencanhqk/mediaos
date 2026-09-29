import type {
  FeedPostRestoreResultDto,
  FeedRecycleBinPageDto,
  FeedRecycleBinQueryDto,
} from "@mediaos/contracts";

/** Actor lấy từ JWT (JwtAuthGuard → CompanyGuard) — cùng hình dạng `RequestUser` của `RecycleBinService`. */
export interface RecycleBinActor {
  readonly id: string;
  readonly companyId: string;
}

/**
 * S16-SOCIAL-BE-3C (D6, owner ký O3) — hợp đồng của một LOẠI đối tượng trong thùng rác.
 *
 * Module SỞ HỮU dữ liệu cài đặt handler (cổng quyền tầng 2 · vị từ che · câu khôi phục · audit đều là việc
 * của nó); `recycle-bin/` chỉ định tuyến. Đó là lý do registry đảo phụ thuộc thay vì `recycle-bin` import
 * `SocialModule`: module nền dùng chung không được kéo đồ thị DI của từng module nghiệp vụ (khuôn
 * `MasterDataSeederRegistry` + registrar tự đăng ký ở `onModuleInit`).
 *
 * ⚠️ Handler PHẢI tự gác quyền tầng 2 — decorator ở controller chỉ là tầng 1. Registry không kiểm gì.
 */
export interface RecycleBinHandler<TQuery, TPage, TRestore> {
  list(actor: RecycleBinActor, query: TQuery): Promise<TPage>;
  restore(actor: RecycleBinActor, id: string): Promise<TRestore>;
}

/**
 * Bảng loại → kiểu handler. Tập ĐÓNG ở tầng kiểu: thêm một loại = thêm một khoá ở đây, và `get()` trả đúng
 * kiểu DTO của loại đó mà không cần ép kiểu ở controller.
 *
 * ⚠️ `employee` CỐ Ý KHÔNG có mặt (D6, YAGNI): hai route employee giữ nguyên `RecycleBinController` →
 * `RecycleBinService` với 0 dòng diff — bằng chứng mạnh nhất cho «employee giữ nguyên hành vi». Đưa employee
 * vào registry là nợ TUỲ CHỌN (backlog), không phải việc của WO này.
 */
export interface RecycleBinHandlerMap {
  feed_post: FeedPostRecycleBinHandler;
}

/** Handler `feed_post` (SOCIAL `057`/`058`) — alias có TÊN để lớp cài đặt `implements` được (TS2500). */
export type FeedPostRecycleBinHandler = RecycleBinHandler<
  FeedRecycleBinQueryDto,
  FeedRecycleBinPageDto,
  FeedPostRestoreResultDto
>;

export type RecycleBinObjectType = keyof RecycleBinHandlerMap;
