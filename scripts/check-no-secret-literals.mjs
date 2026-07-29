#!/usr/bin/env node
/**
 * check-no-secret-literals.mjs — CHỐT HỒI QUY cho S6-SEC-ROTATE-1 (KI-043).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO
 *
 * Repo này PUBLIC. Tới 2026-07-28 nó chứa mật khẩu SUPERUSER Postgres của cụm PROD dưới dạng "giá trị
 * mặc định cho tiện" (họ `changeme_*`) ở 17 file tracked, và `docker-compose.yml` bind cụm ra `0.0.0.0`.
 * Hai thứ đó cộng lại là một lỗ hổng đang mở, không phải nợ kỹ thuật.
 *
 * Rotate mật khẩu KHÔNG đóng được lỗ hổng nếu literal có thể bò trở lại — đúng lớp lỗi KI-036 (vá ngọn,
 * để nguyên cái tự khôi phục). File này là cái chốt: bất kỳ ai (người hay agent) đưa literal về, hoặc gỡ
 * bind loopback, đều làm ĐỎ ngay tại `harness/check.sh` và CI.
 *
 * Chạy:  node scripts/check-no-secret-literals.mjs        (exit 1 nếu vi phạm)
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * BA BÀI HỌC ĐÃ TRẢ GIÁ, ĐỪNG ĐẢO NGƯỢC
 *
 * 1. QUÉT CẢ FILE CHƯA TRACKED. Bản đầu dùng `git ls-files` (chỉ file ĐÃ tracked) ⇒ hai file MỚI của
 *    chính WO này không hề được quét, cổng báo XANH suốt, và chỉ ĐỎ sau khi commit. Một cổng bảo mật
 *    mù với file mới là mù với đúng thứ rủi ro nhất. Nay dùng `--cached --others --exclude-standard`
 *    (file đã tracked + file mới chưa gitignore). `.env` vẫn bị loại vì nằm trong .gitignore.
 *
 * 2. DANH SÁCH TRẮNG, KHÔNG DANH SÁCH ĐEN. Luật bind-cổng bản đầu liệt kê "các dạng xấu" ⇒ FULL gate
 *    dựng được 10 ca publish ra 0.0.0.0 mà cổng vẫn xanh (flow-style · anchor · alias · comment cuối
 *    dòng khoá · seq cùng độ thụt · hostname bị nhận nhầm long-syntax · tên file khác…). Nay: hình dạng
 *    nào KHÔNG hiểu được thì ĐỎ.
 *
 * 3. ĐỪNG TIN TÊN FILE. Bản đầu chỉ soi `docker-compose*.yml` ở gốc và `.env*.example`. Đổi tên file là
 *    lách được. Nay: quét MỌI `.y(a)ml` rồi tự nhận diện compose bằng nội dung (`services:`), và mở
 *    rộng họ file mẫu env sang `.sample`/`.template`/`.dist`/`env.example` (không dấu chấm đầu).
 *
 * NGUYÊN TẮC: KHÔNG danh sách miễn trừ. Mỗi ngoại lệ là một chỗ để literal quay lại. Cần nhắc tới họ
 * literal cũ trong văn bản thì viết `changeme_*` (có dấu sao) — cố ý không khớp luật 1.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Phần mở rộng nhị phân / sinh tự động — không quét. */
const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|webm|dump|lock|xlsx?|docx?)$/i;

/** File tự nó ĐỊNH NGHĨA các luật — nếu quét sẽ tự khớp chính mẫu của mình. */
const SELF = "scripts/check-no-secret-literals.mjs";

/** Họ file "mẫu env": thứ người ta copy thành `.env` rồi chạy thẳng. */
const ENV_EXAMPLE_FILES = /(^|\/)\.?env[^/]*\.(example|sample|template|dist)$/i;

/**
 * Khoá mang secret — nhận theo HÌNH DẠNG TÊN, không theo danh sách liệt kê.
 * FULL gate vòng 2: bản liệt kê bỏ sót SMTP_PASSWORD · VALKEY_PASSWORD · ADMIN_PASSWORD · LMS_NOTI_TOKEN.
 *
 * CỐ Ý KHÔNG dùng `_KEY$` trần: `S3_ACCESS_KEY` là ĐỊNH DANH công khai (cặp của nó, `S3_SECRET_KEY`,
 * mới là bí mật — và đã khớp qua `SECRET`). Bắt cả access-key-id sẽ dạy người ta rằng cổng này hay báo
 * oan, và cổng hay báo oan là cổng sẽ bị tắt. Các dạng khoá THẬT SỰ mang bí mật được liệt kê tường minh.
 */
