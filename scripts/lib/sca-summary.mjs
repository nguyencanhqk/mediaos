// scripts/lib/sca-summary.mjs — S19-OPS-SCASATELLITE-1 (plan §4). Hàm THUẦN, không I/O.
//
// Dùng bởi scripts/sca-satellites.mjs (`m sca`) để đọc kết quả `npm audit --json` / `pnpm audit --json`
// của hai app vệ tinh có lockfile riêng (apps/fbpost, apps/lms) — cổng pnpm workspace mù với hai app này.
//
// Luật nền: KHÔNG ĐO ĐƯỢC ≠ SẠCH.
//   - summarizeAudit: thiếu khoá / không phải số nguyên ≥ 0 / JSON hỏng ⇒ NÉM, không bao giờ coi là 0.
//   - verdict: JSON và exit code là HAI nguồn độc lập; chỉ khi cả hai cùng nói "sạch" mới trả 0, cùng nói
//     "bẩn" mới trả 1 — mọi lệch (hoặc exit code không có) ⇒ 2 "không đo được".
//   - countNonRegistry: quy tắc DƯƠNG — chỉ công nhận resolution đến từ registry khi khớp đúng một dạng
//     biết trước; mọi dạng khác (tarball, git, thư mục, mirror lạ, tiền tố giả mạo) đều bị đếm.

const SEVERITIES = ["critical", "high", "moderate", "low"];
const NPM_REGISTRY_PREFIX = "https://registry.npmjs.org/";
// pnpm ghi resolution của gói registry mặc định ĐÚNG một khoá integrity (sha512/sha1 base64).
const PNPM_REGISTRY_RESOLUTION = /^\{integrity: sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}\}$/;

class UnmeasurableError extends Error {
  constructor(reason) {
    super(`không đo được: ${reason}`);
    this.name = "UnmeasurableError";
  }
}

function parseJson(text, what) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new UnmeasurableError(`${what} rỗng`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UnmeasurableError(`${what} không phải JSON (${err.message})`);
  }
}

/**
 * Đọc `metadata.vulnerabilities` (npm và pnpm cùng hình dạng) → {critical, high, moderate, low}.
 * @param {string|object} input — stdout của `audit --json` (chuỗi) hoặc object đã parse.
 */
export function summarizeAudit(input) {
  const json = typeof input === "string" ? parseJson(input, "đầu ra audit") : input;
  const vulns = json?.metadata?.vulnerabilities;
  if (vulns === null || typeof vulns !== "object") {
    throw new UnmeasurableError("đầu ra audit thiếu metadata.vulnerabilities");
  }
  const counts = {};
  for (const sev of SEVERITIES) {
    const n = vulns[sev];
    if (!Number.isInteger(n) || n < 0) {
      throw new UnmeasurableError(
        `metadata.vulnerabilities.${sev} không phải số nguyên ≥ 0 (${JSON.stringify(n)})`,
      );
    }
    counts[sev] = n;
  }
  return counts;
}

/**
 * 0 = sạch (JSON 0 high/critical VÀ exit 0) · 1 = có high/critical (JSON VÀ exit ≠ 0 cùng nói) ·
 * 2 = không đo được (counts thiếu, exit code không phải số nguyên, hoặc hai nguồn lệch nhau).
 */
export function verdict(counts, exitCode) {
  if (counts === null || typeof counts !== "object" || !Number.isInteger(exitCode)) return 2;
  const dirty = counts.critical + counts.high > 0;
  if (!dirty && exitCode === 0) return 0;
  if (dirty && exitCode !== 0) return 1;
  return 2;
}

function npmNonRegistry(lockText) {
  const lock = parseJson(lockText, "package-lock.json");
  const pkgs = lock?.packages;
  if (pkgs === null || typeof pkgs !== "object" || Array.isArray(pkgs)) {
    throw new UnmeasurableError("package-lock.json thiếu khối packages (cần lockfileVersion ≥ 2)");
  }
  const names = new Set();
  for (const [key, entry] of Object.entries(pkgs)) {
    if (key === "" || entry?.link === true || entry?.inBundle === true) continue;
    const resolved = entry?.resolved;
    if (typeof resolved === "string" && resolved.startsWith(NPM_REGISTRY_PREFIX)) continue;
    names.add(entry?.name ?? key.split("node_modules/").pop());
  }
  return names;
}

function pnpmPackageName(keyLine) {
  const key = keyLine
    .trim()
    .replace(/:$/, "")
    .replace(/^'(.*)'$/, "$1");
  const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  return at > 0 ? key.slice(0, at) : key;
}

