#!/usr/bin/env node
// storage-r2-cors-probe.mjs — đo CHỈ-ĐỌC chính sách CORS của một bucket R2 (S19-OPS-STORAGEPUBLIC-1, plan v2 §6 «CORS»).
//
// Gửi preflight (OPTIONS) như trình duyệt gửi trước một lượt tải tệp lên: URL ký PUT cho một khoá NGẪU NHIÊN
// + `Origin` + `Access-Control-Request-Method` + `Access-Control-Request-Headers: content-type`. Preflight KHÔNG
// ghi object nào; ngoài ra chỉ có MỘT lượt HeadBucket để chứng minh khoá trong file cấu hình đúng
// (preflight không xác thực nên tự nó không nói được điều đó) ⇒ chạy được trên bucket PROD lúc còn rỗng (plan C2).
//
//   node scripts/storage-r2-cors-probe.mjs --conf <file> [--bucket <tên>] --allow <origin> [--allow …] [--deny <origin> …]
// (`--bucket` thay cho dòng S3_BUCKET của file — dùng với file 3 khoá của bucket thử. `--deny null` = origin `null`.)
//
// File cấu hình (NGOÀI kho): S3_ENDPOINT · S3_ACCESS_KEY · S3_SECRET_KEY · S3_BUCKET — chỉ 4 khoá này được đọc,
// kiểm bằng quy tắc dương, không in giá trị.
// ĐẠT của `--allow` (preflight PUT): HTTP 2xx + `Access-Control-Allow-Origin` = đúng origin + allow-methods có PUT
//   + allow-headers có content-type (thiếu một vế thì trình duyệt vẫn chặn lượt tải lên).
// ĐẠT của `--deny` (preflight PUT VÀ preflight GET): HTTP 4xx + KHÔNG có `Access-Control-Allow-Origin`.
// Exit 0 = mọi kỳ vọng đạt · 1 = có kỳ vọng hỏng · 2 = sai tham số / file cấu hình · 3 = lỗi mạng / khoá sai.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../apps/api/package.json", import.meta.url)));
const { S3Client, PutObjectCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const RULES = {
  S3_ENDPOINT: /^https:\/\/[0-9a-f]{32}(\.eu|\.fedramp)?\.r2\.cloudflarestorage\.com$/,
  S3_ACCESS_KEY: /^[0-9a-f]{32}$/,
  S3_SECRET_KEY: /^[0-9a-f]{64}$/,
  S3_BUCKET: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
};
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/;
const TIMEOUT_MS = 15000;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { conf: "", bucket: "", allow: [], deny: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) fail(`thiếu giá trị sau ${flag}`);
    if (flag === "--conf") out.conf = value;
    else if (flag === "--bucket") {
      // Cho file cấu hình 3 khoá (bucket thử) — cùng quy tắc dương với S3_BUCKET.
      if (!RULES.S3_BUCKET.test(value)) fail(`tên bucket không đúng dạng: ${value}`);
      out.bucket = value;
    } else if (flag === "--allow" || flag === "--deny") {
      const isNull = flag === "--deny" && value === "null";
      if (!isNull && !ORIGIN_RE.test(value))
        fail(`origin không đúng dạng scheme://host[:cổng]: ${value}`);
      out[flag.slice(2)].push(value);
    } else fail(`tham số lạ: ${flag}`);
  }
  if (!out.conf) fail("thiếu --conf <file>");
  // Chỉ có `--deny` thì một bucket CHƯA đặt CORS cũng «ĐẠT» toàn bộ ⇒ bắt buộc ít nhất một vế CHO PHÉP.
  if (out.allow.length === 0)
    fail("cần ít nhất một --allow (chỉ --deny thì bucket chưa có CORS cũng ĐẠT)");
  return out;
}

function readConf(path, bucketOverride) {
  const values = bucketOverride ? { S3_BUCKET: bucketOverride } : {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(raw);
    if (!m || !(m[1] in RULES) || m[1] in values) continue;
    values[m[1]] = m[2]
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
  }
  // Chỉ endpoint được bỏ `/` cuối; bucket `foo/` phải bị TỪ CHỐI, không được ký với tên đó.
  if (values.S3_ENDPOINT) values.S3_ENDPOINT = values.S3_ENDPOINT.replace(/\/$/, "");
  const bad = Object.keys(RULES).filter((k) => !RULES[k].test(values[k] ?? ""));
  if (bad.length) fail(`file cấu hình thiếu hoặc sai dạng: ${bad.join(", ")} (không in giá trị)`);
  return values;
}