const SECRET_KEY_SHAPE = /(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|API_KEY|PRIVATE_KEY)$/i;

/** Giá trị hợp lệ trong file mẫu: rỗng · placeholder cố ý sai · biến `${…}`. */
function isPlaceholder(v) {
  const s = stripQuotes(v.trim());
  return s === "" || s === "__SET_ME__" || s.startsWith("${");
}

function stripQuotes(v) {
  const m = v.match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2] : v;
}

/** Tách `KEY=VALUE` của file env, chấp nhận tiền tố `export ` và khoá có `-`/`.`. */
function parseEnvLine(line) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_.-]+)\s*=\s*([\s\S]*)$/);
  return m ? { key: m[1], raw: m[2].trim() } : null;
}

const RULES = [
  {
    id: "db-password-literal",
    // Họ literal đã từng LÀ mật khẩu thật của cụm PROD. Yêu cầu ít nhất một ký tự chữ-số sau dấu gạch
    // dưới, nên `changeme_*` trong văn xuôi KHÔNG khớp. Cờ `i`: biến thể VIẾT HOA từng lọt.
    re: /changeme_[A-Za-z0-9]/gi,
    why: [
      "Literal họ `changeme_*` là mật khẩu THẬT của cụm Postgres PROD trước 2026-07-28 (KI-043).",
      "Không đặt lại giá trị mặc định chạy được cho secret: dùng `__SET_ME__` trong file mẫu env,",
      "và đọc từ env ở đường chạy thật (scripts/lib/db-secrets.sh · scripts/setup-db-roles.mjs).",
      "Nhắc tới họ literal cũ trong VĂN XUÔI thì viết `changeme_*` (có dấu sao) — cố ý không khớp.",
    ].join("\n    "),
  },
  {
    id: "env-example-real-secret",
    files: ENV_EXAMPLE_FILES,
    lineRe: /^(?!\s*#)(.*)$/,
    lineCheck: (m) => {
      const kv = parseEnvLine(m[1]);
      if (!kv || !SECRET_KEY_SHAPE.test(kv.key)) return false;
      return !isPlaceholder(kv.raw);
    },
    why: [
      "File mẫu env là thứ người ta `cp` thành .env rồi chạy thẳng (CLAUDE.md §7).",
      "Một giá trị 'tiện' ở đây trở thành secret PROD ở nơi khác — đúng đường KI-027 và KI-043 đã đi.",
      "Mọi khoá tên kiểu *_PASSWORD/_SECRET/_TOKEN/_KEY phải để `__SET_ME__` (cố ý không hợp lệ).",
    ].join("\n    "),
  },
  {
    id: "env-example-secret-in-url",
    // Mật khẩu nhét trong userinfo của connection string — ĐÚNG hình dạng đã gây ra KI-043
    // (`DATABASE_URL=postgres://mediaos_app:<mật khẩu thật>@…`). gitleaks bỏ qua dạng này (nó soi
    // `KEY=value`), nên đây là cổng DUY NHẤT chặn. Vòng 2: phải bóc nháy trước khi khớp — bản đầu đòi
    // scheme đứng ngay sau `=` nên `KEY="postgres://…"` lọt sạch.
    files: ENV_EXAMPLE_FILES,
    lineRe: /^(?!\s*#)(.*)$/,
    lineCheck: (m) => {
      const kv = parseEnvLine(m[1]);
      if (!kv) return false;
      const url = stripQuotes(kv.raw);
      const u = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^@/\s]*)@/i);
      if (!u) return false;
      const userinfo = u[1];
      if (!userinfo.includes(":")) return false; // chỉ có user, không có mật khẩu
      return !isPlaceholder(userinfo.slice(userinfo.indexOf(":") + 1));
    },
    why: [
      "Connection string trong file mẫu mang mật khẩu thật — ĐÚNG hình dạng đã làm rò cụm PROD (KI-043).",
      "gitleaks KHÔNG bắt dạng này (nó soi `KEY=value`), nên đây là cổng duy nhất chặn.",
      "Để `postgres://user:__SET_ME__@host:port/db`.",
    ].join("\n    "),
  },
  {
    id: "compose-port-wide-bind",
    // KHÔNG tin tên file: quét mọi YAML, tự nhận diện compose bằng nội dung (xem bài học 3 ở đầu file).
    files: /\.ya?ml$/i,
    fileScan: scanComposePorts,
    why: [
      "Port publish không bind loopback ⇒ Docker nghe trên MỌI interface (0.0.0.0).",
      "Cụm PROD chạy trên chính máy này: Postgres/Valkey/MinIO lộ ra ngoài là bề mặt tấn công trực tiếp.",
      'Dùng "${INFRA_BIND_ADDR:-127.0.0.1}:<host>:<container>" (short) hoặc khai `host_ip:` (long syntax).',
      "Muốn mở ra ngoài thì đặt INFRA_BIND_ADDR trong .env — CÓ CHỦ ĐÍCH, không phải mặc định.",
    ].join("\n    "),
  },
];

