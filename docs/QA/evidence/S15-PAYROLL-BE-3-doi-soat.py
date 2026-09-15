"""S15-PAYROLL-BE-3 — bảng đối soát TAY, số học CHÍNH XÁC (fractions.Fraction). KHÔNG import engine TS.

Chạy: `PYTHONIOENCODING=utf-8 python docs/QA/evidence/S15-PAYROLL-BE-3-doi-soat.py`

Quy ước (plan `docs/plans/S15-PAYROLL-BE-3.md` §0 · SPEC-11 §13.6 F):
- mỗi thành phần tính CHÍNH XÁC rồi làm tròn HALF-UP (nửa → xa 0) về 2 chữ số NGAY khi ghi;
- mẫu = `MAU_MAC_DINH` seedVersion v4 (`NGHI_KHONG_LUONG` là `earning` ÂM — O-5);
- không tham gia BH ⇒ 7 tỉ lệ BH/KPCĐ = 0; không đoàn viên ⇒ đoàn phí = 0 (O-2);
- NET: lặp trên «công đủ» (present = work, nghỉ/trễ/thưởng/phạt/tạm ứng = 0, tỉ lệ hưởng 100),
  căn cứ BH fallback = b; lượt cuối chạy đầu vào thật với b* (O-4).
Số tỉ lệ/bậc = bản seed `payroll-master-data.seeder.ts` (owner xác nhận 02/09/2026) — ghim SỐ SEED, không «đúng luật».
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


def insurance_base(p: dict, base: F) -> F:
    return F(p.get("probation") or p.get("insurance") or base)


def sys_real(p: dict, base: F) -> dict:
    return dict(BASE=base, INS=insurance_base(p, base), RATIO=F(p.get("ratio", 100)), WORK=F(p["work"]),
                PRESENT=F(p["present"]), UNPAID=F(p["unpaid"]), BONUS=F(p.get("bonus", 0)),
                PENALTY=F(p.get("penalty", 0)), ADVANCE=F(p.get("advance", 0)), DEPS=F(p.get("deps", 0)))


def sys_full(p: dict, b: F) -> dict:
    return dict(BASE=b, INS=insurance_base(p, b), RATIO=F(100), WORK=F(p["work"]), PRESENT=F(p["work"]),
                UNPAID=F(0), BONUS=F(0), PENALTY=F(0), ADVANCE=F(0), DEPS=F(p.get("deps", 0)))


def line(name: str, p: dict) -> None:
    items = {k: F(v) for k, v in p.get("items", {}).items()}
    iterations, target, base = None, None, F(p["base"])
    trace = []
    if p["type"] == "NET":
        target = F(p["base"])
        b = target
        for k in range(1, 31):
            vv = evaluate(sys_full(p, b), items, p["si"], p["union"], p["pit"])
            f = vv["TONG_THU_NHAP"] - vv["TONG_KHAU_TRU"]
            trace.append((k, b, f, target - f))
            if abs(target - f) <= 1:
                iterations = k
                break
            b = b + (target - f)
        else:
            raise SystemExit(f"{name}: KHÔNG hội tụ sau 30 vòng")
        base = b
    v = evaluate(sys_real(p, base), items, p["si"], p["union"], p["pit"])
    net = max(v["TONG_THU_NHAP"] - v["TONG_KHAU_TRU"], F(0))
    print(f"\n== {name} ({p['type']}, pit={p['pit']}, BH={p['si']}, công đoàn={p['union']}) ==")
    for k, b, f, d in trace:
        print(f"  vòng {k:2}: b={s(b):>14}  F(b)={s(f):>14}  N−F={s(d):>12}")
    if iterations is not None:
        print(f"  ⇒ N={s(target)} · b*={s(base)} · iterations={iterations}")
    for code, x in v.items():
        print(f"  {code:20} {s(x):>16}")
    print(f"  {'net (clamp ở SQL)':20} {s(net):>16}")


if __name__ == "__main__":
    line("A1 — payroll-be2-lifecycle viết lại v2", dict(
        type="GROSS", base="22000000.00", work=22, present=18, unpaid=2,
        items={"PHU_CAP": "1000000"}, si=False, union=False, pit="EMPLOYEE"))
    line("NV-G — GROSS đủ khoản · BH vượt trần · 2 NPT · TNCN bậc 4", dict(
        type="GROSS", base="45999999.99", work=22, present="19.5", unpaid="1.5",
        items={"PHU_CAP": "1005000"}, bonus="2385000", penalty="300000", advance="1000000",
        insurance="50000000", deps=2, si=True, union=True, pit="EMPLOYEE"))
    line("NV-N — NET đủ khoản · 1 NPT · BH fallback b", dict(
        type="NET", base="25000000.00", work=22, present=20, unpaid=2,
        items={"PHU_CAP": "500000"}, bonus="1000000", deps=1, si=True, union=False, pit="EMPLOYEE"))
    line("NV-N nửa tháng — b* PHẢI bằng NV-N (gross-up độc lập ngày công)", dict(
        type="NET", base="25000000.00", work=22, present=11, unpaid=0,
        items={"PHU_CAP": "500000"}, deps=1, si=True, union=False, pit="EMPLOYEE"))
