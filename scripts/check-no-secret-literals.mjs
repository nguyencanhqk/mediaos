#!/usr/bin/env node
/**
 * check-no-secret-literals.mjs — CHỐT HỒI QUY cho S6-SEC-ROTATE-1 (KI-043).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO
 *
 * Repo này PUBLIC. Tới 2026-07-28 nó chứa mật khẩu SUPERUSER Postgres của cụm PROD dưới dạng "giá trị
 * mặc định cho tiện" (`changeme_*`) ở 17 file tracked, và `docker-compose.yml` bind cụm ra `0.0.0.0`.
 * Hai thứ đó cộng lại là một lỗ hổng đang mở, không phải nợ kỹ thuật.
 *
 * Rotate mật khẩu KHÔNG đóng được lỗ hổng nếu literal có thể bò trở lại — đúng lớp lỗi KI-036 (vá ngọn,
 * để nguyên cái tự khôi phục). File này là cái chốt: bất kỳ ai (người hay agent) đưa literal về, hoặc gỡ
 * bind loopback, đều làm ĐỎ ngay tại `harness/check.sh` và CI.
 *
 * Chạy:  node scripts/check-no-secret-literals.mjs        (exit 1 nếu vi phạm)
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

const RULES = [
  {
    id: "db-password-literal",
    // Họ literal đã từng LÀ mật khẩu thật của cụm PROD: changeme_dev_only / _app_only / _worker_only /
    // _pgbauth_only / changeme_at_least_32_chars… Yêu cầu ít nhất một ký tự chữ-số sau dấu gạch dưới,
    // nên `changeme_*` trong văn xuôi KHÔNG khớp.
    // `i`: FULL gate chỉ ra `CHANGEME_APP_ONLY` viết hoa lọt lưới. Một cổng phân biệt hoa-thường
    // chỉ chặn được đúng cách gõ mà nó đã thấy.
    re: /changeme_[A-Za-z0-9]/gi,
    why: [
      "Literal họ `changeme_*` là mật khẩu THẬT của cụm Postgres PROD trước 2026-07-28 (KI-043).",
      "Không đặt lại giá trị mặc định chạy được cho secret: dùng `__SET_ME__` trong file .env*.example,",
      "và đọc từ env ở đường chạy thật (scripts/lib/db-secrets.sh · scripts/setup-db-roles.mjs).",
    ].join("\n    "),
  },
  {
    id: "env-example-real-secret",
    // Chỉ áp cho file mẫu: khoá secret PHẢI để `__SET_ME__` (hoặc rỗng / biến `${...}`).
    files: /(^|\/)\.env[^/]*\.example$/,
    lineRe:
      /^\s*(POSTGRES_PASSWORD|APP_DB_PASSWORD|WORKER_DB_PASSWORD|OWNER_DB_PASSWORD|SUPERUSER_DB_PASSWORD|PGBOUNCER_AUTH_PASSWORD|JWT_SECRET|MINIO_ROOT_PASSWORD|S3_SECRET_KEY|LMS_SSO_SECRET)=(.+)$/,
    lineCheck: (m) => {
      const v = m[2].trim();
      return v !== "" && v !== "__SET_ME__" && !v.startsWith("${");
    },
    why: [
      "File .env*.example là thứ người ta `cp` thành .env rồi chạy thẳng (CLAUDE.md §7).",
      "Một giá trị 'tiện' ở đây trở thành secret PROD ở nơi khác — đúng đường KI-027 và KI-043 đã đi.",
      "Để `__SET_ME__` (cố ý không hợp lệ ⇒ fail-closed khi ai đó quên điền).",
    ].join("\n    "),
  },
  {
    id: "env-example-secret-in-url",
    // FULL gate 2026-07-28 (HIGH-2): luật `env-example-real-secret` chỉ soi dạng `KEY=value`, nên mật
    // khẩu nhét vào phần userinfo của connection string LỌT SẠCH — mà đó ĐÚNG hình dạng đã gây ra
    // KI-043 (`DATABASE_URL=postgres://mediaos_app:<mật khẩu thật>@…`). gitleaks cũng bỏ qua dạng này
    // (đã kiểm: 3 dòng URL lọt, chỉ bắt các dòng `KEY=value`). Vì vậy phải có luật riêng.
    files: /(^|\/)\.env[^/]*\.example$/,
    lineRe: /^\s*[A-Z0-9_]+=\s*[a-z][a-z0-9+.-]*:\/\/([^@\s/]*)@/i,
    lineCheck: (m) => {
      const userinfo = m[1];
      if (!userinfo.includes(":")) return false; // không có phần mật khẩu
      const pw = userinfo.slice(userinfo.indexOf(":") + 1).trim();
      return pw !== "" && pw !== "__SET_ME__" && !pw.startsWith("${");
    },
    why: [
      "Connection string trong file mẫu mang mật khẩu thật — ĐÚNG hình dạng đã làm rò cụm PROD (KI-043).",
      "gitleaks KHÔNG bắt dạng này (nó soi `KEY=value`), nên đây là cổng duy nhất chặn.",
      "Để `postgres://user:__SET_ME__@host:port/db`.",
    ].join("\n    "),
  },
  {
    id: "compose-port-wide-bind",
    // FULL gate 2026-07-28 (HIGH-3): bản đầu dùng DANH SÁCH ĐEN (đếm dấu hai chấm, chỉ nhận dòng có
    // dấu nháy kép, chỉ khớp tên file ở gốc repo) ⇒ lách được bằng YAML hoàn toàn bình thường:
    // không nháy · nháy đơn · long-syntax (`target:`/`published:`) · file trong thư mục con ·
    // và cả `"0.0.0.0:5433:5432"` (đủ 3 phần nên "hợp lệ").
    //
    // Nay đảo thành DANH SÁCH TRẮNG: chỉ chấp nhận địa chỉ bind loopback tường minh hoặc biến `${…}`
    // có default loopback. MỌI hình dạng khác — kể cả hình dạng chưa ai nghĩ ra — đều ĐỎ.
    // Một cổng bảo mật phải fail-closed với cái nó KHÔNG hiểu, không phải cho qua.
    files: /(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/i,
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

/**
 * Một mục `ports:` dạng ngắn có vi phạm không? Trả `null` nếu an toàn, hoặc lý do.
 * Danh sách TRẮNG: phải mở đầu bằng địa chỉ loopback tường minh, hoặc `${VAR}`/`${VAR:-loopback}`.
 */
