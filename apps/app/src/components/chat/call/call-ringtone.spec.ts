/**
 * call-ringtone.spec.ts — chuông WebAudio (S7-CALL-QA-2, điểm mù #4/1.241 dòng).
 *
 * jsdom KHÔNG cài `AudioContext` — đúng nhánh SSR/trình-duyệt-cổ mà `resolveAudioContextCtor` phải xử lý
 * êm (trả `null`). Các bài "có AudioContext" stub một lớp giả tối thiểu qua `vi.stubGlobal`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRingtone } from "./call-ringtone";

class FakeAudioParam {
  value = 0;
  readonly setValueAtTime = vi.fn();
  readonly linearRampToValueAtTime = vi.fn();
}

class FakeGainNode {
  readonly gain = new FakeAudioParam();
  readonly connect = vi.fn((dest: unknown) => dest);
}

class FakeOscillatorNode {
  type = "";
  readonly frequency = new FakeAudioParam();
  readonly connect = vi.fn((dest: unknown) => dest);
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  readonly destination = {};
  readonly createOscillator = vi.fn(() => new FakeOscillatorNode());
  readonly createGain = vi.fn(() => new FakeGainNode());
  readonly resume = vi.fn().mockResolvedValue(undefined);
  readonly close = vi.fn().mockResolvedValue(undefined);

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

beforeEach(() => {
  FakeAudioContext.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("môi trường không có WebAudio (SSR / trình duyệt cổ)", () => {
  it("window.AudioContext vắng mặt ⇒ trả null, caller chỉ cần `handle?.stop()`", () => {
    expect(startRingtone("incoming")).toBeNull();
  });

  it("`new AudioContext()` ném (trình duyệt chặn) ⇒ nuốt, trả null — không giết effect đang dựng UI", () => {
    class ThrowingCtor {
      constructor() {
        throw new Error("blocked");
      }
    }
    vi.stubGlobal("AudioContext", ThrowingCtor);
    expect(startRingtone("incoming")).toBeNull();
  });
});

describe("có AudioContext — dựng đúng nhịp theo `kind`", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  it("chuông ĐẾN: 2 tiếng/chu kỳ (880Hz, 660Hz), gain cao hơn chuông đi", () => {
    const handle = startRingtone("incoming");
    expect(handle).not.toBeNull();
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);

    const oscCalls = ctx.createOscillator.mock.results.map((r) => r.value as FakeOscillatorNode);
    expect(oscCalls.map((o) => o.frequency.value)).toEqual([880, 660]);

    const gainCalls = ctx.createGain.mock.results.map((r) => r.value as FakeGainNode);
    expect(gainCalls[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.18,
      expect.any(Number),
    );
  });

  it("chuông ĐI: 1 tiếng trầm/chu kỳ (440Hz), gain thấp hơn — người gọi đang chờ, không cần bị thúc", () => {
    startRingtone("outgoing");
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    const osc = ctx.createOscillator.mock.results[0]!.value as FakeOscillatorNode;
    expect(osc.frequency.value).toBe(440);
    const gain = ctx.createGain.mock.results[0]!.value as FakeGainNode;
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.08, expect.any(Number));
  });

  it("resume() bị từ chối (autoplay policy) ⇒ nuốt lỗi, chuông vẫn dựng (overlay hình vẫn hiện)", async () => {
    class RejectingResumeCtor extends FakeAudioContext {
      readonly resume = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    }
    vi.stubGlobal("AudioContext", RejectingResumeCtor);
    const handle = startRingtone("incoming");
    expect(handle).not.toBeNull();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("stop() dừng lịch chu kỳ TIẾP THEO (KHÔNG rè máy) + đóng hẳn AudioContext (không chỉ suspend)", async () => {
    vi.useFakeTimers();
    const handle = startRingtone("outgoing");
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);

    // Chu kỳ kế tiếp (3000ms với "outgoing") CHƯA bị chặn — dựng thêm 1 oscillator.
    await vi.advanceTimersByTimeAsync(3000);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);

    handle?.stop();
    expect(ctx.close).toHaveBeenCalledTimes(1);

    // Sau stop(), KHÔNG còn chu kỳ nào được lên lịch nữa dù đồng hồ trôi tiếp.
    await vi.advanceTimersByTimeAsync(3000);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it("close() bị từ chối ⇒ nuốt lỗi, stop() không ném", async () => {
    class RejectingCloseCtor extends FakeAudioContext {
      readonly close = vi.fn().mockRejectedValue(new Error("already closed"));
    }
    vi.stubGlobal("AudioContext", RejectingCloseCtor);
    const handle = startRingtone("outgoing");
    expect(() => handle?.stop()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("mỗi tiếng gọi osc.stop() để giải phóng node — không thì mỗi chu kỳ rò một oscillator sống", () => {
    startRingtone("incoming");
    const ctx = FakeAudioContext.instances[0];
    for (const result of ctx.createOscillator.mock.results) {
      const osc = result.value as FakeOscillatorNode;
      expect(osc.start).toHaveBeenCalledTimes(1);
      expect(osc.stop).toHaveBeenCalledTimes(1);
    }
  });
});
