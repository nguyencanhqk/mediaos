import type { Pool, PoolClient } from "pg";

/**
 * Chạy `fn` trên MỘT connection của `direct` đang ở `session_replication_role = replica`, rồi HUỶ
 * connection đó (không trả về pool). Đây là cài đặt DUY NHẤT của chế độ replica trong bộ test —
 * `seedCrossTenantViolation` (`seed.ts`) uỷ thác sang đây.
 *
 * ⚠️ CHẾ ĐỘ NÀY TẮT NHIỀU HƠN BẠN NGHĨ. Trong phiên `replica`, Postgres KHÔNG bắn:
 *   • MỌI trigger thường (`tgenabled = 'O'`): trigger đóng băng, guard tenant, `updated_at`, audit…;
 *   • MỌI kiểm tra khoá ngoại (FK là trigger RI nội bộ).
 * Còn chạy: trigger `ENABLE ALWAYS` / `ENABLE REPLICA`, và CHECK · NOT NULL · UNIQUE (không phải
 * trigger). Hàng gieo ở đây vì vậy có thể là hàng mà KHÔNG đường ghi thật nào tạo ra được — đúng thứ
 * test đối kháng cần, và đúng lý do không được dùng nó cho việc gì khác.
 *
 * VÌ SAO PHIÊN `replica`, KHÔNG PHẢI `ALTER TABLE … DISABLE TRIGGER` (`S18-QA-CHECKALLFLAKE-1`).
 * `DISABLE TRIGGER` là DDL: chạy trên pool (autocommit) thì trigger TẮT cho MỌI phiên của DB tới khi
 * bật lại, và spec chạy song song đọc `pg_trigger` trúng cửa sổ đó sẽ đỏ oan (`tgenabled 'D'`) — hoặc
 * tệ hơn, GHI được vào bảng đang mất lưới. Phiên `replica` không có DDL, không đổi
 * `pg_trigger.tgenabled`: chỉ ĐÚNG connection này bỏ qua trigger; mọi phiên khác vẫn bị chặn như thường.
 *
 * Chỉ superuser đặt được `session_replication_role`, nên nó KHÔNG phải lỗ hổng: app role
 * (`mediaos_app`) không bao giờ làm được điều này.
 *
 * ⚠️ CHỈ dùng để GIEO (và dọn đúng thứ đã gieo). Đừng bọc phần assert — nếu bọc, ta sẽ đo hành vi
 * của một DB đã tắt trigger + FK, không phải hành vi thật.
 *
 * ⚠️ Callback nhận `client` và PHẢI chạy câu lệnh trên CHÍNH client đó. `session_replication_role`
 * là cấu hình theo PHIÊN, nên một `pool.query()` bên trong callback sẽ mượn connection KHÁC và vẫn
 * bị trigger / FK chặn — im lặng và khó hiểu. Đó là lý do API này trả `client` thay vì chạy `fn()` trống.
 *
 * ⚠️ Callback mở transaction (`BEGIN`) thì PHẢI tự `COMMIT` trước khi trả về. Connection bị huỷ ngay
 * sau callback, nên transaction còn mở sẽ bị Postgres cuộn lại: hàng gieo biến mất, test đỏ ở chỗ
 * nhìn thấy được. (Tính tới 10/10/2026 mọi nơi gọi đều là callback MỘT câu autocommit.)
 */
export async function withReplicaSession<T>(
  direct: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await direct.connect();
  try {
    await client.query("SET session_replication_role = replica");
    return await fn(client);
  } finally {
    // HUỶ connection (`release(true)`), KHÔNG «đặt lại DEFAULT rồi trả về pool» như bản trước. Đặt lại
    // chỉ có hiệu lực khi câu SET rơi vào MỨC PHIÊN. Callback để transaction MỞ (expect đỏ sau `BEGIN`,
    // quên `COMMIT`) thì SET chạy TRONG transaction đó và Postgres hoàn tác nó ở lần ROLLBACK kế tiếp ⇒
    // connection nằm trong pool (`directPool` max=4) quay lại `replica`: trigger + FK TẮT cho mọi spec
    // mượn sau = xanh-giả hàng loạt, không vết. Đo trên lane 10/10/2026 (`S18-QA-CHECKALLFLAKE-1`, review
    // R1-TS-1): callback `BEGIN` rồi ném ⇒ người mượn kế tiếp `ROLLBACK` xong đọc `SHOW` = `replica`.
    // Quy tắc DƯƠNG thay cho việc liệt kê từng đường rò (transaction mở · câu reset hỏng · đường chưa
    // nghĩ tới): connection ĐÃ TỪNG ở `replica` không bao giờ được tái dùng. Giá: mỗi lần gọi kết nối lại
    // một lần — ĐỪNG «tối ưu» thành `release()`.
    client.release(true);
  }
}
