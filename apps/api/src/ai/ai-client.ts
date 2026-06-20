import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL_IDS, type AiModelId } from "@mediaos/contracts";

/**
 * AI-1 — AiClient: wrapper @anthropic-ai/sdk (read-only). Gọi Claude tóm tắt insight.
 *
 * Bất biến #3 (secret): ANTHROPIC_API_KEY CHỈ đọc từ env (process.env). KHÔNG hardcode, KHÔNG log key,
 * KHÔNG đưa key vào response/DTO. Đọc LAZY + fail-fast lúc DÙNG (mirror worker-role/KMS): thiếu key →
 * ServiceUnavailableException rõ ràng, KHÔNG nuốt lỗi im lặng, KHÔNG fail-open gọi với key rỗng.
 *
 * Model id từ allowlist (AI_MODEL_IDS = {claude-opus-4-8, claude-sonnet-4-6}); AI_MODEL env chọn default.
 * KHÔNG hậu tố ngày (404). KHÔNG temperature/top_p/budget_tokens (4.8 reject) — dùng adaptive thinking.
 *
 * KHÔNG log prompt/response (có thể chứa dữ liệu tenant) — chỉ trả text. Test inject AiClient = MOCK (DI)
 * nên KHÔNG gọi API thật / tốn token.
 */

const DEFAULT_MODEL: AiModelId = "claude-opus-4-8";
/** Trần output tóm tắt — insight ngắn (3-5 câu) nên không cần lớn; không stream cho non-streaming gọn. */
const MAX_TOKENS = 1024;

export interface AiSummarizeOptions {
  /** Override model (phải thuộc allowlist). Mặc định: AI_MODEL env → DEFAULT_MODEL. */
  model?: AiModelId;
}

export interface AiSummarizeResult {
  summary: string;
  model: AiModelId;
}

@Injectable()
export class AiClient {
  /** Lazy singleton client — khởi tạo lần đầu summarize (tránh giữ key trong field dài hạn). */
  private client: Anthropic | null = null;

  /**
   * Đọc key từ env (KHÔNG hardcode). Thiếu/rỗng → ServiceUnavailableException (config lỗi rõ ràng), KHÔNG
   * fail-open. KHÔNG log key. Tách hàm để test dễ kiểm fail-path mà không gọi API thật.
   */
  private requireApiKey(): string {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key || key.trim().length === 0) {
      throw new ServiceUnavailableException(
        "AI insight chưa cấu hình: thiếu ANTHROPIC_API_KEY (đặt qua biến môi trường).",
      );
    }
    return key;
  }

  /**
   * Model dùng: ưu tiên override → AI_MODEL env (nếu hợp lệ allowlist) → DEFAULT_MODEL. Giá trị env ngoài
   * allowlist bị BỎ QUA (fail-safe về default) thay vì 404 lúc gọi — env không tin tuyệt đối.
   */
  resolveModel(override?: AiModelId): AiModelId {
    if (override && (AI_MODEL_IDS as readonly string[]).includes(override)) return override;
    const envModel = process.env.AI_MODEL;
    if (envModel && (AI_MODEL_IDS as readonly string[]).includes(envModel)) {
      return envModel as AiModelId;
    }
    return DEFAULT_MODEL;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      // SDK đọc key qua constructor; ta truyền tường minh từ env (KHÔNG để SDK tự đọc để fail-fast rõ).
      this.client = new Anthropic({ apiKey: this.requireApiKey() });
    }
    return this.client;
  }

  /**
   * Gọi Claude tóm tắt prompt → trả text. read-only (không side-effect). Lỗi mạng/SDK → bubble lên
   * (không nuốt). KHÔNG log prompt/response. Narrow content block type='text' (theo TS SDK).
   */
  async summarize(prompt: string, opts: AiSummarizeOptions = {}): Promise<AiSummarizeResult> {
    const model = this.resolveModel(opts.model);
    const client = this.getClient();

    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: prompt }],
    });

    const summary = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    return { summary, model };
  }
}
