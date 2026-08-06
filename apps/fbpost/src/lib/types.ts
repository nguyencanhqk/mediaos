/** Cac kieu du lieu dung chung giua server va client. */

/** Loai bai dang - quyet dinh endpoint Graph API duoc su dung. */
export type PostType = "text" | "photo" | "video" | "reel";

/**
 * Trang thai vong doi cua mot bai dang.
 * - draft: moi tao, chua gui di
 * - queued: cho worker noi bo xu ly (bai hen xa hon gioi han cua Facebook)
 * - publishing: dang goi Graph API (khoa de tranh gui trung)
 * - scheduled: da nam tren Facebook, cho Facebook tu dang dung gio
 * - published: da len Page
 * - failed: goi API that bai, xem truong `error`
 * - cancelled: nguoi dung huy
 */
export type PostStatus =
  | "draft"
  | "queued"
  | "publishing"
  | "scheduled"
  | "published"
  | "failed"
  | "cancelled";

/**
 * Cach hen gio:
 * - now: dang ngay lap tuc
 * - facebook: day len Facebook kem scheduled_publish_time, Facebook tu dang
 * - local: giu trong hang doi cua phan mem, worker noi bo dang khi den gio
 */
export type ScheduleMode = "now" | "facebook" | "local";

export type MediaKind = "image" | "video";

export interface MediaFile {
  id: number;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  kind: MediaKind;
  createdAt: number;
}

