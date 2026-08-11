import { describe, expect, it } from "vitest";
import { applyRules, countHits, usableRules } from "./bulk-edit";

/**
 * Bo may thay chuoi hang loat.
 *
 * Cac bai o day gac dung nhung cho de lam hong ca kho noi dung mot luc: ky tu dac biet bi hieu
 * thanh cu phap, cap thay the xep tang len nhau, va so lan thay bao sai so voi so lan that.
 */

describe("applyRules", () => {
  it("thay moi lan xuat hien, dem dung so lan", () => {
    const result = applyRules(
      "Hotline 0909 · đặt hàng 0909 · zalo 0909",
      [{ find: "0909", replace: "0388" }],
      false,
    );

    expect(result.text).toBe("Hotline 0388 · đặt hàng 0388 · zalo 0388");
    expect(result.hits).toBe(3);
  });

  it("khong doi gi thi hits = 0 va van ban giu nguyen tham chieu noi dung", () => {
    const result = applyRules("Bài viết bình thường", [{ find: "xyz", replace: "abc" }], false);

    expect(result.text).toBe("Bài viết bình thường");
    expect(result.hits).toBe(0);
  });

  it("coi chuoi tim la VAN BAN THUAN, khong phai bieu thuc chinh quy", () => {
    const result = applyRules(
      "Giá chỉ 100.000đ (giảm 20%) [hot]",
      [
        { find: "(giảm 20%)", replace: "(giảm 30%)" },
        { find: "[hot]", replace: "[mới]" },
      ],
      false,
    );

    expect(result.text).toBe("Giá chỉ 100.000đ (giảm 30%) [mới]");
    expect(result.hits).toBe(2);
  });

  it("chuoi thay the chua $ va $& duoc chen NGUYEN VAN", () => {
    const result = applyRules(
      "Giá: GIA_CU",
      [{ find: "GIA_CU", replace: "$100 ($& giữ nguyên)" }],
      false,
    );

    expect(result.text).toBe("Giá: $100 ($& giữ nguyên)");
  });

  it("khong xep tang: cap sau khong an lai ket qua cua cap truoc", () => {
    const result = applyRules(
      "A và B",
      [
        { find: "A", replace: "B" },
        { find: "B", replace: "C" },
      ],
      false,
    );

    // Neu thay lan luot tung cap thi "A" se thanh "B" roi thanh "C" - sai.
    expect(result.text).toBe("B và C");
    expect(result.hits).toBe(2);
  });

  it("doi cho hai chuoi cho nhau trong mot luot", () => {
    const result = applyRules(
      "sáng: Page A, chiều: Page B",
      [
        { find: "Page A", replace: "Page B" },
        { find: "Page B", replace: "Page A" },
      ],
      true,
    );

    expect(result.text).toBe("sáng: Page B, chiều: Page A");
  });

  it("trung vi tri thi chuoi tim DAI HON thang, khong ke thu tu go vao", () => {
    const result = applyRules(
      "Giao hàng Hà Nội trong ngày",
      [
        { find: "Hà", replace: "HÀ" },
        { find: "Hà Nội", replace: "TP.HCM" },
      ],
      true,
    );

    expect(result.text).toBe("Giao hàng TP.HCM trong ngày");
    expect(result.hits).toBe(1);
  });

  it("mac dinh khong phan biet hoa thuong, phan khong bi thay giu nguyen kieu chu", () => {
    const result = applyRules(
      "HOTLINE gọi hotline ngay",
      [{ find: "Hotline", replace: "Tổng đài" }],
      false,
    );

    expect(result.text).toBe("Tổng đài gọi Tổng đài ngay");
    expect(result.hits).toBe(2);
  });

  it("bat phan biet hoa thuong thi chi khop dung kieu chu da go", () => {
    const result = applyRules(
      "HOTLINE gọi hotline ngay",
      [{ find: "hotline", replace: "tổng đài" }],
      true,
    );

    expect(result.text).toBe("HOTLINE gọi tổng đài ngay");
    expect(result.hits).toBe(1);
  });

  it("chuoi tim rong bi bo qua - khong lam treo va khong chen bua bai", () => {
    const result = applyRules(
      "nội dung",
      [
        { find: "", replace: "XXX" },
        { find: "dung", replace: "dụng" },
      ],
      false,
    );

    expect(result.text).toBe("nội dụng");
    expect(result.hits).toBe(1);
  });

  it("thay bang chuoi rong = xoa doan do", () => {
    const result = applyRules(
      "Bài hay #quangcao #sale",
      [{ find: " #quangcao", replace: "" }],
      false,
    );

    expect(result.text).toBe("Bài hay #sale");
  });

  it("giu nguyen xuong dong va emoji quanh doan bi thay", () => {
    const result = applyRules(
      "Dòng 1 🎉\nLIÊN HỆ: cũ\nDòng 3",
      [{ find: "cũ", replace: "mới" }],
      false,
    );

    expect(result.text).toBe("Dòng 1 🎉\nLIÊN HỆ: mới\nDòng 3");
  });

  it("van ban rong hoac khong co cap nao thi tra ve nguyen trang", () => {
    expect(applyRules("", [{ find: "a", replace: "b" }], false)).toEqual({ text: "", hits: 0 });
    expect(applyRules("giữ nguyên", [], false)).toEqual({ text: "giữ nguyên", hits: 0 });
  });
});

describe("countHits", () => {
  it("dem dung so lan ma khong doi van ban", () => {
    const text = "sale sale SALE";
    expect(countHits(text, [{ find: "sale", replace: "giảm giá" }], false)).toBe(3);
    expect(countHits(text, [{ find: "sale", replace: "giảm giá" }], true)).toBe(2);
    expect(text).toBe("sale sale SALE");
  });
});

describe("usableRules", () => {
  it("loai cap co chuoi tim rong, giu cap co chuoi thay the rong", () => {
    expect(
      usableRules([
        { find: "", replace: "x" },
        { find: "a", replace: "" },
      ]),
    ).toEqual([{ find: "a", replace: "" }]);
  });
});