/** Địa chỉ bind được coi là AN TOÀN (loopback). Ngoài danh sách này ⇒ ĐỎ. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Khoá HỢP LỆ của long-syntax `ports:` (compose spec). Ngoài danh sách ⇒ coi là scalar, không phải key. */
const LONG_PORT_KEYS = new Set([
  "target",
  "published",
  "host_ip",
  "protocol",
  "mode",
  "name",
  "app_protocol",
]);

/**
 * Một mục `ports:` dạng ngắn có vi phạm không? Trả `null` nếu an toàn, hoặc lý do.
 * DANH SÁCH TRẮNG: phải mở đầu bằng địa chỉ loopback tường minh, hoặc `${VAR:-<loopback>}`.
 */
function shortPortViolation(rawSpec) {
  const spec = stripQuotes(rawSpec.trim()).trim();
  if (!spec) return null;

  const varAtStart = spec.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}:/);
  if (varAtStart) {
    const def = (varAtStart[2] ?? "").trim();
    if (LOOPBACK.has(def)) return null;
    // KHÔNG có default ⇒ compose thay bằng RỖNG ⇒ `:PORT:PORT` ⇒ 0.0.0.0. Fail-closed (vòng 2).
    if (def === "") return `\`\${${varAtStart[1]}}\` không có default loopback (rỗng ⇒ 0.0.0.0)`;
    if (/^\d+$/.test(def))
      return `thiếu địa chỉ bind (\`\${${varAtStart[1]}}\` là CỔNG, không phải địa chỉ)`;
    return `biến bind có default KHÔNG loopback: \`${def}\``;
  }

  const v6 = spec.match(/^\[([^\]]*)\]:/);
  if (v6) return LOOPBACK.has(v6[1]) ? null : `bind IPv6 KHÔNG loopback: \`[${v6[1]}]\``;

  const v4 = spec.match(/^([A-Za-z0-9_.-]+):(?=.*:)/);
  if (v4) return LOOPBACK.has(v4[1]) ? null : `bind KHÔNG loopback: \`${v4[1]}\``;

  return "thiếu địa chỉ bind (Docker publish ra 0.0.0.0)";
}

