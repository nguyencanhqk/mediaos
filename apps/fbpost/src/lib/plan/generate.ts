import { decideScheduleMode, maxScheduleAheadSeconds } from "../schedule";
import type { PlanConfig, PlanPreview, PlannedPost, PostType } from "../types";

/**
 * Bo sinh lich dang tu dong.
 *
 * Dau vao la danh sach noi dung, danh sach Page va quy tac rai bai;
 * dau ra la ma tran "noi dung x Page x thoi diem". Ham thuan tuy va
 * tat dinh: cung mot cau hinh (ke ca hat giong xao tron) luon cho ra
 * cung mot ket qua, nen ban xem truoc va lich thuc su tao ra giong nhau.
 */

/** Khong duyet qua so ngay nay de vong lap luon ket thuc. */
const MAX_DAYS_AHEAD = 400;

export interface PlanContentRef {
  id: number;
  label: string;
  type: PostType;
}

export interface PlanPageRef {
  id: number;
  name: string;
}

export interface GenerateInput {
  contents: PlanContentRef[];
  pages: PlanPageRef[];
  config: PlanConfig;
  now: number;
}

/** PRNG tat dinh (mulberry32) - de xao tron lap lai duoc tu mot hat giong. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const random = createRandom(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 'HH:mm' -> so phut tinh tu dau ngay. null khi chuoi khong hop le. */
export function parseSlot(slot: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(slot.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 'YYYY-MM-DD' -> Date luc 0h theo gio may. null khi chuoi khong hop le. */
function parseStartDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Liet ke cac moc thoi gian hop le theo ngay bat dau, khung gio va thu trong tuan.
 * Bo qua moc da qua so voi hien tai.
 */
function* iterateSlots(
  config: PlanConfig,
  now: number,
): Generator<{ at: number; skippedPast: boolean }> {
  const start = parseStartDate(config.startDate);
  if (!start) return;

  const minutesOfDay = config.slots
    .map(parseSlot)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (minutesOfDay.length === 0) return;

  const weekdays = new Set(config.weekdays);
  if (weekdays.size === 0) return;

  for (let dayOffset = 0; dayOffset < MAX_DAYS_AHEAD; dayOffset += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + dayOffset);
    if (!weekdays.has(day.getDay())) continue;

    for (const minutes of minutesOfDay) {
      const at = Math.floor(
        new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          Math.floor(minutes / 60),
          minutes % 60,
          0,
          0,
        ).getTime() / 1000,
      );
      yield { at, skippedPast: at <= now };
    }
  }
}

