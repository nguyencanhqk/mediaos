/**
 * S7-CALL-FE-1 — chuông cuộc gọi, TỔNG HỢP bằng WebAudio.
 *
 * ⚠️ KHÔNG port thẳng `apps/lms/components/chat/callRingtone.ts`: bản đó nạp mp3 từ `/sounds/*.mp3` và
 * hỏi `/api/ringtones` để lấy đường dẫn tuỳ biến. MediaOS **không có** cả hai, và thêm chúng nghĩa là
 * thêm một endpoint + hai tệp nhị phân vào bundle cho một tiếng bíp. Hai dao động sin đủ để nói "máy
 * đang đổ chuông", và không có tệp nào để 404.
 *
 * Nhịp giống điện thoại quen tay: đến = hai tiếng cao rồi nghỉ; đi = một tiếng trầm dài hơn, thưa hơn
 * (người gọi đang chờ, không cần bị thúc).
 */

type RingtoneKind = "incoming" | "outgoing";

export interface RingtoneHandle {
  stop: () => void;
}

interface RingtonePattern {
  /** Tần số (Hz) của từng tiếng trong một chu kỳ. */
  readonly tones: readonly number[];
  /** Độ dài mỗi tiếng (ms). */
  readonly toneMs: number;
  /** Khoảng giữa hai tiếng trong cùng chu kỳ (ms). */
  readonly gapMs: number;
  /** Khoảng nghỉ giữa hai chu kỳ (ms). */
  readonly cycleMs: number;
  /** Đỉnh biên độ (0..1). Chuông đến to hơn — nó phải kéo được sự chú ý từ tab khác. */
  readonly gain: number;
}

const PATTERNS: Record<RingtoneKind, RingtonePattern> = {
  incoming: { tones: [880, 660], toneMs: 380, gapMs: 120, cycleMs: 2200, gain: 0.18 },
  outgoing: { tones: [440], toneMs: 900, gapMs: 0, cycleMs: 3000, gain: 0.08 },
};

/** Thời gian lên/xuống biên độ. Cắt sóng sin đột ngột nghe thành tiếng "tách" — đây là chống nó. */
const ENVELOPE_S = 0.02;

type AudioContextCtor = typeof AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Phát chuông tới khi gọi `stop()`. Trả `null` khi môi trường không có WebAudio (SSR · test · trình
 * duyệt cổ) — caller chỉ cần `handle?.stop()`, không phải phân nhánh.
 *
 * ⚠️ **Autoplay policy**: trình duyệt chặn `AudioContext` chạy trước một cử chỉ người dùng. Với chuông
 * ĐI thì không sao (chính cú bấm nút gọi là cử chỉ đó). Với chuông ĐẾN ở một tab chưa ai chạm vào,
 * `resume()` có thể bị từ chối — ta **nuốt** lỗi đó: mất tiếng chuông là phiền, còn ném ra thì giết
 * luôn effect đang dựng UI cuộc gọi đến. Overlay hình vẫn hiện, người dùng vẫn nhận được máy.
 */
export function startRingtone(kind: RingtoneKind): RingtoneHandle | null {
  const Ctor = resolveAudioContextCtor();
  if (!Ctor) return null;

  const pattern = PATTERNS[kind];
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const beep = (frequency: number, atSec: number): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;

    const durationS = pattern.toneMs / 1000;
    // Bao biên độ: 0 → đỉnh → 0. `setValueAtTime(0)` mở màn là bắt buộc, `GainNode` mặc định là 1.
    gain.gain.setValueAtTime(0, atSec);
    gain.gain.linearRampToValueAtTime(pattern.gain, atSec + ENVELOPE_S);
    gain.gain.setValueAtTime(pattern.gain, atSec + durationS - ENVELOPE_S);
    gain.gain.linearRampToValueAtTime(0, atSec + durationS);

    osc.connect(gain).connect(ctx.destination);
    osc.start(atSec);
    // `stop()` giải phóng node — không gọi thì mỗi chu kỳ để lại một oscillator sống, và một cuộc gọi
    // đổ chuông 45 giây tích đủ node để nghe rè.
    osc.stop(atSec + durationS);
  };

  const cycle = (): void => {
    if (stopped) return;
    const now = ctx.currentTime;
    pattern.tones.forEach((frequency, index) => {
      beep(frequency, now + (index * (pattern.toneMs + pattern.gapMs)) / 1000);
    });
    timer = setTimeout(cycle, pattern.cycleMs);
  };

  void ctx.resume().catch(() => undefined);
  cycle();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // `close()` chứ không chỉ `suspend()`: mỗi `AudioContext` chiếm một tài nguyên phần cứng và trình
      // duyệt giới hạn số context sống đồng thời (~6 trên Chrome). Cuộc gọi thứ bảy trong một phiên sẽ
      // im lặng không có chuông nếu ta chỉ suspend.
      void ctx.close().catch(() => undefined);
    },
  };
}
