import { nowSeconds } from "./db";
import { publishPost } from "./fb/publish";
import { MAX_PUBLISH_ATTEMPTS } from "./fb/constants";
import { listDuePosts, listPendingHandoffPosts, listPosts, updatePost } from "./repo/post-repo";

/**
 * Worker hen gio noi bo. Moi tick lam hai viec:
 *
 * 1. Day cac bai dang cho len Facebook de Facebook giu lich. Khi tao lich
 *    hang loat cho nhieu Page, so lan goi Graph API rat lon nen khong the
 *    goi het ngay trong mot request HTTP - worker day dan tung dot nho.
 * 2. Dang cac bai co scheduleMode = 'local' khi den gio - do la nhung bai
 *    co thoi diem hen nam ngoai khoang Facebook chap nhan (som hon 10 phut
 *    hoac xa hon 30 ngay), chi dang duoc khi phan mem dang chay.
 */

const TICK_INTERVAL_MS = 60_000;

/** Bai qua han qua lau thi khong dang nua de tranh dang bai lac hau. */
const STALE_THRESHOLD_SECONDS = 24 * 60 * 60;

/** So bai day len Facebook moi tick - giu duoi gioi han tan suat cua Facebook. */
const HANDOFF_BATCH_SIZE = 8;

/** Nghi giua hai lan goi Graph API trong cung mot dot. */
const HANDOFF_DELAY_MS = 1_500;

let timer: NodeJS.Timeout | null = null;
let running = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Day dot tiep theo cac bai da xep lich len Facebook.
 * Bai loi duoc danh dau 'failed' de nguoi dung thay va bam thu lai,
 * khong tu quay vong vo han.
 */
async function handoffToFacebook(): Promise<void> {
  const pending = listPendingHandoffPosts(HANDOFF_BATCH_SIZE);

  for (const [index, post] of pending.entries()) {
    if (index > 0) await delay(HANDOFF_DELAY_MS);

    const result = await publishPost(post.id);
    if (!result.ok) {
      console.error(`[worker] Không đẩy được bài #${post.id} lên Facebook: ${result.error}`);
    }
  }

  if (pending.length > 0) {
    console.log(`[worker] Đã đẩy ${pending.length} bài lên Facebook.`);
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;

  try {
    await handoffToFacebook();

    const now = nowSeconds();
    const due = listDuePosts(now);

    for (const post of due) {
      if (post.scheduledAt !== null && now - post.scheduledAt > STALE_THRESHOLD_SECONDS) {
        updatePost(post.id, {
          status: "failed",
          error:
            "Đã quá giờ hẹn hơn 24 giờ mà phần mềm không chạy nên bài không được đăng. Hãy hẹn lại giờ mới.",
        });
        continue;
      }

      if (post.attempts >= MAX_PUBLISH_ATTEMPTS) {
        updatePost(post.id, {
          status: "failed",
          error: `Đã thử đăng ${post.attempts} lần không thành công. Kiểm tra lỗi rồi bấm "Thử lại".`,
        });
        continue;
      }

      const result = await publishPost(post.id);
      if (result.ok) {
        console.log(`[worker] Đã đăng bài #${post.id}`);
      } else {
        console.error(`[worker] Bài #${post.id} lỗi: ${result.error}`);
        // Cho phep tick sau thu lai neu chua vuot nguong.
        if (post.attempts + 1 < MAX_PUBLISH_ATTEMPTS) {
          updatePost(post.id, { status: "queued" });
        }
      }
    }
  } catch (error) {
    console.error("[worker] Lỗi vòng lặp:", error);
  } finally {
    running = false;
  }
}

/**
 * Bai bi ket o 'publishing' khi tien trinh tat giua chung.
 * Dua chung ve hang doi luc khoi dong de khong bi treo vinh vien.
 */
function recoverStuckPosts(): void {
  const stuck = listPosts({ status: "publishing" });
  for (const post of stuck) {
    updatePost(post.id, {
      status: post.scheduleMode === "local" ? "queued" : "failed",
      error: "Tiến trình bị dừng giữa chừng khi đang gửi bài. Kiểm tra trên Page rồi thử lại.",
    });
  }
}

export function startWorker(): void {
  if (timer) return;
  recoverStuckPosts();
  timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  // Khong giu tien trinh song chi vi timer nay.
  timer.unref?.();
  void tick();
  console.log("[worker] Đã khởi động bộ hẹn giờ nội bộ (kiểm tra mỗi 60 giây).");
}

export function stopWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
