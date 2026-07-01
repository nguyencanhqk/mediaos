/**
 * useCheckOut — mutation POST /attendance/check-out (ATT-API-003).
 * S3-FE-ATT-1: sau khi thành công invalidate today + my-records (attendanceInvalidation).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CheckOutRequest } from "@mediaos/contracts";
import { attendanceApi, attendanceInvalidation } from "@mediaos/web-core";

export function useCheckOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CheckOutRequest) => attendanceApi.checkOut(body),
    onSuccess: async () => {
      for (const key of attendanceInvalidation.checkOut()) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
    retry: false,
  });
}