export interface Post {
  id: number;
  /** Id noi bo cua Page trong bang `pages`. */
  pageRef: number;
  /** Ten Page luu kem de danh sach van doc duoc khi Page bi go. */
  pageName: string;
  /** Noi dung goc trong thu vien, neu bai duoc sinh tu do. */
  contentId: number | null;
  /** Ke hoach dang tu dong da sinh ra bai nay. */
  planId: number | null;
  /** Nhom cac bai tao ra cung mot luot (mot noi dung rai len nhieu Page). */
  batchId: string | null;
  type: PostType;
  message: string;
  link: string | null;
  title: string | null;
  mediaIds: number[];
  /** Unix timestamp (giay). null khi dang ngay. */
  scheduledAt: number | null;
  scheduleMode: ScheduleMode;
  status: PostStatus;
  fbPostId: string | null;
  fbPermalink: string | null;
  error: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface PostInput {
  pageRef: number;
  pageName: string;
  contentId?: number | null;
  planId?: number | null;
  batchId?: string | null;
  type: PostType;
  message: string;
  link?: string | null;
  title?: string | null;
  mediaIds?: number[];
  scheduledAt?: number | null;
  scheduleMode: ScheduleMode;
}

/**
 * Mot tai khoan Facebook da ket noi.
 *
 * Moi tai khoan mang bo App ID / App Secret rieng, nen co the dung mot app
 * chung cho nhieu tai khoan hoac moi tai khoan mot app deu duoc.
 * App Secret va User Access Token khong bao gio roi khoi server.
 */
export interface Account {
  id: number;
  /** Id cua nguoi dung tren Facebook - dung de nhan ra tai khoan trung. */
  fbUserId: string;
  name: string;
  appId: string;
  appSecretMasked: string;
  userTokenMasked: string;
  /** Unix seconds. 0 nghia la khong ro han hoac khong het han. */
  tokenExpiresAt: number;
  /** So Page thuoc tai khoan nay. */
  pageCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Ban ghi noi bo kem bi mat, chi dung trong lop server. */
export interface AccountWithSecrets extends Account {
  appSecret: string;
  userToken: string;
}

/**
 * Mot Page da ket noi. Page Access Token khong nam trong kieu nay -
 * token chi ton tai o phia server, giao dien chi thay ban da che.
 */
export interface PageAccount {
  id: number;
  /** Tai khoan Facebook da mang Page nay ve. */
  accountId: number;
  accountName: string;
  pageId: string;
  name: string;
  canPost: boolean;
  isActive: boolean;
  sortOrder: number;
  tokenMasked: string;
  createdAt: number;
  updatedAt: number;
}

/** Ban ghi noi bo kem token, chi dung trong lop server. */
export interface PageAccountWithToken extends PageAccount {
  accessToken: string;
}

/**
 * Mot noi dung trong thu vien. Noi dung tach roi khoi luot dang:
 * cung mot noi dung co the dang len nhieu Page vao nhieu thoi diem.
 */
export interface Content {
  id: number;
  label: string | null;
  type: PostType;
  message: string;
  link: string | null;
  title: string | null;
  mediaIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface ContentInput {
  label?: string | null;
  type: PostType;
  message: string;
  link?: string | null;
  title?: string | null;
  mediaIds?: number[];
}

/**
 * Cach rai noi dung len cac Page:
 * - broadcast: moi noi dung dang len tat ca Page da chon
 * - rotate: moi noi dung chi dang len mot Page, xoay vong lan luot
 */
export type PlanDistribution = "broadcast" | "rotate";

/** Thu tu lay noi dung ra khoi danh sach da chon. */
export type PlanContentOrder = "sequential" | "shuffle";

export interface PlanConfig {
  contentIds: number[];
  pageRefs: number[];
  /** Ngay bat dau dang, dang YYYY-MM-DD theo gio may. */
  startDate: string;
  /** Cac khung gio trong ngay, dang HH:mm. */
  slots: string[];
  /** Cac thu duoc phep dang. 0 = Chu nhat ... 6 = Thu bay. */
  weekdays: number[];
  distribution: PlanDistribution;
  contentOrder: PlanContentOrder;
  /** Gian cach giua cac Page trong cung mot khung gio (phut). */
  pageStaggerMinutes: number;
  /** Lap lai danh sach noi dung tu dau khi da dung het. */
  repeatContents: boolean;
  /** So bai toi da duoc sinh - tran an toan de khong tao ra hang nghin bai. */
  maxPosts: number;
  /**
   * Hat giong cho che do xao tron. Giao dien sinh mot lan roi dung lai
   * cho ca xem truoc lan tao lich, nho vay ket qua hai buoc trung khop.
   */
  seed: number;
}

export interface Plan {
  id: number;
  name: string;
  config: PlanConfig;
  totalPosts: number;
  createdAt: number;
}

/** Mot o trong ma tran lich: mot noi dung x mot Page x mot thoi diem. */
export interface PlannedPost {
  contentId: number;
  contentLabel: string;
  type: PostType;
  pageRef: number;
  pageName: string;
  scheduledAt: number;
  scheduleMode: ScheduleMode;
}

export interface PlanPreview {
  posts: PlannedPost[];
  total: number;
  perPage: { pageRef: number; pageName: string; count: number }[];
  firstAt: number | null;
  lastAt: number | null;
  /** So bai Facebook se giu lich / phan mem phai giu lich. */
  facebookCount: number;
  localCount: number;
  warnings: string[];
  /** true khi da cham tran maxPosts va con noi dung chua duoc xep lich. */
  truncated: boolean;
}

export interface AppSettings {
  /**
   * Ung dung Facebook dung cho nut "Đăng nhập bằng Facebook". Moi tai khoan
   * van giu ban sao App ID/Secret cua rieng no trong bang `accounts`, nen
   * doi app o day khong lam hong cac tai khoan da ket noi truoc do.
   */
  appId: string;
  appSecret: string;
  /** Id cau hinh cua Facebook Login for Business, neu app dung san pham do. */
  loginConfigId: string;
  userAccessToken: string;
  graphVersion: string;
  /**
   * Ba truong duoi day thuoc phien ban chi dang duoc mot Page.
   * Chi con giu de chuyen du lieu cu sang bang `pages` khi nang cap,
   * khong con duoc doc trong luong dang bai.
   */
  pageId: string;
  pageName: string;
  pageAccessToken: string;
}

/** Envelope chung cho moi API route, theo quy uoc cua du an. */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export const POST_TYPE_LABELS: Record<PostType, string> = {
  text: "Chữ / Link",
  photo: "Ảnh",
  video: "Video",
  reel: "Reels",
};

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Nháp",
  queued: "Trong hàng đợi",
  publishing: "Đang gửi",
  scheduled: "Đã hẹn trên Facebook",
  published: "Đã đăng",
  failed: "Lỗi",
  cancelled: "Đã huỷ",
};

/** 0 = Chu nhat, khop voi Date.getDay(). */
export const WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

export const PLAN_DISTRIBUTION_LABELS: Record<PlanDistribution, string> = {
  broadcast: "Mỗi nội dung đăng lên tất cả Page đã chọn",
  rotate: "Mỗi nội dung chỉ đăng lên một Page, xoay vòng lần lượt",
};