function shortPortViolation(rawSpec) {
  const spec = rawSpec.trim().replace(/^["']|["']$/g, "");
  if (!spec) return null;

  // `${VAR}` hoặc `${VAR:-default}` ở vị trí địa chỉ bind.
  const varAtStart = spec.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}:/);
  if (varAtStart) {
    const def = (varAtStart[2] ?? "").trim();
    // Không có default ⇒ do .env quyết định; chấp nhận (repo khai INFRA_BIND_ADDR mặc định loopback).
    if (def === "" || LOOPBACK.has(def)) return null;
    // Default là số cổng ⇒ đây là biến CỔNG đứng ở vị trí địa chỉ bind (tức mapping thiếu bind).
    if (/^\d+$/.test(def)) return `thiếu địa chỉ bind (\`\${${varAtStart[1]}}\` là CỔNG, không phải địa chỉ)`;
    return `biến bind có default KHÔNG loopback: \`${def}\``;
  }

  const v6 = spec.match(/^\[([^\]]*)\]:/);
  if (v6) return LOOPBACK.has(v6[1]) ? null : `bind IPv6 KHÔNG loopback: \`[${v6[1]}]\``;

  const v4 = spec.match(/^([A-Za-z0-9_.-]+):(?=.*:)/);
  if (v4) return LOOPBACK.has(v4[1]) ? null : `bind KHÔNG loopback: \`${v4[1]}\``;

  // Còn lại: "5432:5432" · "5432" · "${PORT:-5432}:5432" … — đều KHÔNG có địa chỉ bind ⇒ 0.0.0.0.
  return "thiếu địa chỉ bind (Docker publish ra 0.0.0.0)";
}

/**
 * Quét các khối `ports:` của một compose file, cả short-syntax lẫn long-syntax.
 * Long-syntax an toàn CHỈ KHI có `host_ip:` loopback đi kèm `published:`.
 */
function scanComposePorts(lines) {
  const out = [];
  let portsIndent = null; // độ thụt của chính khoá `ports:`
  let item = null; // mục long-syntax đang gom: { start, hostIp, published }

  const flush = () => {
    if (!item) return;
    if (item.published !== null) {
      if (item.hostIp === null) {
        out.push({ line: item.start, text: "ports (long syntax) thiếu `host_ip:`" });
      } else if (!LOOPBACK.has(item.hostIp)) {
        out.push({ line: item.start, text: `ports host_ip KHÔNG loopback: \`${item.hostIp}\`` });
      }
    }
    item = null;
  };

  lines.forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    const indent = line.length - line.trimStart().length;

    if (/^\s*ports:\s*$/.test(line)) {
      flush();
      portsIndent = indent;
      return;
    }
    if (portsIndent === null) return;

    // Thoát khối `ports:` khi gặp dòng thụt bằng hoặc ít hơn.
    if (indent <= portsIndent) {
      flush();
      portsIndent = null;
      return;
    }

    const itemMatch = line.match(/^\s*-\s*(.*)$/);
    if (itemMatch) {
      flush();
      const rest = itemMatch[1].trim();
      if (!rest || /^[a-z_]+:\s*/i.test(rest)) {
        // Long syntax: `- target: 5432` (các khoá còn lại ở dòng sau).
        item = { start: i + 1, hostIp: null, published: null };
        const kv = rest.match(/^([a-z_]+):\s*(.*)$/i);
        if (kv) applyLongKey(item, kv[1], kv[2]);
        return;
      }
      const reason = shortPortViolation(rest);
      if (reason) out.push({ line: i + 1, text: `${rest}   ← ${reason}` });
      return;
    }

    // Dòng thuộc mục long-syntax đang gom.
    if (item) {
      const kv = line.trim().match(/^([a-z_]+):\s*(.*)$/i);
      if (kv) applyLongKey(item, kv[1], kv[2]);
    }
  });

  flush();
  return out;
}

function applyLongKey(item, key, value) {
  const v = value.trim().replace(/^["']|["']$/g, "");
  if (key.toLowerCase() === "host_ip") item.hostIp = v;
  if (key.toLowerCase() === "published") item.published = v;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((f) => f && !SKIP_EXT.test(f) && f !== SELF);
}

function scan() {
  const violations = [];
  for (const file of trackedFiles()) {
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

      // Luật cần NGỮ CẢNH NHIỀU DÒNG (vd long-syntax của compose) tự quét cả file.
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
  console.log("[check-no-secret-literals] ✅ 0 vi phạm trên file tracked.");
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
