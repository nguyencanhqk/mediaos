# S15-PAYROLL-BE-3 — Bảng đối soát TAY (khớp từng đồng)

> Nguồn: `S15-PAYROLL-BE-3-doi-soat.py` (cùng thư mục) — số học **chính xác** bằng `fractions.Fraction`,
> **không** import engine TS. Int-spec/unit-spec của BE-3 so **chuỗi** với các số dưới đây; lệch 1 đồng là ĐỎ.
> Quy ước làm tròn, tham gia BH, gross-up: plan `docs/plans/S15-PAYROLL-BE-3.md` §0 (O-2 · O-4 · O-5).
> Số tỉ lệ/bậc = bản seed (owner xác nhận 02/09/2026): NV 8 / 1,5 / 1 · DN 17,5 / 3 / 1 · KPCĐ 2 · đoàn phí 1 ·
> trần BHXH/BHYT 46.800.000 · trần BHTN 99.200.000 · giảm trừ 11.000.000 + 4.400.000/NPT · 7 bậc 5–35%.
> Hệ thống **lưu và áp** các số này, không khẳng định đúng luật (SPEC-11 §3.11).

## A1 — ca «khớp từng đồng» của `payroll-be2-lifecycle`, viết lại theo v2

Đầu vào: GROSS · base 22.000.000 · work 22 · present 18 · unpaid 2 · `PHU_CAP` 1.000.000 · không BH · 0 NPT · NV chịu thuế.

| Thành phần | Giá trị |
| --- | ---: |
| LUONG_CO_BAN = MIN(22.000.000 × 20/22, 22.000.000) | 20.000.000,00 |
| PHU_CAP | 1.000.000,00 |
| NGHI_KHONG_LUONG = −(22.000.000 × 2/22) | −2.000.000,00 |
| **TONG_THU_NHAP** | **19.000.000,00** |
| TONG_BH_NV (không tham gia ⇒ tỉ lệ 0) | 0,00 |
| THU_NHAP_CHIU_THUE = 19.000.000 − 11.000.000 | 8.000.000,00 |
| TNCN = 5.000.000 × 5% + 3.000.000 × 10% | 550.000,00 |
| **TONG_KHAU_TRU** | **550.000,00** |
| **net** | **18.450.000,00** |

> Trước vá O-5 (`NGHI_KHONG_LUONG` là `deduction`): TONG_THU_NHAP 21.000.000 ⇒ chịu thuế 10.000.000 ⇒ TNCN **750.000**
> ⇒ net 18.250.000 — thu thừa **200.000** thuế trên tiền nghỉ không lương mà NV không nhận.

## NV-G — GROSS đủ mọi khoản

Đầu vào: base 45.999.999,99 · work 22 · present 19,5 · unpaid 1,5 · `PHU_CAP` 1.005.000 · thưởng 2.385.000 · phạt 300.000 ·
tạm ứng 1.000.000 · tham gia BH + công đoàn · `insurance_salary` 50.000.000 (**vượt trần BHXH/BHYT**) · 2 NPT · NV chịu thuế.

| Thành phần | Giá trị |
| --- | ---: |
| LUONG_CO_BAN | 43.909.090,90 |
| PHU_CAP | 1.005.000,00 |
| THUONG | 2.385.000,00 |
| NGHI_KHONG_LUONG | −3.136.363,64 |
| PHAT | 300.000,00 |
| TAM_UNG | 1.000.000,00 |
| **TONG_THU_NHAP** | **44.162.727,26** |
| BHXH_NV = 46.800.000 × 8% | 3.744.000,00 |
| BHYT_NV = 46.800.000 × 1,5% | 702.000,00 |
| BHTN_NV = 50.000.000 × 1% | 500.000,00 |
| DOAN_PHI = 46.800.000 × 1% | 468.000,00 |
| TONG_BH_NV (không gồm đoàn phí) | 4.946.000,00 |
| THU_NHAP_CHIU_THUE = 44.162.727,26 − 4.946.000 − 11.000.000 − 8.800.000 | 19.416.727,26 |
| TNCN (bậc 4: 250.000 + 500.000 + 1.200.000 + 1.416.727,26 × 20%) | 2.233.345,45 |
| **TONG_KHAU_TRU** = 300.000 + 1.000.000 + 4.946.000 + 468.000 + 2.233.345,45 | **8.947.345,45** |
| BHXH_DN · BHYT_DN · BHTN_DN · KPCD (không vào net) | 8.190.000,00 · 1.404.000,00 · 500.000,00 · 936.000,00 |
| **net** | **35.215.381,81** |

