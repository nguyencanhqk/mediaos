# FB Post — Đăng bài tự động lên nhiều Facebook Page

Phần mềm chạy trên máy của bạn, giúp soạn nội dung, rải lên **nhiều Facebook Page thuộc nhiều tài
khoản** cùng lúc và hẹn giờ đăng tự động. Hỗ trợ 4 loại nội dung: **bài chữ/link, ảnh (1 ảnh hoặc
album), video, Reels** — soạn tay từng bài, xây thư viện nội dung rồi để phần mềm tự xếp lịch, hoặc
nhập hàng loạt từ CSV/Excel.

Toàn bộ dữ liệu và token nằm trong thư mục `data/` trên máy bạn, không gửi đi đâu khác.

---

## 1. Yêu cầu

| Thành phần | Yêu cầu |
|---|---|
| Node.js | 22 trở lên (máy bạn đang có v24) |
| Tài khoản | Là quản trị viên của các Facebook Page cần đăng — kết nối được nhiều tài khoản |
| Ứng dụng Facebook | Ít nhất một app trên [developers.facebook.com](https://developers.facebook.com/apps) — xem mục 4.1 nếu chưa có |

## 2. Chạy phần mềm

```powershell
cd c:\fbpost
npm install      # chỉ cần chạy lần đầu
npm run dev      # chế độ phát triển
```

Mở trình duyệt vào **http://localhost:3000**.

Muốn chạy nhanh hơn (bản tối ưu):

```powershell
npm run build
npm start
```

## 3. Ba cách đưa bài lên Page

| Cách làm | Dùng khi | Trang |
|---|---|---|
| **Soạn bài** | Một nội dung, đăng ngay hoặc hẹn một giờ, chọn bao nhiêu Page tuỳ ý | Soạn bài |
| **Lên lịch tự động** | Có sẵn nhiều nội dung, muốn rải đều lên nhiều Page theo khung giờ | Nội dung → Lên lịch |
| **Nhập từ file** | Đã chuẩn bị nội dung trong CSV/Excel | Nhập từ file |

Điểm chung: **mỗi Page nhận một bài riêng**. Bài của Page nào lỗi thì chỉ Page đó lỗi, bấm *Thử lại*
cho riêng Page đó, các Page khác không bị ảnh hưởng.

## 4. Kết nối tài khoản Facebook

Phần mềm giữ được **nhiều tài khoản** cùng lúc. Page của tất cả tài khoản dồn chung vào một danh
sách: soạn bài một lần là rải được lên hết, không phải đăng xuất đăng nhập qua lại.

### 4.1. Bước 1 — Tạo ứng dụng Facebook (chỉ làm một lần)

App là thứ Facebook bắt buộc phải có để gọi API. Tạo miễn phí, mất khoảng 2 phút, **không cần gửi
duyệt** khi bạn chỉ đăng lên Page của chính mình.

1. Vào [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app**
   (lần đầu sẽ phải xác minh tài khoản nhà phát triển bằng số điện thoại hoặc thẻ).
2. Đặt tên bất kỳ, chọn loại **Business**.
3. Trong app, thêm **trường hợp sử dụng** (use case):
   - **Đăng nhập Facebook** — bắt buộc, đây là nơi khai địa chỉ trả về ở bước 5.
   - **Quản lý Trang / nội dung** (nhóm *Quản lý nội dung*) — mang theo 3 quyền
     `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.

   Danh sách mặc định lọc theo *Đáng chú ý* nên không thấy hai mục này — bấm **Tất cả** ở cột trái.
4. Vào **App settings → Basic**: **App ID** hiện sẵn, **App Secret** bấm *Show* để xem.
5. Vào **Facebook Login → Settings**, thêm dòng này vào **Valid OAuth Redirect URIs** rồi Save:

   ```text
   http://localhost:3000/api/auth/facebook/callback
   ```

   Trang **Cài đặt** của phần mềm hiện sẵn dòng này theo đúng cổng bạn đang chạy — copy từ đó cho
   chắc.

Dán App ID + App Secret vào **Cài đặt → Bước 1** rồi bấm *Lưu thông tin ứng dụng*.

### 4.2. Bước 2 — Đăng nhập bằng Facebook

Đăng nhập Facebook bằng **đúng tài khoản muốn kết nối**, rồi vào **Cài đặt → Bước 2** bấm
**Đăng nhập bằng Facebook**. Cửa sổ Facebook hiện ra: bấm đồng ý và **chọn tất cả các Page** cần
đăng — bỏ qua bước chọn Page thì phần mềm không thấy Page nào.

Xong. Không phải tick quyền thủ công, không phải copy token, không lo token hết hạn giữa chừng.

Phần mềm tự đổi sang token dài hạn rồi lấy **Page Access Token** riêng cho từng Page. Token của Page
**không có hạn sử dụng** — chỉ mất hiệu lực khi bạn đổi mật khẩu Facebook, gỡ quyền của app, hoặc
Facebook thu hồi vì lý do bảo mật.

### 4.3. Hai đường lùi khi nút đăng nhập không dùng được

Cả hai đều nằm trong phần **Cài đặt → Bước 2**, bấm vào dòng chữ tương ứng để mở ra.

| Tình huống | Cách xử lý |
|---|---|
| Facebook báo *URL Blocked* / không nhận địa chỉ `localhost` | Bấm **Mở cửa sổ đăng nhập (tab mới)** — lần này dùng địa chỉ chính chủ của Facebook, không phải khai báo gì. Sau khi bấm Đồng ý, trang hiện chữ *Success*: copy nguyên đường dẫn trên thanh địa chỉ dán vào ô bên dưới |
| Muốn dùng token tự lấy | Mở [Graph API Explorer](https://developers.facebook.com/tools/explorer/), chọn app, chọn **User Token**, tick đủ 3 quyền `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, bấm Generate rồi dán chuỗi token vào ô *Cách thủ công* |

### 4.4. Thêm tài khoản thứ hai, thứ ba…

Đăng nhập Facebook bằng tài khoản đó (dùng cửa sổ ẩn danh cho tiện), rồi bấm lại
**Đăng nhập bằng Facebook**. Tài khoản cũ không bị mất — Page của tài khoản mới được cộng thêm vào
danh sách.

Tài khoản mới dùng chung ứng dụng ở bước 1, nhưng **phải có vai trò trong ứng dụng đó**:

| Cách | Việc phải làm | Hợp khi nào |
|---|---|---|
| Dùng chung một app | Vào app → **App roles**, mời tài khoản thứ hai làm *Developer* hoặc *Tester*; tài khoản đó vào [developers.facebook.com/requests](https://developers.facebook.com/requests) bấm chấp nhận | Các tài khoản đều là của bạn hoặc người quen |
| Mỗi tài khoản một app riêng | Người đó tự tạo app theo mục 4.1, bạn đổi App ID/Secret ở bước 1 trước khi đăng nhập tài khoản đó | Tài khoản của khách hàng, đối tác |

> **Vì sao phải làm vậy:** khi app còn ở chế độ Development, chỉ tài khoản có vai trò trong app
> (Admin/Developer/Tester) mới đăng nhập được vào app đó. Đây là quy định của Facebook, không phải
> giới hạn của phần mềm.

Đổi App ID/Secret ở bước 1 **không làm hỏng các tài khoản đã kết nối** — mỗi tài khoản giữ bản sao
thông tin ứng dụng của riêng nó.

### 4.5. Quản lý sau khi kết nối

- Trang **Cài đặt**: xem danh sách tài khoản, **Đồng bộ Page** cho từng tài khoản, đổi tên, gỡ.
- Trang **Page**: xem mọi Page kèm tài khoản sở hữu, **bật/tắt** từng Page tuỳ đợt, gỡ Page lẻ,
  hoặc **Đồng bộ tất cả tài khoản** một lượt.

Gỡ một tài khoản sẽ gỡ luôn các Page thuộc tài khoản đó (vì không còn cách làm mới token cho chúng).

## 5. Thư viện nội dung và lên lịch tự động

Đây là luồng dành cho việc rải nhiều bài lên nhiều Page.

### 5.1. Thư viện nội dung (trang **Nội dung**)

Nội dung ở đây **chưa gắn Page, chưa gắn giờ** — chỉ là phần chữ, ảnh, video kèm một nhãn để dễ tìm.
Thêm bằng tay, hoặc nhập hàng loạt từ file, hoặc tick *Lưu vào thư viện* khi soạn bài.

### 5.2. Lên lịch (trang **Lên lịch**)

Bốn bước:

1. **Chọn nội dung** — tick các nội dung muốn rải.
2. **Chọn Page** — tick các Page nhận bài. Thứ tự chọn quyết định Page nào đăng trước.
3. **Đặt quy tắc rải bài** (bảng ngay dưới).
4. **Xem trước rồi tạo lịch** — bảng xem trước hiện rõ từng dòng *thời điểm × Page × nội dung* và ai
   giữ lịch. Ưng ý thì bấm tạo.

| Thiết lập | Ý nghĩa |
|---|---|
| Ngày bắt đầu | Lịch tính từ ngày này; khung giờ đã qua trong hôm nay sẽ bị bỏ qua |
| Khung giờ trong ngày | VD 08:00 và 19:00 — mỗi khung dùng hết một nội dung |
| Các thứ được đăng | Bỏ tick T7/CN nếu không muốn đăng cuối tuần |
| Lệch giờ giữa các Page | Các Page cùng khung giờ đăng cách nhau vài phút, tránh trùng khít |
| Cách rải | *Tất cả Page* (mỗi nội dung lên mọi Page) hoặc *xoay vòng* (mỗi nội dung một Page) |
| Thứ tự nội dung | Theo danh sách hoặc xáo trộn ngẫu nhiên |
| Lặp lại nội dung | Hết nội dung thì quay lại từ đầu cho tới khi chạm giới hạn |
| Giới hạn số bài | Trần an toàn cho mỗi lần tạo lịch |

Ví dụ: 10 nội dung × 3 Page, 2 khung giờ mỗi ngày, cách rải *tất cả Page* → 30 bài, trải trong 5 ngày.

### 5.3. Bài được gửi lên Facebook thế nào

Bài không bị gửi ồ ạt. Chúng vào hàng đợi, phần mềm đẩy dần **tối đa 8 bài mỗi phút** để không chạm
giới hạn tần suất API của Facebook. Trang **Hàng đợi** hiển thị số bài còn chờ và tự làm mới.

## 6. Cách hẹn giờ hoạt động

Đây là điểm quan trọng nhất cần hiểu:

| Thời điểm hẹn | Ai giữ lịch | Máy có cần bật không? |
|---|---|---|
| Đăng ngay | — | Có, cho tới khi phần mềm gửi xong |
| Từ 10 phút đến 30 ngày tới (Reels: 29 ngày) | **Facebook** | **Không** — sau khi bài đã được đẩy lên Facebook |
| Dưới 10 phút hoặc xa hơn 30 ngày | Phần mềm | **Có** — phải để phần mềm chạy đến giờ đăng |

Phần lớn trường hợp rơi vào hàng giữa: bài được đẩy lên Facebook trong vòng ít phút sau khi bạn tạo
lịch, và Facebook tự đăng đúng giờ. Sau khi hàng đợi trống, bạn có thể tắt máy.

Với bài do phần mềm giữ lịch, có một tiến trình kiểm tra mỗi 60 giây và đăng khi tới giờ.
Tiến trình này khởi động ngay khi bạn mở giao diện lần đầu sau khi chạy `npm run dev` —
nên sau khi khởi động phần mềm, hãy mở `http://localhost:3000` một lần rồi cứ để đó.

Nếu quá giờ hẹn hơn 24 tiếng mà phần mềm không chạy, bài sẽ bị đánh dấu lỗi thay vì đăng muộn.

## 7. Nhập hàng loạt từ CSV/Excel

Vào trang **Nhập từ file**, chọn file `.csv` hoặc `.xlsx`. Dòng đầu tiên là tên cột.

| Cột | Tên chấp nhận | Ý nghĩa |
|---|---|---|
| Nội dung | `message`, `noi_dung`, `content`, `caption` | Nội dung bài viết |
| Loại | `type`, `loai` | `text` / `photo` / `video` / `reel` — bỏ trống sẽ tự đoán theo file đính kèm |
| File | `media`, `file`, `anh`, `video` | Đường dẫn file **trên máy bạn**, nhiều file cách nhau bằng dấu `\|` |
| Thời gian | `scheduled_at`, `thoi_gian`, `gio_dang` | VD `10/08/2026 09:00` hoặc `2026-08-10 09:00` — bỏ trống là đăng ngay |
| **Page** | `page`, `trang`, `fanpage` | **Tên Page cần đăng**, nhiều Page cách nhau bằng `\|` — bỏ trống thì dùng các Page đã tick trên màn hình |
| Link | `link`, `url` | Link đính kèm cho bài chữ |
| Tiêu đề | `title`, `tieu_de` | Tiêu đề video / Reels |

Khi nhập, chọn một trong hai đích:

- **Tạo lịch đăng luôn** — mỗi dòng thành bài cho từng Page, theo giờ trong file.
- **Chỉ nạp vào thư viện** — chưa đăng gì, sau đó dùng trang *Lên lịch* để rải theo khung giờ.

File mẫu có sẵn: [`mau-bai-dang.csv`](mau-bai-dang.csv)

Phần mềm hiển thị bản xem trước kèm lỗi từng dòng trước khi nhập — dòng lỗi sẽ bị bỏ qua.

## 8. Yêu cầu định dạng của Facebook

**Reels** (Facebook kiểm tra nghiêm ngặt, sai là bị từ chối):

- Tỷ lệ 9:16 (video dọc), khuyến nghị 1080×1920, tối thiểu 540×960
- Dài 3–90 giây, 24–60 fps
- Định dạng MP4, video H.264/H.265, audio AAC 48kHz

**Ảnh:** jpg, png, gif, webp, bmp — **Video:** mp4, mov, m4v, webm

## 9. Xử lý sự cố

| Thông báo | Cách khắc phục |
|---|---|
| Token đã hết hạn hoặc không hợp lệ | Làm lại bước 4.2 và 4.3 cho tài khoản đó — các tài khoản khác không bị ảnh hưởng |
| Token thiếu quyền cần thiết | Đăng nhập lại và cấp đủ 3 quyền `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` |
| Không tìm thấy Page nào | Ở bước cấp quyền, phải chọn cụ thể từng Page chứ không bỏ qua |
| Không tạo được token cho tài khoản thứ hai | App đang ở chế độ Development — mời tài khoản đó làm Developer/Tester, hoặc để họ dùng app riêng (mục 4.4) |
| `URL Blocked` khi bấm Đăng nhập | Chưa khai địa chỉ trả về trong *Facebook Login → Settings* (bước 4.1.5), hoặc app không nhận `localhost` — dùng đường lùi ở mục 4.3 |
| `Phiên đăng nhập không khớp hoặc đã quá hạn` | Cửa sổ đăng nhập để quá 10 phút — bấm Đăng nhập lại từ đầu |
| Page không có quyền đăng bài | Tài khoản của bạn cần vai trò có quyền tạo nội dung trên Page đó |
| Không tìm thấy Page "..." trong danh sách | Page đã bị gỡ khỏi phần mềm — vào trang Page bấm *Lấy lại danh sách từ Facebook* |
| Đã chạm giới hạn số lần gọi API | Chờ khoảng 1 tiếng. Chia nhỏ kế hoạch thay vì tạo hàng trăm bài một lúc |
| Video/Reels không đạt yêu cầu định dạng | Xem lại mục 8, đặc biệt tỷ lệ và độ dài Reels |

**Xoá bài đã hẹn trên Facebook:** nút Xoá trong phần mềm chỉ gỡ bài khỏi danh sách của phần mềm.
Bài đã ở trạng thái *Đã hẹn trên Facebook* vẫn nằm trong lịch của Facebook — muốn huỷ hẳn phải vào
**Meta Business Suite → Nội dung → Bài viết đã lên lịch**. Huỷ một kế hoạch cũng chỉ huỷ được các bài
chưa gửi đi.

## 10. Cấu trúc mã nguồn

```text
src/
  app/
    page.tsx              Hàng đợi bài đăng (lọc theo Page và trạng thái)
    contents/             Thư viện nội dung
    plan/                 Lên lịch đăng tự động
    compose/              Soạn bài, chọn nhiều Page
    import/               Nhập từ CSV/Excel
    pages/                Quản lý danh sách Page của mọi tài khoản
    settings/             Quản lý các tài khoản Facebook đã kết nối
    api/                  Các route xử lý phía server
      auth/facebook/      Luồng đăng nhập: start → callback, và đường lùi dán URL
  components/
    page-picker.tsx       Ô chọn nhiều Page
    media-input.tsx       Ô chọn và xem trước file
  lib/
    fb/                   Tích hợp Graph API
      client.ts           Gọi API + dịch mã lỗi sang tiếng Việt
      auth.ts             Đổi token, nhận diện chủ tài khoản, lấy danh sách Page
      oauth.ts            Dựng địa chỉ đăng nhập, đọc mã trả về (thuần, không chạm CSDL)
      connect.ts          Bước cuối dùng chung của cả ba cách kết nối tài khoản
      feed.ts             Bài chữ/link và album ảnh
      photos.ts           Bài ảnh
      videos.ts           Video (upload theo từng phần)
      reels.ts            Reels
      publish.ts          Điều phối chung, lấy token theo Page của bài
    plan/
      generate.ts         Bộ sinh lịch (thuần, tất định)
      service.ts          Kiểm tra cấu hình và nạp dữ liệu cho bộ sinh lịch
    repo/                 Truy cập SQLite (accounts, pages, contents, plans, posts, media)
    import/               Đọc và ánh xạ CSV/Excel
    schedule.ts           Quy tắc chọn bên giữ lịch
    worker.ts             Đẩy bài lên Facebook theo đợt + bộ hẹn giờ nội bộ
    worker-boot.ts        Khởi động worker (chỉ chạy trên Node runtime)
data/                     CSDL + media (không commit lên git)
```

### Mô hình dữ liệu

```text
accounts  một tài khoản Facebook = một bộ App ID/Secret + User Access Token
pages     một Page = một Page Access Token riêng, thuộc một tài khoản (account_id)
contents  thư viện nội dung, chưa gắn Page hay giờ
plans     cấu hình đã dùng để sinh lịch
posts     một lượt đăng = một nội dung × một Page × một thời điểm
          (page_ref, content_id, plan_id, batch_id)
```

Nâng cấp từ bản cũ diễn ra tự động ở lần chạy đầu tiên, không cần thao tác gì:

- Cấu hình tài khoản trong bảng `settings` thành dòng đầu tiên của bảng `accounts`.
- Page duy nhất trong `settings` thành dòng đầu tiên của bảng `pages`, các bài cũ gán về Page đó.
- Các Page đã có nhưng chưa gắn tài khoản được gán về tài khoản trên.

Tài khoản dựng theo cách này mang tên tạm *"Tài khoản đã kết nối"*. Lần kết nối lại kế tiếp bằng cùng
App ID, phần mềm thay bằng tên và ID thật trên Facebook chứ không tạo thêm dòng mới.

## 11. Lưu ý an toàn

- Thư mục `data/` chứa App Secret và token của mọi tài khoản, mọi Page — đã được loại khỏi git qua
  `.gitignore`. Đừng chia sẻ thư mục này.
- Phần mềm chỉ nghe ở `localhost`, không mở ra mạng ngoài. Nếu muốn truy cập từ máy khác,
  cần tự bổ sung lớp xác thực trước.
- Phần mềm dùng Graph API chính thức của Facebook, không giả lập trình duyệt, nên không vi phạm
  điều khoản sử dụng.
