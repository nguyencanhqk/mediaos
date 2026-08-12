import type { Metadata } from "next";

/**
 * Trang huong dan xoa du lieu nguoi dung — dan vao o "Xoa du lieu nguoi dung"
 * trong App Dashboard cua Facebook (Cai dat > Co ban).
 *
 * PHAI CONG KHAI: Facebook (va nguoi kiem duyet cua Meta) doc trang nay khi CHUA dang nhap,
 * nen duong dan `/xoa-du-lieu` nam trong allowlist cua `middleware.ts`. Trang chi in chu tinh,
 * khong doc CSDL, khong nhan tham so — mo no ra khong lo them gi.
 *
 * Noi dung o day phai KHOP voi hanh vi that cua code. Cach 1 mo ta dung `deleteAccount()`
 * trong `repo/account-repo.ts`: xoa han ban ghi `accounts` + moi dong `pages` cua tai khoan do
 * (keo theo toan bo access token). Sua hanh vi do thi phai sua trang nay.
 */

export const metadata: Metadata = {
  title: "Hướng dẫn xóa dữ liệu người dùng — FB Post",
  description: "Cách yêu cầu xóa dữ liệu người dùng khỏi ứng dụng đăng bài Facebook",
};

const CONTACT_EMAIL = "canhpro.games@gmail.com";
const LAST_UPDATED = "11/08/2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[color:var(--text)]">{title}</h2>
      {children}
    </section>
  );
}

export default function DataDeletionPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 py-8 text-[15px] leading-relaxed text-[color:var(--text)]">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-[color:var(--text)]">
          Hướng dẫn xóa dữ liệu người dùng
        </h1>
        <p className="text-sm text-[color:var(--text-muted)]">
          Ứng dụng <strong>BanhXe</strong> (FB Post) — công cụ nội bộ soạn và hẹn giờ đăng bài lên
          Facebook Page. Cập nhật lần cuối: {LAST_UPDATED}.
        </p>
      </header>

      <Section title="1. Ứng dụng lưu những gì">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Danh tính Facebook của người kết nối: ID người dùng và tên hiển thị.</li>
          <li>Danh sách Facebook Page bạn chọn: ID Page và tên Page.</li>
          <li>
            Mã truy cập (access token) của người dùng và của Page —{" "}
            <strong>được mã hóa AES-256-GCM trước khi ghi xuống đĩa</strong>.
          </li>
          <li>App ID và App Secret của ứng dụng Facebook do bạn tự nhập.</li>
          <li>
            Nội dung do chính bạn tạo: bài viết, ảnh/video đã tải lên, lịch hẹn giờ, ID và liên kết
            của bài đã đăng.
          </li>
        </ul>
        <p>
          Ứng dụng <strong>không</strong> thu thập dữ liệu của người xem hay người theo dõi Page,
          không đọc danh sách bạn bè, không đọc tin nhắn. Dữ liệu chỉ dùng để đăng bài lên đúng
          Page bạn chọn — không dùng cho quảng cáo, không bán và không chia sẻ cho bên thứ ba.
        </p>
      </Section>

      <Section title="2. Cách 1 — Tự xóa trong ứng dụng (có hiệu lực ngay)">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Mở ứng dụng và vào trang <strong>Page</strong>.
          </li>
          <li>
            Bấm <strong>Gỡ</strong> ở tài khoản Facebook cần xóa.
          </li>
          <li>Xác nhận khi ứng dụng hỏi lại.</li>
        </ol>
        <p>
          Hệ thống xóa vĩnh viễn khỏi cơ sở dữ liệu: bản ghi tài khoản Facebook, toàn bộ Page thuộc
          tài khoản đó, và mọi access token liên quan. Thao tác này{" "}
          <strong>không thể hoàn tác</strong>.
        </p>
      </Section>

      <Section title="3. Cách 2 — Gỡ quyền từ phía Facebook">
        <p>
          Vào <strong>facebook.com</strong> → Cài đặt &amp; quyền riêng tư → Cài đặt →{" "}
          <strong>Ứng dụng và trang web</strong> → chọn <strong>BanhXe</strong> → <strong>Xóa</strong>.
        </p>
        <p>
          Mọi token đã cấp cho ứng dụng mất hiệu lực ngay lập tức và ứng dụng không đăng bài được
          nữa. Để xóa nốt phần dữ liệu còn lưu trong ứng dụng, dùng thêm Cách 1 hoặc Cách 3.
        </p>
      </Section>

      <Section title="4. Cách 3 — Yêu cầu xóa toàn bộ bằng email">
        <p>
          Gửi email tới{" "}
          <a className="font-medium text-[var(--color-brand-600)] underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{" "}
          với tiêu đề <strong>&ldquo;Yêu cầu xóa dữ liệu&rdquo;</strong>, kèm:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Tên và ID Facebook của bạn.</li>
          <li>Tên Page liên quan (nếu có).</li>
        </ul>
        <p>
          Chúng tôi xử lý trong vòng <strong>30 ngày</strong> và trả lời xác nhận bằng email. Yêu
          cầu này xóa cả những dữ liệu còn lại: bài đã soạn, ảnh/video đã tải lên và lịch đăng.
        </p>
      </Section>

      <Section title="5. Lưu ý về bài đã đăng lên Facebook">
        <p>
          Xóa dữ liệu trong ứng dụng <strong>không</strong> gỡ những bài đã đăng lên Facebook Page —
          các bài đó thuộc quyền quản lý của chính Page. Muốn gỡ, hãy xóa trực tiếp trên Facebook.
        </p>
      </Section>

      <Section title="English summary">
        <p>
          <strong>BanhXe</strong> is an internal tool that composes and schedules posts to Facebook
          Pages. It stores the connecting user&rsquo;s Facebook ID and name, the selected Page IDs
          and names, encrypted access tokens (AES-256-GCM), and the content the user creates. It
          collects no data about Page visitors or followers, and shares nothing with third parties.
        </p>
        <p>
          To delete your data: (1) open the app, go to <em>Page</em> and remove the connected
          Facebook account — this permanently deletes the account record, its Pages and all tokens;
          (2) remove the app under Facebook Settings → Apps and Websites; or (3) email{" "}
          <a className="font-medium text-[var(--color-brand-600)] underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{" "}
          with your Facebook name and ID. Email requests are completed within 30 days and confirmed
          by reply. Posts already published to a Facebook Page are owned by that Page and must be
          deleted on Facebook.
        </p>
      </Section>
    </article>
  );
}
