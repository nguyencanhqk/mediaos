import type { Metadata } from "next";

/**
 * Chinh sach quyen rieng tu — dan vao o "URL chinh sach quyen rieng tu" trong App Dashboard.
 *
 * Facebook BAT BUOC co URL nay truoc khi cho chuyen app sang che do Live. Cung nhu
 * `/xoa-du-lieu`: trang tinh, nam trong allowlist cua `middleware.ts`, doc duoc khi chua dang nhap.
 */

export const metadata: Metadata = {
  title: "Chính sách quyền riêng tư — FB Post",
  description: "Chính sách quyền riêng tư của ứng dụng đăng bài Facebook",
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

export default function PrivacyPolicyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 py-8 text-[15px] leading-relaxed text-[color:var(--text)]">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-[color:var(--text)]">Chính sách quyền riêng tư</h1>
        <p className="text-sm text-[color:var(--text-muted)]">
          Ứng dụng <strong>BanhXe</strong> (FB Post). Cập nhật lần cuối: {LAST_UPDATED}.
        </p>
      </header>

      <Section title="1. Ứng dụng này là gì">
        <p>
          BanhXe là công cụ <strong>nội bộ</strong> giúp nhân sự của chúng tôi soạn, hẹn giờ và đăng
          bài lên các Facebook Page do chính công ty quản lý. Ứng dụng không mở cho người dùng
          Facebook đại chúng và không có tính năng nào hướng tới người xem Page.
        </p>
      </Section>

      <Section title="2. Dữ liệu thu thập">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>ID người dùng Facebook và tên hiển thị của người bấm kết nối.</li>
          <li>ID và tên các Facebook Page mà người đó chọn.</li>
          <li>Access token của người dùng và của Page.</li>
          <li>App ID và App Secret của ứng dụng Facebook do người dùng tự nhập.</li>
          <li>Nội dung do người dùng tạo: bài viết, ảnh/video tải lên, lịch hẹn giờ.</li>
        </ul>
        <p>
          Chúng tôi <strong>không</strong> thu thập dữ liệu của người xem hoặc người theo dõi Page,
          không đọc danh sách bạn bè và không đọc tin nhắn.
        </p>
      </Section>

      <Section title="3. Mục đích sử dụng">
        <p>
          Dữ liệu chỉ dùng để đăng bài lên đúng Page người dùng đã chọn, đúng thời điểm đã hẹn, và
          để hiển thị lại lịch sử đăng bài trong ứng dụng. Không dùng cho quảng cáo, không lập hồ sơ
          hành vi, không bán và không chia sẻ cho bên thứ ba.
        </p>
      </Section>

      <Section title="4. Quyền truy cập Facebook được dùng vào việc gì">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <code className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-1 py-0.5 text-[13px]">pages_show_list</code> —
            liệt kê các Page người dùng quản lý để họ chọn.
          </li>
          <li>
            <code className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-1 py-0.5 text-[13px]">pages_read_engagement</code>{" "}
            — đọc thông tin cơ bản của Page đã chọn.
          </li>
          <li>
            <code className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-1 py-0.5 text-[13px]">pages_manage_posts</code>{" "}
            — đăng và hẹn giờ bài lên chính Page đó.
          </li>
        </ul>
      </Section>

      <Section title="5. Lưu trữ và bảo mật">
        <p>
          Dữ liệu nằm trên máy chủ riêng của công ty, không dùng dịch vụ lưu trữ của bên thứ ba. Mọi
          access token và app secret được <strong>mã hóa AES-256-GCM</strong> bằng khóa lưu tách
          riêng khỏi cơ sở dữ liệu trước khi ghi xuống đĩa. Ứng dụng chỉ truy cập được sau khi đăng
          nhập qua hệ thống nội bộ của công ty.
        </p>
      </Section>

      <Section title="6. Thời gian lưu trữ">
        <p>
          Token và thông tin tài khoản được giữ cho tới khi người dùng gỡ tài khoản khỏi ứng dụng,
          gỡ quyền ở phía Facebook, hoặc gửi yêu cầu xóa. Xem{" "}
          <a
            className="font-medium text-[var(--color-brand-600)] underline"
            href="/xoa-du-lieu"
          >
            Hướng dẫn xóa dữ liệu người dùng
          </a>
          .
        </p>
      </Section>

      <Section title="7. Quyền của người dùng">
        <p>
          Người dùng có quyền yêu cầu xem, sửa hoặc xóa dữ liệu của mình bất cứ lúc nào. Liên hệ{" "}
          <a
            className="font-medium text-[var(--color-brand-600)] underline"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          . Chúng tôi phản hồi trong vòng 30 ngày.
        </p>
      </Section>

      <Section title="English summary">
        <p>
          BanhXe is an internal tool used by our own staff to compose and schedule posts to Facebook
          Pages our company owns. It stores the connecting user&rsquo;s Facebook ID and name, the
          selected Page IDs and names, access tokens and app credentials (encrypted with AES-256-GCM
          under a key kept separately from the database), and the content the user creates. It uses
          only <em>pages_show_list</em>, <em>pages_read_engagement</em> and <em>pages_manage_posts</em>,
          solely to publish to the Pages the user selected. It collects nothing about Page visitors
          or followers, never sells or shares data with third parties, and honours deletion requests
          within 30 days — see the{" "}
          <a className="font-medium text-[var(--color-brand-600)] underline" href="/xoa-du-lieu">
            data deletion instructions
          </a>
          . Contact:{" "}
          <a
            className="font-medium text-[var(--color-brand-600)] underline"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </article>
  );
}
