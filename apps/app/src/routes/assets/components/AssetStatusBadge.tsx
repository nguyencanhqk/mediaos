import { useTranslation } from "react-i18next";
import { Badge } from "@mediaos/ui";
import type {
  AssetLifecycleStatusDto,
  AssetInventoryItemResultDto,
  AssetAssignmentStatusDto,
} from "@mediaos/contracts";
import { ASSET_STATUS_BADGE_VARIANT, ASSET_INVENTORY_RESULT_BADGE_VARIANT } from "../constants";

/**
 * S11-ASSET-FE-1 — nhãn trạng thái dùng CHUNG cho mọi màn ASSET (SPEC-13 §9 "nhãn trạng thái dùng
 * constants chuẩn §17").
 *
 * Khoá i18n tra THẲNG bằng giá trị server (`t(\`status.${status}\`)`) — namespace `assets` giữ nguyên
 * chuỗi có dấu cách (`"In Stock"`, `"Not Checked"`). Slug hoá ở đây sẽ đẻ bảng ánh xạ thứ hai, và bảng
 * đó trôi khỏi `assetLifecycleStatusSchema` lúc nào không ai biết.
 */
export function AssetStatusBadge({ status }: { status: AssetLifecycleStatusDto }) {
  const { t } = useTranslation("assets");
  return <Badge variant={ASSET_STATUS_BADGE_VARIANT[status]}>{t(`status.${status}`)}</Badge>;
}

export function AssetInventoryResultBadge({ result }: { result: AssetInventoryItemResultDto }) {
  const { t } = useTranslation("assets");
  return (
    <Badge variant={ASSET_INVENTORY_RESULT_BADGE_VARIANT[result]}>
      {t(`inventoryResult.${result}`)}
    </Badge>
  );
}

export function AssetAssignmentStatusBadge({ status }: { status: AssetAssignmentStatusDto }) {
  const { t } = useTranslation("assets");
  return (
    <Badge variant={status === "Active" ? "brand" : "muted"}>
      {t(`assignmentStatus.${status}`)}
    </Badge>
  );
}