function pnpmNonRegistry(lockText) {
  if (typeof lockText !== "string") throw new UnmeasurableError("pnpm-lock.yaml không đọc được");
  const lines = lockText.split(/\r?\n/);
  const start = lines.findIndex((l) => l === "packages:");
  if (start < 0) throw new UnmeasurableError("pnpm-lock.yaml thiếu khối packages");
  const names = new Set();
  let current = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // hết khối packages (snapshots:, …)
    if (/^ {2}\S.*:$/.test(line)) {
      current = pnpmPackageName(line);
      continue;
    }
    const m = /^ {4}resolution:(.*)$/.exec(line);
    if (!m) continue;
    let value = m[1].trim();
    if (value === "") {
      // block-style: gom các dòng thụt sâu hơn thành dạng flow để áp cùng một quy tắc dương.
      const parts = [];
      while (i + 1 < lines.length && /^ {6}\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = `{${parts.join(", ")}}`;
    }
    if (!PNPM_REGISTRY_RESOLUTION.test(value)) names.add(current ?? "(không rõ tên)");
  }
  return names;
}

/**
 * Đếm resolution không đến từ registry trong lockfile (npm `resolved` · pnpm `resolution`).
 * Dòng này KHÔNG đổi exit code của `m sca` (không phải advisory) — nó nhắc rằng audit mù với các gói đó.
 * @param {string} lockText
 * @param {"npm"|"pnpm"} kind
 * @returns {{count: number, names: string[]}}
 */
export function countNonRegistry(lockText, kind) {
  let names;
  if (kind === "npm") names = npmNonRegistry(lockText);
  else if (kind === "pnpm") names = pnpmNonRegistry(lockText);
  else throw new UnmeasurableError(`loại lockfile lạ: ${JSON.stringify(kind)}`);
  const sorted = [...names].sort();
  return { count: sorted.length, names: sorted };
}

// ── Cây ĐÃ CÀI so với lockfile (gate SCA-1) ────────────────────────────────────────────────────────────────────
// audit chỉ đọc LOCKFILE. Đổi lockfile (pull bản vá) mà quên cài lại ⇒ build chạy cây CŨ trong khi audit báo
// xanh về thứ không chạy. npm ghi bản sao cây đã cài ở `node_modules/.package-lock.json`, pnpm ở
// `node_modules/.pnpm/lock.yaml` — đối chiếu bản sao đó với lockfile. Bản sao hỏng ⇒ ném (KHÔNG coi là khớp).
const PNPM_KEYED_SECTIONS = new Set(["packages", "snapshots"]);

function pnpmKeySet(text, label) {
  if (!/^lockfileVersion:/m.test(text))
    throw new UnmeasurableError(`${label} không phải pnpm lockfile`);
  const keys = new Set();
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      section = /^([A-Za-z]+):\s*$/.exec(line)?.[1] ?? null;
      continue;
    }
    if (!PNPM_KEYED_SECTIONS.has(section)) continue;
    const m = /^ {2}(?! )(['"]?)(.+?)\1:\s*(\{\})?\s*$/.exec(line);
    if (m) keys.add(`${section}:${m[2]}`);
  }
  return keys;
}

function npmPackageMap(text, label) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new UnmeasurableError(`${label} JSON lỗi (${err.message})`);
  }
  const pkgs = json?.packages;
  if (!pkgs || typeof pkgs !== "object" || Array.isArray(pkgs))
    throw new UnmeasurableError(`${label} thiếu khoá packages`);
  return pkgs;
}

/**
 * Đếm lệch giữa lockfile (`wantedText`) và bản sao cây đã cài (`currentText`).
 * extra = có trong cây cài, không có trong lockfile (vd. gói lồng cũ còn sót) · missing = lockfile có, cây cài
 * không (npm: bỏ qua gói dev/optional — nền tảng khác hoặc cài --omit=dev) · changed = cùng chỗ, khác bản (npm;
 * với pnpm phiên bản nằm trong khoá nên lệch bản hiện thành extra + missing).
 */
export function installDrift(wantedText, currentText, kind) {
  if (kind === "pnpm") {
    const wanted = pnpmKeySet(wantedText, "lockfile");
    const current = pnpmKeySet(currentText, "bản sao cây đã cài");
    return {
      extra: [...current].filter((k) => !wanted.has(k)).length,
      missing: [...wanted].filter((k) => !current.has(k)).length,
      changed: 0,
    };
  }
  if (kind === "npm") {
    const wanted = npmPackageMap(wantedText, "lockfile");
    const current = npmPackageMap(currentText, "bản sao cây đã cài");
    let extra = 0;
    let changed = 0;
    let missing = 0;
    for (const [key, entry] of Object.entries(current)) {
      if (key === "") continue;
      if (!Object.hasOwn(wanted, key)) extra++;
      else if (wanted[key]?.version !== entry?.version) changed++;
    }
    for (const [key, entry] of Object.entries(wanted)) {
      if (key === "" || Object.hasOwn(current, key)) continue;
      if (entry?.dev || entry?.optional || entry?.devOptional) continue;
      missing++;
    }
    return { extra, missing, changed };
  }
  throw new UnmeasurableError(`loại lockfile lạ: ${JSON.stringify(kind)}`);
}