/** Danh sách header CORS (phân cách dấu phẩy) có chứa `want` (không phân biệt hoa-thường) hoặc `*`. */
function listHas(header, want) {
  if (!header) return false;
  const items = header.split(",").map((s) => s.trim().toLowerCase());
  return items.includes(want.toLowerCase()) || items.includes("*");
}

async function preflight(client, bucket, origin, method) {
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: `cors-probe/${randomUUID()}`,
      ContentType: "image/png",
      ContentLength: 1,
    }),
    { expiresIn: 120, signableHeaders: new Set(["content-type"]) },
  );
  const res = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": "content-type",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.arrayBuffer();
  return {
    status: res.status,
    allowOrigin: res.headers.get("access-control-allow-origin"),
    allowMethods: res.headers.get("access-control-allow-methods"),
    allowHeaders: res.headers.get("access-control-allow-headers"),
  };
}

/** HeadBucket: 2xx = khoá đúng + bucket có thật; 403 = khoá sai; 404 = bucket không tồn tại. Không ghi gì. */
async function assertCredentials(client, bucket) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const why = err?.$metadata?.httpStatusCode ?? err?.name;
    throw Object.assign(new Error(`kiểm khoá: HeadBucket trả ${why} — khoá sai (403) hoặc bucket không tồn tại (404)?`), {
      name: "CredentialCheckFailed",
    });
  }
}

const args = parseArgs(process.argv.slice(2));
const conf = readConf(args.conf, args.bucket);
const client = new S3Client({
  endpoint: conf.S3_ENDPOINT,
  region: "auto",
  forcePathStyle: true,
  credentials: { accessKeyId: conf.S3_ACCESS_KEY, secretAccessKey: conf.S3_SECRET_KEY },
});

const fmt = (r) =>
  `HTTP ${r.status} · allow-origin=${r.allowOrigin ?? "(không)"} · allow-methods=${r.allowMethods ?? "(không)"} · allow-headers=${r.allowHeaders ?? "(không)"}`;

let failed = 0;
try {
  await assertCredentials(client, conf.S3_BUCKET);
  for (const origin of args.allow) {
    const r = await preflight(client, conf.S3_BUCKET, origin, "PUT");
    const ok =
      r.status >= 200 &&
      r.status < 300 &&
      r.allowOrigin === origin &&
      listHas(r.allowMethods, "PUT") &&
      listHas(r.allowHeaders, "content-type");
    if (!ok) failed++;
    console.log(`${ok ? "ĐẠT     " : "KHÔNG ĐẠT"} · kỳ vọng CHO PHÉP PUT · ${origin} · ${fmt(r)}`);
  }
  for (const origin of args.deny) {
    for (const method of ["PUT", "GET"]) {
      const r = await preflight(client, conf.S3_BUCKET, origin, method);
      const ok = r.status >= 400 && r.status < 500 && r.allowOrigin === null;
      if (!ok) failed++;
      console.log(
        `${ok ? "ĐẠT     " : "KHÔNG ĐẠT"} · kỳ vọng TỪ CHỐI ${method.padEnd(3)} · ${origin} · ${fmt(r)}`,
      );
    }
  }
} catch (err) {
  // Lỗi mạng / hết giờ / khoá sai: KHÁC «CORS sai» ⇒ mã thoát riêng, in tên lỗi (không in URL).
  console.error(
    `LỖI ${err?.name ?? "Error"}: ${String(err?.message ?? err).replace(/https?:\/\/\S+/g, "<url>")}`,
  );
  process.exitCode = 3;
}
// `process.exitCode` thay `process.exit()`: thoát cứng khi kết nối fetch còn đang đóng làm Node trên Windows
// văng assertion của libuv (exit 127) — đo 14/10/2026.
if (process.exitCode !== 3) process.exitCode = failed ? 1 : 0;
