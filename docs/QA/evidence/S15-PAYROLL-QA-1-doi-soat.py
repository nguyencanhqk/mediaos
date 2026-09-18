"""S15-PAYROLL-QA-1 (lane D, G10) — bảng đối soát TAY, số học CHÍNH XÁC (fractions.Fraction). KHÔNG import
engine TS — cùng kiến trúc với `S15-PAYROLL-BE-3-doi-soat.py` (đọc file đó trước, quy ước giống hệt).

Chạy: `python docs/QA/evidence/S15-PAYROLL-QA-1-doi-soat.py`

Bổ sung NV-L — nhân sự GROSS bậc thuế THẤP (thu nhập chịu thuế ∈ (0, 10.000.000]) đủ mọi khoản kể cả
ĐIỀU CHỈNH TAY (SPEC-11 §21.1 mục 1 liệt kê "điều chỉnh tay" nhưng NV-G của BE-3 không có khoản này —
G10 lấp lỗ đó bằng nhân sự MỚI thay vì sửa NV-G đang được BE-3 ghim). `present`/`unpaid` cố ý để NGUYÊN
(20/2 ngày) để LUONG_CO_BAN = base ĐÚNG BẰNG (P+U=W), tránh làm nhiễu phép chia — độ "lẻ" nằm ở
base/PHU_CAP/THUONG/PHAT/TAM_UNG/điều chỉnh (giữ đúng tinh thần §13.6 F, không cần lẻ NGÀY CÔNG).
`adjustment` áp SAU khi trừ khấu trừ: `net = MAX(gross − deduction + adjustment, 0)` (mirror SQL, không
phải phép tính JS — xem `payroll-be2-lifecycle.int-spec.ts` ca B1).
"""
from decimal import Decimal
from fractions import Fraction as F

RATE = dict(
    TL_BHXH_NV=F("8.00"), TL_BHYT_NV=F("1.50"), TL_BHTN_NV=F("1.00"),
    TL_BHXH_DN=F("17.50"), TL_BHYT_DN=F("3.00"), TL_BHTN_DN=F("1.00"),
    TL_KPCD=F("2.00"), TL_DOAN_PHI=F("1.00"),
    GT_BAN_THAN=F(11_000_000), GT_NPT=F(4_400_000),
)
CAP = dict(BHXH=F(46_800_000), BHYT=F(46_800_000), BHTN=F(99_200_000))
BRACKETS = [(5_000_000, 5), (10_000_000, 10), (18_000_000, 15), (32_000_000, 20),
            (52_000_000, 25), (80_000_000, 30), (None, 35)]
SI_RATES = ("TL_BHXH_NV", "TL_BHYT_NV", "TL_BHTN_NV", "TL_BHXH_DN", "TL_BHYT_DN", "TL_BHTN_DN", "TL_KPCD")


def r2(x: F) -> F:
    """Làm tròn phân số về bội 1/100, nửa → xa 0 (khớp decimal.js ROUND_HALF_UP)."""
    sign = -1 if x < 0 else 1
    ax = abs(x) * 100
    q, rem = divmod(ax.numerator, ax.denominator)
    if 2 * rem >= ax.denominator:
        q += 1
    return F(sign * q, 100)


def s(x: F) -> str:
    return format(Decimal(x.numerator) / Decimal(x.denominator), ".2f")


def pit(x: F) -> F:
    if x <= 0:
        return F(0)
    tax, lower = F(0), F(0)
    for up, rate in BRACKETS:
        top = x if up is None or x < up else F(up)
        if top > lower:
            tax += (top - lower) * rate / 100
        if up is None or x <= up:
            break
        lower = F(up)
    return tax


def rates_for(si: bool, union: bool) -> dict:
    r = dict(RATE)
    if not si:
        for k in SI_RATES:
            r[k] = F(0)
    if not union:
        r["TL_DOAN_PHI"] = F(0)
    return r


