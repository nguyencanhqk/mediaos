/**
 * useCheckIn — mutation POST /attendance/check-in (ATT-API-002).
 * S3-FE-ATT-1: sau khi thành công invalidate today + my-records (attendanceInvalidation).
 * BẤT BIẾN: server-time authoritative (chống gian lận giờ client) — client gửi clientTime
 * chỉ là tham chiếu, KHÔNG được dùng để tính đi muộn/về sớm.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CheckInRequest } from "@mediaos/contracts";
import { attendanceApi, attendanceInvalidation } from "@mediaos/web-core";

export function useCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CheckInRequest) => attendanceApi.checkIn(body),
    onSuccess: async () => {
      // Invalidate today + my-records để UI cập nhật ngay sau check-in.
      for (const key of attendanceInvalidation.checkIn()) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
    // Không retry mutation (idempotency: server dùng upsert theo (employee_id, work_date)).
    retry: false,
  });
}
