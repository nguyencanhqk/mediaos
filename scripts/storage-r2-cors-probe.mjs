#!/usr/bin/env node
// storage-r2-cors-probe.mjs — đo CHỈ-ĐỌC chính sách CORS của một bucket R2 (S19-OPS-STORAGEPUBLIC-1, plan v2 §6 «CORS»).
//
// Gửi preflight (OPTIONS) như trình duyệt sẽ gửi trước một lượt PUT tải tệp lên: URL ký PUT cho một khoá
// NGẪU NHIÊN + `Origin` + `Access-Control-Request-Method: PUT` + `Access-Control-Request-Headers: content-type`.
// Preflight KHÔNG ghi object nào; không đọc, không xoá gì ⇒ chạy được trên bucket PROD lúc còn rỗng (plan C2).
//
//   node scripts/storage-r2-cors-probe.mjs --conf <file> [--bucket <tên>] --allow <origin> [--allow …] [--deny <origin> …]
// (`--bucket` thay cho dòng S3_BUCKET của file — dùng với file 3 khoá của bucket thử.)
//
// File cấu hình (NGOÀI kho): S3_ENDPOINT · S3_ACCESS_KEY · S3_SECRET_KEY · S3_BUCKET — chỉ 4 khoá này được đọc,
// kiểm bằng quy tắc dương, không in giá trị. `--allow`: preflight PHẢI trả `Access-Control-Allow-Origin` đúng
// origin đó. `--deny`: KHÔNG được có header đó. Exit 0 = mọi kỳ vọng đạt · 1 = có kỳ vọng hỏng · 2 = sai tham số.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../apps/api/package.json", import.meta.url)));
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const RULES = {
  S3_ENDPOINT: /^https:\/\/[0-9a-f]{32}(\.eu|\.fedramp)?\.r2\.cloudflarestorage\.com$/,
  S3_ACCESS_KEY: /^[0-9a-f]{32}$/,
  S3_SECRET_KEY: /^[0-9a-f]{64}$/,
  S3_BUCKET: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
};
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/;

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
      if (!ORIGIN_RE.test(value)) fail(`origin không đúng dạng scheme://host[:cổng]: ${value}`);
      out[flag.slice(2)].push(value);
    } else fail(`tham số lạ: ${flag}`);
  }
  if (!out.conf) fail("thiếu --conf <file>");
  if (out.allow.length + out.deny.length === 0) fail("cần ít nhất một --allow hoặc --deny");
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
  const bad = Object.keys(RULES).filter(
    (k) => !RULES[k].test((values[k] ?? "").replace(/\/$/, "")),
  );
  if (bad.length) fail(`file cấu hình thiếu hoặc sai dạng: ${bad.join(", ")} (không in giá trị)`);
  values.S3_ENDPOINT = values.S3_ENDPOINT.replace(/\/$/, "");
  return values;
}

async function preflight(client, bucket, origin) {
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
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  await res.arrayBuffer();
  return {
    status: res.status,
    allowOrigin: res.headers.get("access-control-allow-origin"),
    allowMethods: res.headers.get("access-control-allow-methods"),
  };
}

const args = parseArgs(process.argv.slice(2));
const conf = readConf(args.conf, args.bucket);
const client = new S3Client({
  endpoint: conf.S3_ENDPOINT,
  region: "auto",
  forcePathStyle: true,
  credentials: { accessKeyId: conf.S3_ACCESS_KEY, secretAccessKey: conf.S3_SECRET_KEY },
});

let failed = 0;
for (const [expect, origins] of [
  ["allow", args.allow],
  ["deny", args.deny],
]) {
  for (const origin of origins) {
    const r = await preflight(client, conf.S3_BUCKET, origin);
    const ok = expect === "allow" ? r.allowOrigin === origin : r.allowOrigin === null;
    if (!ok) failed++;
    console.log(
      `${ok ? "ĐẠT     " : "KHÔNG ĐẠT"} · kỳ vọng ${expect === "allow" ? "CHO PHÉP" : "TỪ CHỐI "} · ${origin} · HTTP ${r.status} · ` +
        `allow-origin=${r.allowOrigin ?? "(không)"} · allow-methods=${r.allowMethods ?? "(không)"}`,
    );
  }
}
// `process.exitCode` thay `process.exit()`: thoát cứng khi kết nối fetch còn đang đóng làm Node trên Windows
// văng assertion của libuv (exit 127) — đo 14/10/2026.
process.exitCode = failed ? 1 : 0;
