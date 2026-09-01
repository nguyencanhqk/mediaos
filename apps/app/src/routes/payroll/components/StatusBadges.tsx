/**
 * S13-PAYROLL-FE-1 — chip trạng thái PAYROLL. Nhãn đi qua i18n namespace `payroll`, màu tra bảng
 * constants — KHÔNG rải chuỗi/hex trong page (SPEC-01 §17.15–17.17).
 *
 * ⚠️ `PayslipStatusBadge` nhận `status` **nullable**: trạng thái phiếu là DẪN XUẤT (SPEC-11 §13.2) và
 * server trả `null` khi KHÔNG nhánh nào khớp (fail-closed — phiếu không lộ ra đường Own). `null` phải
 * hiện thành chip trung tính, KHÔNG được coi là `Generated`.
 */
import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";
import type {
  PayrollPeriodStatus,
  PayslipDerivedStatus,
  BonusPenaltyStatus,
  BonusKind,
} from "@mediaos/contracts";
import {
  PAYROLL_PERIOD_STATUS_BADGE_VARIANT,
  PAYSLIP_STATUS_BADGE_VARIANT,
  BONUS_PENALTY_STATUS_BADGE_VARIANT,
  BONUS_KIND_BADGE_VARIANT,
} from "../constants";

export function PayrollPeriodStatusBadge({ status }: { status: PayrollPeriodStatus }) {
  const { t } = useTranslation("payroll");
  return (
    <Badge variant={PAYROLL_PERIOD_STATUS_BADGE_VARIANT[status] ?? "muted"}>
      {t(`periodStatus.${status}`)}
    </Badge>
  );
}

export function PayslipStatusBadge({ status }: { status: PayslipDerivedStatus | null }) {
  const { t } = useTranslation("payroll");
  if (status === null) return <Badge variant="muted">{t("payslipStatus.unknown")}</Badge>;
  return (
    <Badge variant={PAYSLIP_STATUS_BADGE_VARIANT[status] ?? "muted"}>
      {t(`payslipStatus.${status}`)}
    </Badge>
  );
}

export function BonusPenaltyStatusBadge({ status }: { status: BonusPenaltyStatus }) {
  const { t } = useTranslation("payroll");
  return (
    <Badge variant={BONUS_PENALTY_STATUS_BADGE_VARIANT[status] ?? "muted"}>
      {t(`bonusStatus.${status}`)}
    </Badge>
  );
}

export function BonusKindBadge({ kind }: { kind: BonusKind }) {
  const { t } = useTranslation("payroll");
  return (
    <Badge variant={BONUS_KIND_BADGE_VARIANT[kind] ?? "muted"}>{t(`bonusKind.${kind}`)}</Badge>
  );
}