export function generatePlan(input: GenerateInput): PlanPreview {
  const { config, now } = input;
  const warnings: string[] = [];
  const posts: PlannedPost[] = [];

  const empty: PlanPreview = {
    posts: [],
    total: 0,
    perPage: [],
    firstAt: null,
    lastAt: null,
    facebookCount: 0,
    localCount: 0,
    warnings,
    truncated: false,
  };

  if (input.contents.length === 0) {
    warnings.push("Chưa chọn nội dung nào.");
    return empty;
  }
  if (input.pages.length === 0) {
    warnings.push("Chưa chọn Page nào.");
    return empty;
  }
  if (config.slots.every((slot) => parseSlot(slot) === null)) {
    warnings.push("Chưa có khung giờ hợp lệ. Dùng dạng 08:00.");
    return empty;
  }
  if (config.weekdays.length === 0) {
    warnings.push("Chưa chọn thứ nào trong tuần.");
    return empty;
  }
  if (!parseStartDate(config.startDate)) {
    warnings.push("Ngày bắt đầu không hợp lệ.");
    return empty;
  }

  const queue =
    config.contentOrder === "shuffle" ? shuffled(input.contents, config.seed) : [...input.contents];

  const perPageCount = new Map<number, number>(input.pages.map((page) => [page.id, 0]));
  const staggerSeconds = Math.max(0, config.pageStaggerMinutes) * 60;
  const maxPosts = Math.max(1, config.maxPosts);

  let contentIndex = 0;
  let pageIndex = 0;
  let skippedPast = 0;
  let cappedMidSlot = false;
  let exhausted = false;

  for (const slot of iterateSlots(config, now)) {
    if (exhausted || posts.length >= maxPosts) break;

    if (slot.skippedPast) {
      skippedPast += 1;
      continue;
    }

    // Moi khung gio tieu thu dung mot noi dung.
    if (contentIndex >= queue.length) {
      if (!config.repeatContents) {
        exhausted = true;
        break;
      }
      contentIndex = 0;
    }
    const content = queue[contentIndex];
    contentIndex += 1;

    const targets =
      config.distribution === "broadcast"
        ? input.pages
        : [input.pages[pageIndex++ % input.pages.length]];

    for (const [offset, page] of targets.entries()) {
      if (posts.length >= maxPosts) {
        cappedMidSlot = true;
        break;
      }

      const at = slot.at + offset * staggerSeconds;
      posts.push({
        contentId: content.id,
        contentLabel: content.label,
        type: content.type,
        pageRef: page.id,
        pageName: page.name,
        scheduledAt: at,
        scheduleMode: decideScheduleMode(at, content.type, now).mode,
      });
      perPageCount.set(page.id, (perPageCount.get(page.id) ?? 0) + 1);
    }
  }

  if (skippedPast > 0) {
    warnings.push(
      `Đã bỏ qua ${skippedPast} khung giờ nằm trong quá khứ. Lịch bắt đầu từ khung giờ gần nhất còn lại.`,
    );
  }

  // Con viec chua xep xong khi: cham tran so bai, hoac het ngay duyet
  // ma danh sach noi dung van con.
  const remainingContents = config.repeatContents ? 0 : queue.length - contentIndex;
  const hitCap = posts.length >= maxPosts;
  const truncated = cappedMidSlot || remainingContents > 0 || (hitCap && config.repeatContents);

  if (truncated && (hitCap || cappedMidSlot)) {
    warnings.push(
      `Đã chạm giới hạn ${maxPosts} bài mỗi lần tạo lịch. Phần còn lại chưa được xếp — nâng giới hạn hoặc tạo thêm một kế hoạch nữa cho phần sau.`,
    );
  } else if (truncated) {
    warnings.push(
      `Còn ${remainingContents} nội dung chưa xếp được vì hết khung giờ trong ${MAX_DAYS_AHEAD} ngày tới. Thêm khung giờ trong ngày hoặc chọn thêm thứ trong tuần.`,
    );
  }

  const localCount = posts.filter((post) => post.scheduleMode === "local").length;
  if (localCount > 0) {
    const days = Math.floor(maxScheduleAheadSeconds("text") / 86400);
    warnings.push(
      `${localCount} bài nằm ngoài khoảng ${days} ngày Facebook nhận giữ lịch, nên phần mềm sẽ tự đăng khi đến giờ — máy phải bật và phần mềm phải đang chạy vào lúc đó.`,
    );
  }

  const times = posts.map((post) => post.scheduledAt);

  return {
    posts,
    total: posts.length,
    perPage: input.pages.map((page) => ({
      pageRef: page.id,
      pageName: page.name,
      count: perPageCount.get(page.id) ?? 0,
    })),
    firstAt: times.length > 0 ? Math.min(...times) : null,
    lastAt: times.length > 0 ? Math.max(...times) : null,
    facebookCount: posts.filter((post) => post.scheduleMode === "facebook").length,
    localCount,
    warnings,
    truncated,
  };
}

/** Cau hinh mac dinh cho man hinh len lich. */
export function defaultPlanConfig(startDate: string, seed: number): PlanConfig {
  return {
    contentIds: [],
    pageRefs: [],
    startDate,
    slots: ["08:00", "19:00"],
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    distribution: "broadcast",
    contentOrder: "sequential",
    pageStaggerMinutes: 5,
    repeatContents: false,
    maxPosts: 200,
    seed,
  };
}