/** Tách các phần tử của một flow-sequence YAML `[a, "b", 'c']`. */
function splitFlowItems(inner) {
  return inner
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Quét khai báo cổng của một compose file. Fail-closed: dạng khai báo KHÔNG hiểu được ⇒ báo vi phạm.
 * Chỉ chạy khi file thật sự trông như compose (có khoá `services:` ở cột 0).
 */
function scanComposePorts(lines) {
  const text = lines.join("\n");
  // Nhận diện compose bằng CẤU TRÚC, không bằng tên file: `services:` là khoá TOP-LEVEL (cột 0).
  // KHÔNG được nới thành `^\s*services:` — workflow GitHub Actions cũng có khoá `services:` (service
  // container) nhưng LỒNG trong job, và cổng của nó chạy trên runner ephemeral, không phải máy PROD.
  // Nới ra là ăn 4 báo oan ở ci.yml/api.yml (đã đo), mà cổng hay báo oan là cổng sẽ bị tắt.
  // Khoá có thể có nháy (YAML cho phép, JSON bắt buộc).
  //
  // Compose viết THUẦN JSON (YAML là siêu tập của JSON ⇒ vẫn là compose hợp lệ): cả file nằm trong một
  // cặp `{}` nên `"services"` KHÔNG ở cột 0 và scanner theo dòng cũng không thấy gì. Tách nhánh riêng,
  // parse thẳng. Vòng 2 đã dựng đúng ca này và nó lọt.
  if (text.trimStart().startsWith("{")) {
    return /"services"\s*:/.test(text) ? scanComposeJson(text) : [];
  }

  const isCompose = /^["']?services["']?\s*:/m.test(text);
  if (!isCompose) return [];

  const out = [];
  let portsIndent = null;
  let item = null; // mục long-syntax đang gom

  const flush = () => {
    if (!item) return;
    if (item.published !== null) {
      if (item.hostIp === null) {
        out.push({ line: item.start, text: "ports (long syntax) thiếu `host_ip:`" });
      } else if (!LOOPBACK.has(stripQuotes(item.hostIp))) {
        out.push({ line: item.start, text: `ports host_ip KHÔNG loopback: \`${item.hostIp}\`` });
      }
    }
    item = null;
  };

  lines.forEach((line, i) => {
    // `network_mode: host` bỏ qua toàn bộ cơ chế publish — container dùng thẳng network của host.
    if (/^\s*network_mode:\s*["']?host["']?\s*(#.*)?$/.test(line)) {
      out.push({
        line: i + 1,
        text: "network_mode: host — container nghe THẲNG trên mọi interface",
      });
    }

    if (!line.trim() || /^\s*#/.test(line)) return;
    const indent = line.length - line.trimStart().length;

    const portsHere = line.match(/^(\s*)ports\s*:(.*)$/);
    if (portsHere) {
      flush();
      portsIndent = indent;
      const rest = portsHere[2].replace(/\s+#.*$/, "").trim();
      if (rest === "") return; // block style — xử ở các dòng sau

      if (rest.startsWith("[")) {
        // flow style: ports: ["0.0.0.0:1:2", ...]
        const inner = rest.slice(
          1,
          rest.lastIndexOf("]") === -1 ? undefined : rest.lastIndexOf("]"),
        );
        for (const it of splitFlowItems(inner)) {
          const reason = shortPortViolation(it);
          if (reason) out.push({ line: i + 1, text: `${it}   ← ${reason}` });
        }
        portsIndent = null;
        return;
      }
      // anchor `&x`, alias `*x`, JSON, hoặc bất kỳ dạng nào khác ⇒ KHÔNG hiểu ⇒ fail-closed.
      out.push({
        line: i + 1,
        text: `ports: ${rest}   ← dạng khai báo KHÔNG kiểm được (anchor/alias/khác) — fail-closed`,
      });
      portsIndent = null;
      return;
    }

    if (portsIndent === null) return;

    const itemMatch = line.match(/^\s*-\s*(.*)$/);
    // YAML cho phép phần tử `-` THỤT BẰNG khoá `ports:` — thoát khối chỉ khi thụt ÍT HƠN, hoặc bằng mà
    // không phải phần tử dãy. Bản đầu dùng `<=` nên bỏ sót đúng cách viết rất phổ biến này.
    if (indent < portsIndent || (indent === portsIndent && !itemMatch)) {
      flush();
      portsIndent = null;
      return;
    }

    if (itemMatch) {
      flush();
      const rest = itemMatch[1].replace(/\s+#.*$/, "").trim();
      if (!rest) {
        item = { start: i + 1, hostIp: null, published: null };
        return;
      }
      const kv = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      // CHỈ coi là long-syntax khi khoá nằm trong danh sách của compose spec. Nếu không, `- dbhost:1:2`
      // (bind ra hostname) bị nhận nhầm là key và lọt hoàn toàn.
      if (kv && LONG_PORT_KEYS.has(kv[1].toLowerCase())) {
        item = { start: i + 1, hostIp: null, published: null };
        applyLongKey(item, kv[1], kv[2]);
        return;
      }
      const reason = shortPortViolation(rest);
      if (reason) out.push({ line: i + 1, text: `${rest}   ← ${reason}` });
      return;
    }

    if (item) {
      const kv = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (kv && LONG_PORT_KEYS.has(kv[1].toLowerCase())) applyLongKey(item, kv[1], kv[2]);
    }
  });

  flush();
  return out;
}

/** Compose viết thuần JSON: duyệt AST thay vì quét dòng. Parse hỏng ⇒ ĐỎ (fail-closed). */
function scanComposeJson(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return [{ line: 1, text: "compose dạng JSON nhưng parse HỎNG — fail-closed" }];
  }
  const out = [];
  for (const [name, svc] of Object.entries(doc?.services ?? {})) {
    if (!svc || typeof svc !== "object") continue;
    if (String(svc.network_mode ?? "") === "host") {
      out.push({ line: 1, text: `services.${name}.network_mode: host — nghe THẲNG mọi interface` });
    }
    for (const p of Array.isArray(svc.ports) ? svc.ports : []) {
      if (typeof p === "string") {
        const reason = shortPortViolation(p);
        if (reason) out.push({ line: 1, text: `services.${name}.ports "${p}"   ← ${reason}` });
      } else if (p && typeof p === "object" && p.published !== undefined) {
        const hostIp = p.host_ip === undefined ? null : String(p.host_ip);
        if (hostIp === null) {
          out.push({ line: 1, text: `services.${name}.ports (long syntax) thiếu host_ip` });
        } else if (!LOOPBACK.has(hostIp)) {
          out.push({
            line: 1,
            text: `services.${name}.ports host_ip KHÔNG loopback: \`${hostIp}\``,
          });
        }
      } else {
        out.push({ line: 1, text: `services.${name}.ports phần tử KHÔNG hiểu được — fail-closed` });
      }
    }
  }
  return out;
}

function applyLongKey(item, key, value) {
  const v = value.replace(/\s+#.*$/, "").trim();
  if (key.toLowerCase() === "host_ip") item.hostIp = v;
  if (key.toLowerCase() === "published") item.published = v;
}

/**
 * File đã tracked + file MỚI chưa bị gitignore. Xem bài học 1 ở đầu file: chỉ `git ls-files` là mù với
 * đúng những file sắp được commit.
 */
function scanTargets() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((f) => f && !SKIP_EXT.test(f) && f !== SELF);
}

function scan() {
  const violations = [];
  const seen = new Set();
  for (const file of scanTargets()) {
    if (seen.has(file)) continue;
    seen.add(file);

    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // file bị xoá trong working tree / không đọc được dạng text
    }
    if (text.includes("\u0000")) continue;

    const lines = text.split(/\r?\n/);
    for (const rule of RULES) {
      if (rule.files && !rule.files.test(file)) continue;

      if (rule.fileScan) {
        for (const hit of rule.fileScan(lines)) {
          violations.push({ rule, file, line: hit.line, text: hit.text });
        }
        continue;
      }

      lines.forEach((line, i) => {
        if (rule.re) {
          rule.re.lastIndex = 0;
          if (rule.re.test(line)) violations.push({ rule, file, line: i + 1, text: line.trim() });
          return;
        }
        const m = rule.lineRe.exec(line);
        if (m && rule.lineCheck(m)) violations.push({ rule, file, line: i + 1, text: line.trim() });
      });
    }
  }
  return violations;
}

const violations = scan();
if (violations.length === 0) {
  console.log("[check-no-secret-literals] ✅ 0 vi phạm (file tracked + file mới chưa gitignore).");
  process.exit(0);
}

const byRule = new Map();
for (const v of violations) byRule.set(v.rule.id, [...(byRule.get(v.rule.id) ?? []), v]);

console.error(`\n[check-no-secret-literals] ⛔ ${violations.length} vi phạm:\n`);
for (const [id, list] of byRule) {
  console.error(`  ── ${id} (${list.length}) ──`);
  console.error(`    ${list[0].rule.why}\n`);
  for (const v of list) {
    // Cắt ngắn: không in nguyên giá trị nghi là secret ra log CI.
    console.error(`    ${v.file}:${v.line}  ${v.text.slice(0, 100)}`);
  }
  console.error("");
}
process.exit(1);
