// Tạo + XÁC MINH bucket object-storage cho integration test của CI.
//
// TẠI SAO KHÔNG dùng `mc` như trước: từ 2026-09-24 toàn bộ image MinIO chính chủ biến mất khỏi registry
// công khai (Docker Hub `denied` · quay.io đòi auth · mirror.gcr.io + public.ecr.aws không có ·
// dl.min.io trả 410) ⇒ `quay.io/minio/mc` không kéo được nữa, và `bitnamilegacy/mc` cũng `denied`.
//
// TẠI SAO KHÔNG kiểm tra bằng curl ẩn danh: ĐO 2026-09-24 trên chính image đang dùng — MinIO trả
// HTTP 403 + `<Code>AccessDenied</Code>` Y HỆT NHAU cho bucket CÓ THẬT và bucket KHÔNG tồn tại
// (khác nhau đúng mỗi `<BucketName>`, là thứ mình tự gửi đi). Mọi phép thử ẩn danh vì thế là XANH GIẢ.
// Chỉ lời gọi CÓ KÝ SigV4 mới phân biệt được: `HeadBucket` ném `NotFound` khi bucket vắng (đã đo).
//
// Script CHỦ ĐỘNG tạo bucket nên KHÔNG phụ thuộc biến `MINIO_DEFAULT_BUCKETS` riêng của bitnami —
// đổi lại image sau này (mirror bản chính chủ) chỉ phải sửa đúng dòng `image:` trong workflow.

import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const bucket = process.env.S3_BUCKET;
if (!bucket) {
  console.error('ci-ensure-bucket: thiếu env S3_BUCKET');
  process.exit(1);
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

try {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log('ci-ensure-bucket: đã tạo bucket ' + bucket);
  } catch (err) {
    // Bucket đã có sẵn là trạng thái HỢP LỆ — nhưng KHÔNG nuốt mọi lỗi khác (sai credential, sai
    // endpoint, MinIO chưa lên...) vì nuốt ở đây là fail-OPEN: test sau sẽ đỏ ở chỗ khó đọc hơn nhiều.
    if (err?.name !== 'BucketAlreadyOwnedByYou' && err?.name !== 'BucketAlreadyExists') throw err;
    console.log('ci-ensure-bucket: bucket đã sẵn có ' + bucket);
  }

  // Xác minh THẬT, có ký. Đây mới là cổng: tạo bucket âm thầm không ăn thua thì dòng này ném NotFound.
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log('ci-ensure-bucket: đã xác minh bucket ' + bucket);
} catch (err) {
  console.error('ci-ensure-bucket: THẤT BẠI — ' + err?.name + ': ' + err?.message);
  process.exit(1);
}
