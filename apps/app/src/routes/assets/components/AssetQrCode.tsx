import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";

/**
 * S11-ASSET-FE-1 — QR của tài sản (ASSET-SCREEN-002).
 *
 * ASSET-DEC-001: **KHÔNG có endpoint QR** — mã render hoàn toàn ở client từ `asset_code`. Thêm một
 * endpoint sinh ảnh QR là đẻ ra một đường tải file có thể bị dò (và một cặp quyền phải canh), trong
 * khi dữ liệu cần mã hoá chỉ là một chuỗi đã nằm sẵn trong response chi tiết.
 *
 * Nội dung mã = ĐÚNG `assetCode`, không bọc URL: mã dán lên thiết bị vật lý và được quét bằng bất kỳ
 * app nào; nhét URL vào sẽ ghim mã giấy vào một tên miền, đổi tên miền là mọi nhãn đã in thành rác.
 * `QRCodeSVG` (không phải Canvas) để nét khi in biên bản và khi phóng to.
 */
export function AssetQrCode({ assetCode, size = 128 }: { assetCode: string; size?: number }) {
  const { t } = useTranslation("assets");
  return (
    <figure className="flex flex-col items-center gap-2">
      <QRCodeSVG
        value={assetCode}
        size={size}
        level="M"
        // Nền trắng cố định + tiền cảnh đen: QR phải tương phản khi IN, không theo theme sáng/tối.
        bgColor="#ffffff"
        fgColor="#000000"
        marginSize={2}
        title={assetCode}
      />
      <figcaption className="text-center">
        <span className="block font-mono text-sm font-medium">{assetCode}</span>
        <span className="block text-xs text-muted-foreground">{t("detail.qrHint")}</span>
      </figcaption>
    </figure>
  );
}