## NV-N — NET đủ khoản

Đầu vào: NET mục tiêu N = 25.000.000 · work 22 · present 20 · unpaid 2 · `PHU_CAP` 500.000 · thưởng 1.000.000 · tham gia BH,
không công đoàn · `insurance_salary` NULL (⇒ căn cứ BH = b) · 1 NPT · NV chịu thuế.

Gross-up (vòng lặp «công đủ», thưởng = 0):

| Vòng | b | F(b) | N − F |
| ---: | ---: | ---: | ---: |
| 1 | 25.000.000,00 | 22.377.500,00 | 2.622.500,00 |
| 2 | 27.622.500,00 | 24.489.923,75 | 510.076,25 |
| 3 | 28.132.576,25 | 24.886.857,39 | 113.142,61 |
| 4 | 28.245.718,86 | 24.972.930,62 | 27.069,38 |
| 5 | 28.272.788,24 | 24.993.523,66 | 6.476,34 |
| 6 | 28.279.264,58 | 24.998.450,52 | 1.549,48 |
| 7 | 28.280.814,06 | 24.999.629,30 | 370,70 |
| 8 | 28.281.184,76 | 24.999.911,31 | 88,69 |
| 9 | 28.281.273,45 | 24.999.978,78 | 21,22 |
| 10 | 28.281.294,67 | 24.999.994,92 | 5,08 |
| 11 | 28.281.299,75 | 24.999.998,78 | 1,22 |
| 12 | 28.281.300,97 | 24.999.999,71 | 0,29 ⇒ dừng |

⇒ **b\* = 28.281.300,97 · `gross_up_iterations` = 12**. Lượt cuối (đầu vào thật):

| Thành phần | Giá trị |
| --- | ---: |
| LUONG_CO_BAN | 28.281.300,97 |
| PHU_CAP | 500.000,00 |
| THUONG | 1.000.000,00 |
| NGHI_KHONG_LUONG | −2.571.027,36 |
| **TONG_THU_NHAP** | **27.210.273,61** |
| BHXH_NV · BHYT_NV · BHTN_NV | 2.262.504,08 · 424.219,51 · 282.813,01 |
| DOAN_PHI (không đoàn viên) | 0,00 |
| THU_NHAP_CHIU_THUE | 8.840.737,01 |
| TNCN | 634.073,70 |
| **TONG_KHAU_TRU** | **3.603.610,30** |
| BHXH_DN · BHYT_DN · BHTN_DN · KPCD | 4.949.227,67 · 848.439,03 · 282.813,01 · 565.626,02 |
| **net** | **23.606.663,31** |

## NV-N nửa tháng — ca chống «đi làm nửa tháng vẫn lĩnh đủ NET» (SPEC-11 §13.8)

Như NV-N nhưng present 11 · unpaid 0 · không thưởng ⇒ **b\* = 28.281.300,97, iterations = 12 (BẰNG NV-N)** · LUONG_CO_BAN
14.140.650,49 · TONG_THU_NHAP 14.640.650,49 · BH NV 2.969.536,60 · TNCN 0,00 · **net 11.671.113,89**.
Đột biến «gross-up trên đầu vào thật» sẽ kéo `b*` lên để net ≈ 25.000.000 ⇒ ca này ĐỎ.
