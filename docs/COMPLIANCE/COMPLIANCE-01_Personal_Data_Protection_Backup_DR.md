# COMPLIANCE-01: TUÂN THỦ BẢO VỆ DỮ LIỆU CÁ NHÂN & CHÍNH SÁCH BACKUP/DR
# KHUNG TUÂN THỦ — HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu COMPLIANCE — Hệ thống Quản lý Doanh nghiệp**
> **COMPLIANCE-01 Bảo vệ DLCN & Backup/DR** *(tài liệu hiện tại)* · *COMPLIANCE-02+ sẽ bổ sung sau*
>
> **Nguồn & liên quan:** [Chỉ mục: README](<../README.md>) · [Định hướng sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Tổng quan & dữ liệu nhạy cảm: SPEC-01](<../SPEC/SPEC-01 Tổng quan.md>) · [Audit/Retention/Files: DB-08](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) · [Release Readiness: BACKEND-14](<../BACKEND/BACKEND-14_Backend_Release_Readiness.md>) · [Hạ tầng/Backup cơ chế: DEVOPS-01](<../DEVOPS/DEVOPS-01_Infrastructure_Backup_Deployment.md>) *(tài liệu song hành đang tạo)* · [QA/Bảo mật: BACKEND-13](<../BACKEND/BACKEND-13_Backend_Testing_Security_Performance.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | COMPLIANCE-01 |
| Tên tài liệu | Tuân thủ Bảo vệ Dữ liệu Cá nhân & Chính sách Backup/DR |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Governance & Compliance - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01, DB-08, BACKEND-13, BACKEND-14, DEVOPS-01 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích & phạm vi

> **⚠️ DISCLAIMER (Tuyên bố miễn trừ):** Tài liệu này là **khung tuân thủ nội bộ** dành cho đội ngũ phát triển sản phẩm, nhằm định hướng thiết kế kỹ thuật và quy trình theo pháp luật bảo vệ dữ liệu cá nhân của Việt Nam. **Tài liệu này KHÔNG thay thế tư vấn pháp lý chính thức.** Trước khi đưa hệ thống vào vận hành thực tế (go-live), doanh nghiệp **bắt buộc** phải để luật sư và/hoặc chuyên gia tuân thủ dữ liệu rà soát, xác nhận đầy đủ nghĩa vụ pháp lý áp dụng cho mô hình kinh doanh cụ thể. Các số điều luật, ngưỡng thời hạn và mục tiêu kỹ thuật nêu ở đây là **đề xuất định hướng**, cần được pháp chế và Product/DevOps phê duyệt.

### 2.1 Mục đích

Tài liệu này nhằm:

1. Xác lập **chính sách & mục tiêu** bảo vệ dữ liệu cá nhân (DLCN) trong toàn hệ thống.
2. Ánh xạ nghĩa vụ pháp lý Việt Nam (đặc biệt Nghị định 13/2023/NĐ-CP) sang yêu cầu thiết kế kỹ thuật cụ thể.
3. Kiểm kê và phân loại dữ liệu cá nhân do hệ thống xử lý (Data Inventory / Mapping).
4. Định nghĩa **chính sách Backup & Disaster Recovery (DR)** với mục tiêu RPO/RTO theo lớp dữ liệu.
5. Cung cấp checklist tuân thủ trước go-live và phân định vai trò/trách nhiệm.

### 2.2 Phạm vi

| Bao gồm | Không bao gồm |
| --- | --- |
| Khung tuân thủ DLCN cấp sản phẩm | Hợp đồng pháp lý chính thức với khách hàng/đối tác |
| Chính sách & mục tiêu Backup/DR (RPO/RTO) | **Cơ chế kỹ thuật thực thi** backup/restore (nằm ở DEVOPS-01) |
| Yêu cầu thiết kế để đáp ứng quyền chủ thể dữ liệu | Tư vấn pháp lý ràng buộc cho từng pháp nhân |
| Chính sách lưu trữ, xóa, thông báo vi phạm | Quy trình HR nội bộ ngoài phạm vi hệ thống |

> **Ranh giới với DEVOPS-01:** Tài liệu COMPLIANCE-01 định nghĩa **CHÍNH SÁCH & MỤC TIÊU** (cái gì phải đạt được, vì sao). [DEVOPS-01](<../DEVOPS/DEVOPS-01_Infrastructure_Backup_Deployment.md>) định nghĩa **CƠ CHẾ THỰC THI** (lệnh, automation, hạ tầng cụ thể để đạt mục tiêu đó). Hai tài liệu phải nhất quán về con số RPO/RTO và lịch backup.

---

## 3. Căn cứ pháp lý Việt Nam

| Văn bản | Phạm vi điều chỉnh liên quan | Ghi chú áp dụng cho hệ thống |
| --- | --- | --- |
| **Nghị định 13/2023/NĐ-CP** về Bảo vệ dữ liệu cá nhân (có hiệu lực **01/07/2023**) | Văn bản **trọng tâm**: định nghĩa DLCN cơ bản/nhạy cảm, nguyên tắc xử lý, sự đồng ý, quyền chủ thể dữ liệu, đánh giá tác động (DPIA), chuyển dữ liệu ra nước ngoài, thông báo vi phạm | Toàn bộ thiết kế xử lý DLCN của hệ thống phải tuân thủ nghị định này |
| **Bộ luật Lao động 2019** | Quản lý hồ sơ nhân sự, hợp đồng lao động, chấm công, nghỉ phép, kỷ luật, nghỉ việc | Là **cơ sở pháp lý** chính cho việc xử lý dữ liệu của người lao động trong quan hệ lao động |
| **Luật An toàn thông tin mạng 2015** | Bảo đảm an toàn thông tin, bảo vệ thông tin cá nhân trên mạng, trách nhiệm bảo mật | Định hướng biện pháp kỹ thuật bảo vệ (mã hóa, kiểm soát truy cập, ghi log) |
| **Luật Giao dịch điện tử** | Giá trị pháp lý của dữ liệu điện tử, chữ ký, lưu trữ chứng từ điện tử | Liên quan tới hợp đồng điện tử, audit trail làm bằng chứng, lưu trữ hồ sơ |

> **Cơ quan quản lý chuyên trách:** **Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao (A05) — Bộ Công an** là đầu mối tiếp nhận hồ sơ đánh giá tác động, hồ sơ chuyển dữ liệu ra nước ngoài và thông báo vi phạm dữ liệu cá nhân theo Nghị định 13/2023/NĐ-CP.

---

## 4. Định nghĩa & phân loại dữ liệu cá nhân (theo NĐ 13/2023)

Nghị định 13/2023/NĐ-CP phân DLCN thành hai nhóm:

| Nhóm | Khái niệm tóm tắt | Ví dụ điển hình |
| --- | --- | --- |
| **Dữ liệu cá nhân cơ bản** | Thông tin gắn với một con người cụ thể, giúp xác định/định danh ở mức thông thường | Họ tên, ngày sinh, giới tính, địa chỉ, số điện thoại, email, số CCCD/CMND, hình ảnh cá nhân, tình trạng hôn nhân, thông tin tài khoản số |
| **Dữ liệu cá nhân nhạy cảm** | Thông tin mà khi bị lộ/xâm phạm có thể ảnh hưởng nghiêm trọng tới quyền và lợi ích hợp pháp của chủ thể, cần biện pháp bảo vệ **chặt chẽ hơn** | Dữ liệu về tài chính/thu nhập, dữ liệu sức khỏe, dữ liệu phản ánh hoạt động/đời sống riêng tư, một số thông tin tài chính - ngân hàng và dữ liệu định danh có độ nhạy cao |

> Việc xử lý DLCN nhạy cảm đòi hỏi nghĩa vụ cao hơn: phải thông báo rõ cho chủ thể về việc dữ liệu được xử lý là loại nhạy cảm, áp dụng biện pháp bảo vệ tăng cường và (trong nhiều trường hợp) phải có bộ phận/cá nhân chuyên trách bảo vệ DLCN.

---

## 5. Bảng kiểm kê dữ liệu (Data Inventory / Mapping)

Bảng dưới ánh xạ từng loại dữ liệu hệ thống đang xử lý sang phân loại, module, mục đích, cơ sở pháp lý và biện pháp bảo vệ. Đây là **căn cứ đầu vào** cho Hồ sơ đánh giá tác động (DPIA — Mục 9).

| Loại dữ liệu | Cơ bản/Nhạy cảm | Module | Mục đích xử lý | Cơ sở pháp lý | Biện pháp bảo vệ |
| --- | --- | --- | --- | --- | --- |
| Họ tên | Cơ bản | HR | Định danh nhân viên, hiển thị nghiệp vụ | Hợp đồng lao động | RBAC, audit |
| Ngày sinh | Cơ bản | HR | Hồ sơ nhân sự, tính chế độ | Hợp đồng lao động | RBAC, masking khi cần |
| Giới tính | Cơ bản | HR | Hồ sơ nhân sự, thống kê | Hợp đồng lao động | RBAC |
| Địa chỉ | Cơ bản | HR | Liên hệ, hồ sơ | Hợp đồng lao động | RBAC, audit |
| Số điện thoại | Cơ bản | HR / AUTH | Liên hệ, khôi phục tài khoản | Hợp đồng lao động + đồng ý | RBAC, masking |
| Email | Cơ bản | HR / AUTH | Đăng nhập, thông báo | Hợp đồng + đồng ý | RBAC |
| CCCD/CMND | Cơ bản (nhạy cao) | HR | Định danh pháp lý, hợp đồng | Hợp đồng + nghĩa vụ pháp luật | **Mã hóa field-level (đề xuất)**, RBAC, masking, audit xem |
| Ảnh cá nhân | Cơ bản | HR | Hồ sơ, nhận diện nội bộ | Đồng ý | File private mặc định, RBAC |
| Tài khoản ngân hàng | **Nhạy cảm** | HR | Chi trả lương | Hợp đồng lao động | **Mã hóa field-level (đề xuất)**, RBAC tách quyền, audit xem |
| Lương / thu nhập | **Nhạy cảm** | HR / Payroll | Chi trả, quyết toán | Hợp đồng + nghĩa vụ pháp luật | **Mã hóa (đề xuất)**, RBAC tách quyền riêng, audit xem |
| Hợp đồng lao động | **Nhạy cảm** | HR | Quản lý quan hệ lao động | Bộ luật Lao động | File private, RBAC, audit |
| Dữ liệu chấm công chi tiết | **Nhạy cảm** | ATT | Tính công, quản lý giờ làm | Bộ luật Lao động | RBAC + data scope, audit |
| Dữ liệu nghỉ phép | Cơ bản (nhạy cảm theo ngữ cảnh) | LEAVE | Quản lý phép, phê duyệt | Bộ luật Lao động | RBAC + data scope, audit |
| Dữ liệu kỷ luật / nghỉ việc | **Nhạy cảm** | HR | Quản lý quan hệ lao động | Bộ luật Lao động | RBAC chặt, audit, hạn chế export |
| Log hệ thống (chứa IP, user agent) | Cơ bản | FOUNDATION | An toàn, truy vết, điều tra | Lợi ích hợp pháp + ATTT mạng | Quyền System, retention có thời hạn |

> Tham chiếu danh mục dữ liệu nhạy cảm gốc: [SPEC-01 §11.3](<../SPEC/SPEC-01 Tổng quan.md>).

---

## 6. Nguyên tắc xử lý dữ liệu cá nhân

Nghị định 13/2023/NĐ-CP yêu cầu việc xử lý DLCN tuân thủ một tập nguyên tắc nền tảng. Bảng dưới ánh xạ mỗi nguyên tắc sang cách hệ thống đáp ứng.

| Nguyên tắc | Yêu cầu | Hệ thống đáp ứng như thế nào |
| --- | --- | --- |
| **Hợp pháp** | Xử lý theo quy định pháp luật, có cơ sở pháp lý | Mỗi loại dữ liệu gắn cơ sở pháp lý (Mục 5); xử lý dữ liệu lao động dựa trên hợp đồng |
| **Minh bạch** | Chủ thể được biết hoạt động xử lý liên quan tới mình | Thông báo xử lý DLCN khi onboard; cung cấp bản mô tả mục đích xử lý |
| **Đúng mục đích** | Chỉ xử lý đúng mục đích đã thông báo | Phân quyền theo module/chức năng; không tái sử dụng dữ liệu sai mục đích |
| **Tối thiểu (hạn chế)** | Thu thập/ xử lý vừa đủ, không dư thừa | Form chỉ thu trường cần thiết; payload notification không chứa dữ liệu nhạy cảm dư thừa |
| **Chính xác** | Dữ liệu chính xác, cập nhật | Cho phép cập nhật hồ sơ; quy trình duyệt thay đổi; audit `old_value`/`new_value` |
| **Lưu trữ có thời hạn** | Không lưu lâu hơn mức cần thiết | Chính sách retention (Mục 12), bảng `data_retention_policies` (DB-08) |
| **Bảo mật, toàn vẹn** | Bảo vệ khỏi truy cập, thay đổi, mất mát trái phép | RBAC + data scope, mã hóa, TLS, backup, password hash Argon2id/bcrypt, JWT |
| **Trách nhiệm giải trình** | Chứng minh được sự tuân thủ | Audit log đầy đủ (actor/action/target/old/new/ip/ua/time), DPIA, hồ sơ retention |

---

## 7. Sự đồng ý & cơ sở pháp lý xử lý

### 7.1 Nguyên tắc

- Trong **quan hệ lao động**, cơ sở pháp lý chính cho việc xử lý dữ liệu nhân viên là **hợp đồng lao động** và việc tuân thủ nghĩa vụ pháp luật (BHXH, thuế, quản lý lao động). Tuy nhiên, điều này **không miễn trừ** nghĩa vụ thông báo minh bạch.
- Với **dữ liệu cá nhân nhạy cảm** (lương, tài khoản ngân hàng, CCCD, dữ liệu kỷ luật...), hệ thống vẫn phải **thông báo rõ** và thu thập **sự đồng ý phù hợp** khi cơ sở "hợp đồng/nghĩa vụ pháp luật" chưa đủ bao phủ mục đích.
- Sự đồng ý phải: tự nguyện, rõ ràng, cụ thể theo mục đích, và **có thể rút lại** (xem Mục 8).

### 7.2 Cơ chế ghi nhận consent trong hệ thống (đề xuất)

Đề xuất bổ sung bảng `consent_records` để chứng minh trách nhiệm giải trình:

| Trường | Mô tả |
| --- | --- |
| `subject_id` | Chủ thể dữ liệu (nhân viên/người dùng) |
| `purpose_code` | Mã mục đích xử lý (vd: PAYROLL, MARKETING_INTERNAL) |
| `data_category` | Loại dữ liệu (cơ bản/nhạy cảm) |
| `consent_status` | granted / withdrawn |
| `consent_version` | Phiên bản văn bản thông báo đã đồng ý |
| `granted_at` / `withdrawn_at` | Mốc thời gian |
| `evidence` | Nguồn/bằng chứng (IP, kênh, người ghi nhận) |

> Việc cấp/rút consent là thao tác quan trọng → **phải được ghi vào audit log**.

---

## 8. Quyền của chủ thể dữ liệu

Nghị định 13/2023/NĐ-CP quy định một tập quyền cho chủ thể dữ liệu. Bảng dưới ánh xạ từng quyền sang tính năng hệ thống cần có và **hiện trạng** (đã có / cần bổ sung).

| Quyền của chủ thể | Tính năng cần có trong hệ thống | Hiện trạng |
| --- | --- | --- |
| Quyền **được biết** | Trang/thông báo mô tả việc xử lý DLCN của chính họ | **Cần bổ sung** (privacy notice) |
| Quyền **đồng ý** | Màn hình thu thập đồng ý theo mục đích | **Cần bổ sung** (`consent_records`) |
| Quyền **truy cập** | Nhân viên xem được hồ sơ cá nhân của mình | Một phần đã có (xem hồ sơ HR) |
| Quyền **rút lại đồng ý** | Nút rút đồng ý theo mục đích, có hiệu lực kể từ thời điểm rút | **Cần bổ sung** |
| Quyền **xóa dữ liệu** | Quy trình xử lý yêu cầu xóa (gắn với retention & nghĩa vụ lưu trữ pháp luật) | **Cần bổ sung** (luồng yêu cầu xóa) |
| Quyền **hạn chế xử lý** | Cờ trạng thái tạm dừng xử lý một phần dữ liệu | **Cần bổ sung** |
| Quyền **cung cấp dữ liệu** (data portability) | Xuất hồ sơ cá nhân của chính chủ thể (định dạng đọc được) | **Cần bổ sung** (self-export) |
| Quyền **phản đối** xử lý | Kênh gửi phản đối/khiếu nại nội bộ | **Cần bổ sung** |
| Quyền **khiếu nại, tố cáo, khởi kiện** | Đầu mối tiếp nhận; hướng dẫn liên hệ A05 khi cần | Quy trình tổ chức (ngoài hệ thống) |
| Quyền **yêu cầu bồi thường thiệt hại** | Hồ sơ bằng chứng (audit trail) phục vụ xử lý tranh chấp | Audit log đã có (hỗ trợ) |

> Xử lý khi **nghỉ việc**: cần quy trình khóa truy cập, chuyển trạng thái hồ sơ sang lưu trữ theo retention, và xử lý các yêu cầu quyền chủ thể còn tồn đọng. Liên kết: Mục 12.

---

## 9. Hồ sơ đánh giá tác động xử lý dữ liệu cá nhân (DPIA)

Theo Nghị định 13/2023/NĐ-CP, Bên Kiểm soát/Xử lý DLCN có nghĩa vụ **lập và lưu giữ Hồ sơ đánh giá tác động xử lý dữ liệu cá nhân (DPIA)** kể từ khi bắt đầu xử lý. Hồ sơ này **có thể bị A05 (Bộ Công an) kiểm tra** bất kỳ lúc nào.

Nội dung hồ sơ DPIA cần có (tối thiểu):

1. Thông tin và chi tiết liên hệ của Bên Kiểm soát / Bên Xử lý DLCN.
2. Thông tin của bộ phận/cá nhân chịu trách nhiệm bảo vệ DLCN.
3. Mục đích xử lý DLCN (theo từng nhóm dữ liệu — bám Mục 5).
4. Loại DLCN được xử lý (cơ bản/nhạy cảm) và phạm vi.
5. Tổ chức/cá nhân được tiếp cận DLCN (nội bộ và bên thứ ba/vendor).
6. Thời gian dự kiến xử lý/lưu trữ và thời điểm xóa/hủy.
7. Đánh giá rủi ro và biện pháp giảm thiểu (kỹ thuật & tổ chức — Mục 11).
8. Trường hợp chuyển DLCN ra nước ngoài (nếu có — Mục 10).

> **Khuyến nghị:** Lập DPIA **trước go-live**, rà soát định kỳ và mỗi khi thay đổi lớn về phạm vi xử lý dữ liệu.

---

## 10. Chuyển dữ liệu cá nhân ra nước ngoài

Nếu hệ thống lưu trữ/xử lý DLCN trên hạ tầng **đặt ngoài lãnh thổ Việt Nam** (ví dụ region nước ngoài của AWS/GCP/Azure), thì theo Nghị định 13/2023/NĐ-CP đây được xem là **chuyển DLCN ra nước ngoài** và phát sinh nghĩa vụ:

1. Lập **Hồ sơ đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài**.
2. Lưu giữ hồ sơ và **gửi/đăng ký với Bộ Công an (A05)** theo quy định.
3. Bảo đảm có cơ sở pháp lý và biện pháp bảo vệ tương đương khi dữ liệu rời lãnh thổ.

> **⚠️ Cảnh báo ảnh hưởng kiến trúc:** Quyết định **hosting** (region trong nước vs nước ngoài) tác động trực tiếp tới nghĩa vụ pháp lý này. Đề xuất ưu tiên region **trong nước** cho MVP để giảm gánh nặng tuân thủ, hoặc nếu dùng region nước ngoài thì phải hoàn tất hồ sơ trước go-live. Quyết định hạ tầng cụ thể: xem [DEVOPS-01](<../DEVOPS/DEVOPS-01_Infrastructure_Backup_Deployment.md>). Câu hỏi mở liên quan: **CMP-OQ-001**.

---

## 11. Biện pháp bảo vệ kỹ thuật & tổ chức

### 11.1 Biện pháp kỹ thuật

| Biện pháp | Mô tả | Hiện trạng |
| --- | --- | --- |
| Mã hóa **at-rest** | Đề xuất **field-level encryption** cho lương, CCCD/CMND, số tài khoản ngân hàng; mã hóa volume/disk ở tầng hạ tầng | **Đề xuất** (CMP-OQ-003) |
| Mã hóa **in-transit** | TLS bắt buộc cho mọi kết nối client-server và service-service | Theo chuẩn (DEVOPS-01) |
| **Masking** | Che một phần khi hiển thị (vd `xxxx-xxx-1234`) cho người không có quyền xem đầy đủ | Một phần / cần chuẩn hóa |
| **RBAC + data scope** | Phân quyền theo vai trò và phạm vi Own/Team/Department/Project/Company/System | **Đã có** |
| **Hash mật khẩu** | Argon2id/bcrypt cho mật khẩu; không lưu plaintext | **Đã có** |
| **Token** | JWT cho phiên; kiểm soát hết hạn/thu hồi | **Đã có** |
| **File private mặc định** | File mặc định private; kiểm tra quyền trước khi cấp xem/tải | **Đã có** |
| **Kiểm soát export** | Phân quyền export riêng; chặn xuất dữ liệu nhạy cảm nếu không có quyền | **Đã có** (SPEC-01 §11.3) |

### 11.2 Audit truy cập & xuất dữ liệu nhạy cảm

Hệ thống **đã có** bảng `audit_logs` (DB-08) ghi nhận: `actor_id`, `action`, `module`, `target_type`, `target_id`, `old_value`, `new_value`, `ip_address`, `user_agent`, `created_at`; kèm `file_access_logs` cho truy cập file.

> **✅ Quyết định chính sách (TRẢ LỜI SPEC-01 §29 câu #15 — "Có cần audit log cho thao tác xem dữ liệu nhạy cảm không?"):**
> **CÓ — BẮT BUỘC.** Để thỏa mãn nguyên tắc trách nhiệm giải trình của NĐ 13/2023, hệ thống **phải ghi audit log cả thao tác XEM (read) dữ liệu nhạy cảm** (lương, CCCD/CMND, tài khoản ngân hàng, hợp đồng, dữ liệu kỷ luật/nghỉ việc), không chỉ thao tác tạo/sửa/xóa/xuất. Mỗi lần xem dữ liệu nhạy cảm sinh một bản ghi `audit_logs` với `action = VIEW_SENSITIVE` (hoặc tương đương), gắn `target_type`/`target_id`. Điều này khớp với SPEC-01 §11.3 (mục 3 — "mọi thao tác xem, sửa, xuất dữ liệu nhạy cảm cần được ghi log") và §16.3 ("Xem dữ liệu nhạy cảm nếu cần").

### 11.3 Biện pháp tổ chức

- Chỉ định bộ phận/cá nhân **chuyên trách bảo vệ DLCN** (Mục 15, CMP-OQ-002).
- Đào tạo nhận thức bảo mật cho nhân sự tiếp cận DLCN.
- Quy trình cấp/thu hồi quyền theo nguyên tắc tối thiểu đặc quyền (least privilege).
- Soát xét quyền truy cập định kỳ.

---

## 12. Chính sách lưu trữ & xóa dữ liệu (Data Retention)

Hệ thống đã có cơ chế **soft delete** (`deleted_at`) và bảng **`data_retention_policies`** (DB-08) làm nền tảng thực thi. Bảng dưới đề xuất thời hạn lưu trữ theo loại dữ liệu — **các con số là đề xuất, cần pháp chế/Product chốt** (CMP-OQ-004).

| Loại dữ liệu | Thời hạn lưu đề xuất | Sau thời hạn | Ghi chú |
| --- | --- | --- | --- |
| Hồ sơ nhân sự (sau nghỉ việc) | Theo quy định lưu trữ lao động (đề xuất ≥ thời hạn luật định) | Ẩn danh hóa hoặc lưu trữ hạn chế | Cân nhắc nghĩa vụ tranh chấp lao động |
| Hợp đồng lao động | Theo quy định lưu trữ chứng từ | Lưu trữ/đóng băng | Có thể có nghĩa vụ kế toán/pháp lý |
| Dữ liệu chấm công | Theo kỳ quyết toán + biên độ tra cứu (đề xuất) | Tổng hợp/ẩn danh | Giữ tổng hợp cho thống kê |
| Dữ liệu nghỉ phép | Theo năm tài chính + biên độ (đề xuất) | Tổng hợp/ẩn danh | |
| Audit log | Đề xuất tối thiểu 12 tháng (cân nhắc 24 tháng cho dữ liệu nhạy cảm) | Archive rồi xóa theo job | DB-08: xóa qua job hệ thống có ghi log riêng |
| Backup | Theo lịch retention backup (Mục 14) | Hủy an toàn (secure delete) | Backup cũng chứa DLCN → bảo vệ tương đương |

### 12.1 Soft delete vs hard delete

- **Soft delete** (`deleted_at`): mặc định cho dữ liệu nghiệp vụ — cho phép khôi phục, giữ toàn vẹn lịch sử.
- **Hard delete**: thực hiện qua **job hệ thống có quyền System**, chạy theo `data_retention_policies`, và **ghi audit log riêng** cho hành động xóa (DB-08 nguyên tắc audit).

### 12.2 Ẩn danh hóa (Anonymization)

Khi cần giữ dữ liệu cho **thống kê/báo cáo** nhưng đã hết cơ sở giữ DLCN, ưu tiên **ẩn danh hóa** (loại bỏ định danh không thể phục hồi) thay vì xóa cứng — vừa đáp ứng nguyên tắc lưu trữ có thời hạn, vừa giữ giá trị phân tích.

---

## 13. Quy trình thông báo vi phạm dữ liệu (Breach Notification)

Theo Nghị định 13/2023/NĐ-CP, khi xảy ra vi phạm DLCN, Bên Kiểm soát/Xử lý phải **thông báo cho Bộ Công an (A05) chậm nhất 72 giờ** kể từ khi phát hiện vi phạm; trường hợp thông báo trễ phải nêu lý do.

Quy trình đề xuất:

| Bước | Hành động | Đầu mối |
| --- | --- | --- |
| 1. Phát hiện | Cảnh báo từ monitoring/alert/audit bất thường → mở incident | DevOps/Security |
| 2. Đánh giá | Xác định phạm vi, loại dữ liệu, số chủ thể bị ảnh hưởng, mức độ | Security + Bộ phận bảo vệ DLCN |
| 3. Thông báo | Lập hồ sơ và **thông báo A05 trong vòng 72 giờ**; thông báo chủ thể nếu cần | Bộ phận bảo vệ DLCN + Pháp chế |
| 4. Khắc phục | Cô lập, vá lỗ hổng, xoay vòng secret, khôi phục từ backup nếu cần | DevOps/Backend |
| 5. Lưu hồ sơ | Lưu toàn bộ bằng chứng, timeline, biện pháp; phục vụ kiểm tra & rút kinh nghiệm | Bộ phận bảo vệ DLCN |

> Liên kết runbook sự cố kỹ thuật: [BACKEND-14](<../BACKEND/BACKEND-14_Backend_Release_Readiness.md>) (incident runbook) và [DEVOPS-01](<../DEVOPS/DEVOPS-01_Infrastructure_Backup_Deployment.md>).

---

## 14. PHẦN B — Chính sách Backup & Disaster Recovery (DR)

### 14.1 Mục tiêu RPO/RTO theo lớp dữ liệu

> **✅ Quyết định chính sách (TRẢ LỜI BE14-OQ-006 — "Backup/restore RPO/RTO mục tiêu là bao nhiêu?"):** Bảng dưới đề xuất mục tiêu RPO/RTO. **RPO** (Recovery Point Objective) = lượng dữ liệu tối đa chấp nhận mất (đo bằng thời gian). **RTO** (Recovery Time Objective) = thời gian tối đa để khôi phục dịch vụ. **Đây là đề xuất, cần Product/DevOps phê duyệt** (đóng BE14-OQ-006 khi được duyệt).

| Lớp dữ liệu | RPO mục tiêu | RTO mục tiêu | Cơ chế đạt được |
| --- | --- | --- | --- |
| **DB giao dịch** (PostgreSQL — dữ liệu nghiệp vụ chính) | **≤ 15 phút** | **≤ 4 giờ** | Full backup hằng ngày + **WAL archiving / PITR** (Point-In-Time Recovery) |
| **File / Object storage** (file đính kèm, hợp đồng, ảnh) | ≤ 24 giờ | ≤ 4 giờ | Backup/replication định kỳ của object storage |
| **Cấu hình / Secrets / Hạ tầng** | Theo thay đổi (versioned) | ≤ 2 giờ | IaC + secret manager có versioning |
| **Audit log** | ≤ 15 phút (cùng DB) | ≤ 4 giờ | Đi cùng backup DB; cân nhắc archive bất biến |

> RTO production tổng thể đề xuất **≤ 4 giờ**. Con số cụ thể phụ thuộc hạ tầng tại DEVOPS-01.

### 14.2 Chiến lược backup

| Hạng mục | Chính sách đề xuất |
| --- | --- |
| Tần suất | **Full backup hằng ngày** + **WAL archiving liên tục** (cho PITR) |
| Mã hóa | Backup phải **được mã hóa** (at-rest), khóa quản lý qua secret manager |
| Vị trí lưu | Lưu **offsite / khác vùng** (different region/AZ) để chịu được mất một vùng |
| Retention backup | **Daily: 14 ngày · Weekly: 8 tuần · Monthly: 12 tháng** (đề xuất) |
| Bảo vệ DLCN | Backup chứa DLCN → áp dụng kiểm soát truy cập & mã hóa **tương đương** dữ liệu gốc |

### 14.3 Kịch bản thảm họa & runbook khôi phục

| Kịch bản | Tác động | Hướng khôi phục (tóm tắt) |
| --- | --- | --- |
| **Mất 1 instance** (app/worker) | Gián đoạn cục bộ | Tự động thay thế/scale; không cần restore dữ liệu |
| **Hỏng DB** (corruption/mất dữ liệu logic) | Mất/sai dữ liệu nghiệp vụ | Restore từ full backup + **PITR tới thời điểm trước sự cố** (đạt RPO ≤ 15 phút) |
| **Mất toàn vùng** (region/AZ down) | Mất hạ tầng vùng chính | Khôi phục tại vùng dự phòng từ backup offsite; chuyển traffic; đạt RTO ≤ 4 giờ |

> Các **bước restore chi tiết, lệnh và automation** (script, IaC, failover) nằm ở [DEVOPS-01](<../DEVOPS/DEVOPS-01_Infrastructure_Backup_Deployment.md>). Tài liệu COMPLIANCE-01 chỉ định nghĩa **mục tiêu và kịch bản chính sách**.

### 14.4 Restore drill (diễn tập khôi phục)

- **Tần suất:** diễn tập khôi phục **hằng quý** (tối thiểu).
- **Phạm vi:** restore DB từ backup + PITR vào môi trường cô lập; kiểm tra tính toàn vẹn dữ liệu.
- **Tiêu chí pass:**
  - Restore hoàn tất **trong RTO mục tiêu** (≤ 4 giờ).
  - Dữ liệu khôi phục **không mất quá RPO** (≤ 15 phút cho DB giao dịch).
  - Kiểm tra toàn vẹn (row count, checksum, smoke test nghiệp vụ) **đạt**.
  - Ghi lại kết quả drill làm bằng chứng tuân thủ.

---

## 15. Vai trò & trách nhiệm

| Vai trò | Trách nhiệm chính |
| --- | --- |
| **Bên Kiểm soát DLCN** (doanh nghiệp) | Quyết định mục đích & phương tiện xử lý; chịu trách nhiệm tuân thủ tổng thể, lập DPIA, thông báo vi phạm |
| **Bên Xử lý DLCN** (vendor/cloud) | Xử lý dữ liệu thay mặt Bên Kiểm soát theo hợp đồng; bảo đảm biện pháp bảo vệ tương đương |
| **Bộ phận/cá nhân chuyên trách bảo vệ DLCN** | NĐ 13/2023 yêu cầu **chỉ định** đầu mối; điều phối tuân thủ, tiếp nhận yêu cầu quyền chủ thể, xử lý vi phạm (CMP-OQ-002) |
| **Đội Backend/Dev** | Hiện thực RBAC, mã hóa, audit (gồm audit xem dữ liệu nhạy cảm), consent, retention |
| **Đội DevOps** | Backup/DR, mã hóa hạ tầng, TLS, region hosting, restore drill (DEVOPS-01) |
| **HR** | Thu thập đồng ý, thông báo xử lý, xử lý yêu cầu chủ thể, lưu trữ hồ sơ đúng thời hạn |

---

## 16. Checklist tuân thủ trước go-live

- [ ] Đã hoàn thành **Data Inventory/Mapping** (Mục 5) cho toàn bộ DLCN.
- [ ] Đã lập **Hồ sơ DPIA** và lưu giữ (Mục 9).
- [ ] Đã xác định region hosting và (nếu ngoài VN) hoàn tất **hồ sơ chuyển dữ liệu ra nước ngoài** (Mục 10).
- [ ] **Audit log cho thao tác XEM dữ liệu nhạy cảm** đã bật và kiểm thử (Mục 11.2).
- [ ] Mã hóa in-transit (TLS) bật toàn hệ thống; quyết định field-level encryption (Mục 11.1).
- [ ] **Chính sách retention** được cấu hình qua `data_retention_policies` (Mục 12).
- [ ] Cơ chế **consent & quyền chủ thể** tối thiểu đã có hoặc có lộ trình (Mục 7, 8).
- [ ] **Quy trình thông báo vi phạm 72h** đã ban hành (Mục 13).
- [ ] **Backup mã hóa + offsite** đã chạy; **restore drill** đã pass ít nhất 1 lần (Mục 14).
- [ ] Mục tiêu **RPO/RTO** được Product/DevOps **phê duyệt** (đóng BE14-OQ-006).
- [ ] Đã **chỉ định bộ phận/cá nhân bảo vệ DLCN** (Mục 15).
- [ ] **Pháp chế/luật sư đã rà soát** khung tuân thủ trước go-live (Disclaimer Mục 2).

---

## 17. Câu hỏi mở

| ID | Câu hỏi | Phụ trách | Trạng thái |
| --- | --- | --- | --- |
| CMP-OQ-001 | Hosting đặt **trong nước hay ngoài nước**? (quyết định nghĩa vụ chuyển dữ liệu ra nước ngoài — Mục 10) | Product/DevOps | Open |
| CMP-OQ-002 | Đã **chỉ định bộ phận/cá nhân chuyên trách bảo vệ DLCN** chưa? | Product/Pháp chế | Open |
| CMP-OQ-003 | Có triển khai **field-level encryption** cho lương/CCCD/số tài khoản **ngay ở MVP** không? | Backend/Security | Open |
| CMP-OQ-004 | **Thời hạn lưu trữ cụ thể** từng loại dữ liệu theo chính sách công ty (Mục 12) là bao nhiêu? | Product/HR/Pháp chế | Open |
| CMP-OQ-005 | Mục tiêu **RPO/RTO** đề xuất (Mục 14.1) có được Product/DevOps duyệt không? (gắn BE14-OQ-006) | Product/DevOps | Open |

---

## 18. Tài liệu liên quan

| Mã | Tên | Liên kết | Quan hệ |
| --- | --- | --- | --- |
| README | Chỉ mục tài liệu | [README](<../README.md>) | Điều hướng tổng |
| PRD-00 | Product Requirements Document | [PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) | Định hướng sản phẩm |
| SPEC-01 | Tổng quan hệ thống | [SPEC-01](<../SPEC/SPEC-01 Tổng quan.md>) | Dữ liệu nhạy cảm §11.3, audit §16.3, câu hỏi §29 #15 |
| DB-08 | Audit, Files, Settings, Seeds | [DB-08](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) | audit_logs, file_access_logs, data_retention_policies, soft delete |
| BACKEND-13 | Testing, Security & Performance | [BACKEND-13](<../BACKEND/BACKEND-13_Backend_Testing_Security_Performance.md>) | Bảo mật & hardening |
| BACKEND-14 | Backend Release Readiness | [BACKEND-14](<../BACKEND/BACKEND-14_Backend_Release_Readiness.md>) | Open question BE14-OQ-006 (RPO/RTO) |
| DEVOPS-01 | Infrastructure, Backup & Deployment | [DEVOPS-01](<../DEVOPS/DEVOPS-01_Infrastructure_Backup_Deployment.md>) | **Tài liệu song hành** — cơ chế thực thi backup/DR & hosting |

> **Lưu ý cross-reference:** [DEVOPS-01](<../DEVOPS/DEVOPS-01_Infrastructure_Backup_Deployment.md>) là **tài liệu song hành đang được tạo**; COMPLIANCE-01 định nghĩa chính sách & mục tiêu, DEVOPS-01 định nghĩa cơ chế kỹ thuật để đạt mục tiêu đó. Hai tài liệu phải nhất quán về con số RPO/RTO, lịch backup và region hosting.
