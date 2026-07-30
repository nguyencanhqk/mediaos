import * as fs from "node:fs";
import * as path from "node:path";

/**
 * ĐỊNH DANH BẢN BUILD (S6-REL-1 · D1 · IMPL-09 §16.2/§17.4).
 *
 * VÌ SAO CÓ: trước WO này không có cách nào hỏi một môi trường đang chạy "anh là bản nào".
 * `m prod-restart` làm PID/log/env trông như đã deploy trong khi `dist` vẫn là code CŨ — nghĩa là
 * smoke sau deploy, canary và rollback đều chỉ chứng minh được "một cái gì đó đang sống", KHÔNG
 * chứng minh được "bản vừa deploy đang sống". Không có định danh build thì §17.4 (smoke) và §17.7
 * (verify rollback) không có gì để assert.
 *
 * NGUỒN: `apps/api/dist/build-info.json`, do `scripts/stamp-build.mjs` sinh ở CUỐI mỗi `nest build`
 * (xem `apps/api/package.json` → script `build`). Không sinh từ runtime: giá trị phải đóng băng theo
 * ARTIFACT, không theo thư mục làm việc lúc chạy — nếu đọc `git rev-parse` lúc boot thì một service
 * đang chạy dist CŨ vẫn khai sha MỚI của repo, tức đúng lại cái bẫy nó sinh ra để chặn.
 *
 * FAIL-SAFE: `/health` là liveness — KHÔNG BAO GIỜ được 500 vì thiếu file/JSON hỏng. Mọi lỗi ⇒ trường
 * đó là `"unknown"`. `"unknown"` là tín hiệu THẬT ("build này không stamp"), không phải giá trị rác:
 * `release-smoke.mjs --expect-commit` coi `unknown` là ĐỎ, nên bản không stamp không lọt cổng smoke.
 */
export type BuildInfo = {
  /** Version từ `package.json` root lúc build (vd `1.0.0-rc.1`). */
  version: string;
  /** Short SHA của commit đã build (vd `c4afe351`). */
  commit: string;
  /** Thời điểm build, ISO-8601 UTC. */
  builtAt: string;
  /** Tag migration cuối trong journal LÚC BUILD — dùng đối chiếu với DB để phát hiện lệch schema. */
  migrationHead: string;
};

export const UNKNOWN = "unknown";

export const EMPTY_BUILD_INFO: BuildInfo = {
  version: UNKNOWN,
  commit: UNKNOWN,
  builtAt: UNKNOWN,
  migrationHead: UNKNOWN,
};

/** Tên file stamp — dùng chung với `scripts/stamp-build.mjs` (đổi ở đây phải đổi cả bên đó). */
export const BUILD_INFO_FILENAME = "build-info.json";

/**
 * Đường mặc định: file nằm ở GỐC `dist`, module này biên dịch ra `dist/health/` ⇒ đi lên một cấp.
 * Khi chạy test (`src/health/`) sẽ trỏ vào `src/build-info.json` — cố ý KHÔNG tồn tại, để test đo đúng
 * nhánh "chưa stamp". `typeof __dirname` (không phải `__dirname` trần) để không ném ở ngữ cảnh ESM.
 */
export function defaultBuildInfoPath(): string {
  const base = typeof __dirname === "string" ? __dirname : process.cwd();
  return path.join(base, "..", BUILD_INFO_FILENAME);
}

/** Chỉ nhận chuỗi có nội dung; số/null/rỗng/khoảng-trắng ⇒ `unknown`. */
function str(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : UNKNOWN;
}

/**
 * Đọc định danh build. KHÔNG ném trong mọi trường hợp (thiếu file · JSON hỏng · không đọc được ·
 * JSON hợp lệ nhưng không phải object) — trả `unknown` cho trường không đọc được.
 *
 * @param filePath ghi đè đường dẫn (test + `MEDIAOS_BUILD_INFO_PATH` cho ca vận hành đặc biệt).
 */
export function readBuildInfo(filePath?: string): BuildInfo {
  const target = filePath ?? process.env["MEDIAOS_BUILD_INFO_PATH"] ?? defaultBuildInfoPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return { ...EMPTY_BUILD_INFO };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ...EMPTY_BUILD_INFO };
  }
  const raw = parsed as Record<string, unknown>;
  return {
    version: str(raw["version"]),
    commit: str(raw["commit"]),
    builtAt: str(raw["builtAt"]),
    migrationHead: str(raw["migrationHead"]),
  };
}
