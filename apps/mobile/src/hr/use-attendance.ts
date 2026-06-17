import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CheckInRequest, CheckOutRequest } from "@mediaos/contracts";
import { attendanceApi } from "../api/attendance-api";
import { currentMonthKey } from "./hr-format";

/** Query keys — namespaced so attendance cache is isolated from tasks/leave. */
export const ATTENDANCE_TODAY_KEY = ["attendance", "today"] as const;
export const attendanceMonthKey = (month: string) => ["attendance", "month", month] as const;

/** GET /attendance/today — today's record + schedule. */
export function useAttendanceToday() {
  return useQuery({ queryKey: ATTENDANCE_TODAY_KEY, queryFn: attendanceApi.getToday });
}

/** GET /attendance?month=YYYY-MM — the caller's own monthly records (defaults to current month). */
export function useAttendanceMonth(month: string = currentMonthKey()) {
  return useQuery({
    queryKey: attendanceMonthKey(month),
    queryFn: () => attendanceApi.listMonthly(month),
  });
}

/** Invalidate today + the current month so check-in/out reflects immediately. */
function useInvalidateAttendance() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ATTENDANCE_TODAY_KEY });
    void qc.invalidateQueries({ queryKey: attendanceMonthKey(currentMonthKey()) });
  };
}

/** POST /attendance/check-in. */
export function useCheckIn() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: (data: CheckInRequest) => attendanceApi.checkIn(data),
    onSuccess: invalidate,
  });
}

/** POST /attendance/check-out. */
export function useCheckOut() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: (data: CheckOutRequest) => attendanceApi.checkOut(data),
    onSuccess: invalidate,
  });
}
