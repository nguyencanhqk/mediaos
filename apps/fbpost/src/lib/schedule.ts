import {
  MAX_SCHEDULE_AHEAD_SECONDS,
  MAX_SCHEDULE_AHEAD_SECONDS_REEL,
  MIN_SCHEDULE_LEAD_SECONDS,
  SCHEDULE_SAFETY_BUFFER_SECONDS,
} from "./fb/constants";
import type { PostType, ScheduleMode } from "./types";

/**
 * Quy tac chon che do hen gio. Dung chung cho ca server va giao dien
 * de nguoi dung thay truoc dieu gi se xay ra.
 */

export function maxScheduleAheadSeconds(type: PostType): number {
  return type === "reel" ? MAX_SCHEDULE_AHEAD_SECONDS_REEL : MAX_SCHEDULE_AHEAD_SECONDS;
}

export interface ScheduleDecision {
  mode: ScheduleMode;
  /** Ly do de hien thi cho nguoi dung. */
  reason: string;
}

/**
 * Quyet dinh ai se chiu trach nhiem dang bai.
 *
 * Uu tien de Facebook giu lich (mode 'facebook') vi khi do may tinh
 * khong can bat. Chi khi thoi diem hen vuot gioi han cua Facebook thi
 * phan mem moi tu giu bai trong hang doi (mode 'local').
 */
export function decideScheduleMode(
  scheduledAt: number | null,
  type: PostType,
  now: number,
): ScheduleDecision {
  if (scheduledAt === null) {
    return { mode: "now", reason: "Đăng ngay lập tức." };
  }

  const delta = scheduledAt - now;

  if (delta <= MIN_SCHEDULE_LEAD_SECONDS) {
    return {
      mode: "local",
      reason:
        "Facebook chỉ nhận lịch cách hiện tại tối thiểu 10 phút, nên phần mềm sẽ tự đăng khi đến giờ (cần giữ phần mềm đang chạy).",
    };
  }

  if (delta > maxScheduleAheadSeconds(type)) {
    const days = Math.floor(maxScheduleAheadSeconds(type) / 86400);
    return {
      mode: "local",
      reason: `Facebook chỉ nhận lịch trong vòng ${days} ngày, nên phần mềm sẽ tự đăng khi đến giờ (cần giữ phần mềm đang chạy).`,
    };
  }

  return {
    mode: "facebook",
    reason: "Bài sẽ được đẩy lên Facebook ngay bây giờ và Facebook tự đăng đúng giờ hẹn.",
  };
}

/**
 * Chuan hoa thoi diem gui cho Facebook: bao dam luon cach hien tai
 * tren 10 phut ke ca khi request bi tre.
 */
export function toFacebookScheduleTime(scheduledAt: number, now: number): number {
  const minimum = now + MIN_SCHEDULE_LEAD_SECONDS + SCHEDULE_SAFETY_BUFFER_SECONDS;
  return Math.max(scheduledAt, minimum);
}

/** Doi gia tri tu <input type="datetime-local"> (gio may) sang unix seconds. */
export function localInputToUnix(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Doi unix seconds sang chuoi cho <input type="datetime-local">. */
export function unixToLocalInput(unix: number): string {
  const date = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDateTime(unix: number | null): string {
  if (unix === null) return "—";
  return new Date(unix * 1000).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
