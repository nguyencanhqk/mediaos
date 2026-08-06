import { Alert } from "@/components/ui";

/**
 * Man hinh duy nhat xem duoc khi chua co phien.
 *
 * KHONG co o nhap mat khau, va do la co y: fbpost khong tu quan ly danh tinh. Nguoi dung dang
 * nhap o MediaOS roi bam o "Dang bai" — cau SSO cap phien cho ung dung nay. Dat mot form dang
 * nhap o day nghia la them mot kho mat khau thu hai phai bao ve, doi lay khong duoc gi.
 */
export default function LoginPage() {
  const mediaOsUrl = process.env.NEXT_PUBLIC_MEDIAOS_URL ?? "";

  return (
    <div className="mx-auto mt-16 max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Cần đăng nhập từ MediaOS</h1>

      <Alert tone="info">
        Ứng dụng đăng bài không có màn hình đăng nhập riêng. Hãy mở nó từ MediaOS — vào trang chủ,
        bấm ô <strong>Đăng bài</strong>. Bạn sẽ được đưa thẳng vào đây.
      </Alert>

      <p className="text-sm leading-relaxed text-neutral-600">
        Nếu không thấy ô <strong>Đăng bài</strong>, tài khoản của bạn chưa được cấp quyền dùng chức
        năng này. Liên hệ quản trị hệ thống để được cấp.
      </p>

      {mediaOsUrl ? (
        <a
          className="inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          href={mediaOsUrl}
        >
          Mở MediaOS
        </a>
      ) : null}
    </div>
  );
}
