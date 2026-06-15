interface SodWarningProps {
  /** True when createdBy === currentUserId (SoD violation). */
  show: boolean;
}

/**
 * SodWarning — Segregation of Duties warning for payroll approval.
 * Shows when the logged-in user is also the one who ran payroll (createdBy === currentUser).
 * FE warning only — server is the authoritative gate.
 */
export function SodWarning({ show }: SodWarningProps) {
  if (!show) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800"
    >
      Người duyệt không được là người chạy lương (phân quyền SoD). Yêu cầu người khác duyệt kỳ này.
    </div>
  );
}