def evaluate(sys: dict, items: dict, si: bool, union: bool, pit_payer: str) -> dict:
    R = rates_for(si, union)
    B, RA, W = sys["BASE"], sys["RATIO"], sys["WORK"]
    P, U, INS = sys["PRESENT"], sys["UNPAID"], sys["INS"]
    v = {}
    v["LUONG_CO_BAN"] = r2(min(B * (P + U) / W, B) * RA / 100)
    v["PHU_CAP"] = r2(items.get("PHU_CAP", F(0)))
    v["THUONG"] = r2(sys["BONUS"])
    v["NGHI_KHONG_LUONG"] = r2(-(B * RA / 100 * U / W))
    v["PHAT"] = r2(sys["PENALTY"])
    v["TAM_UNG"] = r2(sys["ADVANCE"])
    v["TONG_THU_NHAP"] = r2(v["LUONG_CO_BAN"] + v["PHU_CAP"] + v["THUONG"] + v["NGHI_KHONG_LUONG"])
    v["BHXH_NV"] = r2(min(INS, CAP["BHXH"]) * R["TL_BHXH_NV"] / 100)
    v["BHYT_NV"] = r2(min(INS, CAP["BHYT"]) * R["TL_BHYT_NV"] / 100)
    v["BHTN_NV"] = r2(min(INS, CAP["BHTN"]) * R["TL_BHTN_NV"] / 100)
    v["DOAN_PHI"] = r2(min(INS, CAP["BHXH"]) * R["TL_DOAN_PHI"] / 100)
    v["TONG_BH_NV"] = r2(v["BHXH_NV"] + v["BHYT_NV"] + v["BHTN_NV"])
    v["THU_NHAP_CHIU_THUE"] = r2(max(v["TONG_THU_NHAP"] - v["TONG_BH_NV"] - R["GT_BAN_THAN"]
                                     - R["GT_NPT"] * sys["DEPS"], F(0)))
    v["TNCN"] = r2(pit(v["THU_NHAP_CHIU_THUE"]))
    ded = v["PHAT"] + v["TAM_UNG"] + v["BHXH_NV"] + v["BHYT_NV"] + v["BHTN_NV"] + v["DOAN_PHI"]
    if pit_payer == "EMPLOYEE":
        ded += v["TNCN"]
    v["TONG_KHAU_TRU"] = r2(ded)
    v["BHXH_DN"] = r2(min(INS, CAP["BHXH"]) * R["TL_BHXH_DN"] / 100)
    v["BHYT_DN"] = r2(min(INS, CAP["BHYT"]) * R["TL_BHYT_DN"] / 100)
    v["BHTN_DN"] = r2(min(INS, CAP["BHTN"]) * R["TL_BHTN_DN"] / 100)
    v["KPCD"] = r2(min(INS, CAP["BHXH"]) * R["TL_KPCD"] / 100)
    return v


if __name__ == "__main__":
    base = F("21345678.95")
    work, present, unpaid = F(22), F(20), F(2)
    sys = dict(BASE=base, INS=base, RATIO=F(100), WORK=work, PRESENT=present, UNPAID=unpaid,
               BONUS=F("111111.15"), PENALTY=F("22222.25"), ADVANCE=F("50000"), DEPS=F(1))
    items = {"PHU_CAP": F("234567.85")}
    v = evaluate(sys, items, True, True, "EMPLOYEE")
    print("== NV-L — GROSS bậc thấp, đủ khoản + điều chỉnh tay ==")
    for code, x in v.items():
        print(f"  {code:20} {s(x):>16}")
    gross, ded = v["TONG_THU_NHAP"], v["TONG_KHAU_TRU"]
    adj = F("-12345.67")
    net_before_adj = gross - ded
    net_after_adj = max(net_before_adj + adj, F(0))
    print(f"  {'gross':20} {s(gross):>16}")
    print(f"  {'deductionAmount':20} {s(ded):>16}")
    print(f"  {'net (trước điều chỉnh)':20} {s(net_before_adj):>16}")
    print(f"  {'adjustmentAmount':20} {s(adj):>16}")
    print(f"  {'net (sau điều chỉnh)':20} {s(net_after_adj):>16}")
    assert 0 < v["THU_NHAP_CHIU_THUE"] <= 10_000_000, "NV-L phải ở bậc thuế THẤP (chịu thuế ∈ (0, 10tr])"
