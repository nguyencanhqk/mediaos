/**
 * Server SMTP GIẢ trong tiến trình (node:net, 127.0.0.1, cổng ngẫu nhiên) — S19-OPS-AUDITHIGH-1.
 *
 * VÌ SAO CÓ: trước WO này, MỌI spec gửi mail `vi.doMock("nodemailer")` toàn phần ⇒ 0 ca nào chạy thư
 * viện thật, nên nâng MAJOR nodemailer 9→10 không làm đỏ được test nào dù thư viện vỡ. Server này cho
 * nodemailer THẬT nói SMTP thật (EHLO · AUTH · MAIL · RCPT · DATA · QUIT) tới một đầu nhận ghi lại được,
 * để spec đo HÀNH VI qua dây thay vì đo mock.
 *
 * ⚠️ nodemailer chỉ đăng nhập khi EHLO quảng bá `AUTH` (`smtp-transport` — `connection.allowsAuth`);
 * server không quảng bá thì `verify()`/`sendMail()` vẫn THÀNH CÔNG mà không AUTH. Vì vậy mặc định server
 * quảng bá `AUTH PLAIN LOGIN`, và spec phải assert `auths` — `advertiseAuth:false` tồn tại để spec tự kiểm
 * rằng assert đó không xanh-rỗng.
 *
 * Cố ý KHÔNG quảng bá STARTTLS: service dùng `secure:false` không `requireTLS` ⇒ nodemailer chỉ nâng cấp
 * TLS khi server mời; TLS cần cert ⇒ đo riêng (docs/plans/S19-OPS-AUDITHIGH-1.md §5). Không thêm
 * devDependency (`smtp-server`) cho một đầu nhận cỡ này.
 */
import { createServer, type AddressInfo, type Socket } from "node:net";

/** Một lần AUTH mà server nhận được (đã giải base64). */
export interface FakeSmtpAuth {
  method: "PLAIN" | "LOGIN";
  username: string;
  password: string;
}

/** Một thư đã qua trọn DATA. `raw` = thân DATA nguyên văn (đã bỏ dot-stuffing). */
export interface FakeSmtpMessage {
  mailFrom: string;
  rcptTo: string[];
  raw: string;
}

export interface FakeSmtpServer {
  port: number;
  /**
   * Số kết nối TCP đã nhận (kể cả kết nối chưa kịp gửi lệnh nào) — để khẳng định "KHÔNG một kết nối" chặt hơn
   * `commands` rỗng (S19-SEC-MAILCREDEXFIL-1).
   */
  readonly connections: number;
  /** Mọi lệnh SMTP nhận được, theo thứ tự (dòng AUTH chỉ giữ "AUTH <METHOD>" — che credential). */
  commands: string[];
  auths: FakeSmtpAuth[];
  messages: FakeSmtpMessage[];
  close(): Promise<void>;
}

export interface FakeSmtpOptions {
  /** false ⇒ EHLO KHÔNG quảng bá AUTH (mặc định true). */
  advertiseAuth?: boolean;
  /** true ⇒ mọi AUTH trả 535. */
  rejectAuth?: boolean;
  /** true ⇒ mọi RCPT trả 550. */
  rejectRcpt?: boolean;
  /** true ⇒ thân DATA bị từ chối (550) sau dấu `.`. */
  rejectData?: boolean;
  /** true ⇒ cắt kết nối (destroy, không QUIT) ngay sau khi trả 354 cho DATA — mô phỏng rớt mạng giữa chừng. */
  dropAfterData?: boolean;
  /** Chuỗi nối vào MỌI phản hồi từ chối — mô phỏng server echo nội dung (vd. URL bị bộ lọc spam chặn). */
  echo?: string;
}

/** Nơi các phiên ghi lại những gì server thấy. */
interface FakeSmtpSinks {
  commands: string[];
  auths: FakeSmtpAuth[];
  messages: FakeSmtpMessage[];
}

const CRLF = "\r\n";

const fromB64 = (s: string): string => Buffer.from(s.trim(), "base64").toString("utf8");

/** Bỏ `<...>` quanh địa chỉ trong `MAIL FROM:<a>` / `RCPT TO:<b>` (kèm tham số ESMTP phía sau). */
const addressOf = (line: string): string =>
  line.replace(/^[^:]*:\s*/, "").replace(/^<([^>]*)>.*$/, "$1");

/** Một kết nối SMTP: máy trạng thái dòng-lệnh / AUTH nhiều lượt / thân DATA. */
class FakeSmtpSession {
  private buffer = "";
  private inData = false;
  private dataLines: string[] = [];
  private mailFrom = "";
  private rcptTo: string[] = [];
  /** Bước AUTH nhiều lượt đang chờ dòng base64 kế tiếp. */
  private authStep: null | "plain" | "login-user" | "login-pass" = null;
  private loginUser = "";

  constructor(
    private readonly socket: Socket,
    private readonly options: FakeSmtpOptions,
    private readonly sinks: FakeSmtpSinks,
  ) {
    socket.setEncoding("latin1");
    socket.on("data", (chunk: string) => this.onData(chunk));
    this.reply("220 fake.smtp.test ESMTP");
  }

  private reply(line: string): void {
    if (!this.socket.destroyed) this.socket.write(line + CRLF);
  }

  private reject(base: string): void {
    this.reply(this.options.echo ? `${base} ${this.options.echo}` : base);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf(CRLF);
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + CRLF.length);
      this.onLine(line);
      idx = this.buffer.indexOf(CRLF);
    }
  }

  private onLine(line: string): void {
    if (this.inData) this.onDataLine(line);
    else if (this.authStep) this.onAuthLine(line);
    else this.onCommand(line);
  }

  private onDataLine(line: string): void {
    if (line !== ".") {
      this.dataLines.push(line.startsWith("..") ? line.slice(1) : line);
      return;
    }
    this.inData = false;
    const raw = this.dataLines.join(CRLF);
    this.dataLines = [];
    if (this.options.rejectData) {
      this.reject("550 5.7.1 Message content rejected");
      return;
    }
    this.sinks.messages.push({ mailFrom: this.mailFrom, rcptTo: this.rcptTo, raw });
    this.reply("250 2.0.0 Ok: queued");
  }

  private onAuthLine(line: string): void {
    const step = this.authStep;
    this.authStep = null;
    if (step === "plain") {
      this.authPlain(line);
    } else if (step === "login-user") {
      this.loginUser = fromB64(line);
      this.authStep = "login-pass";
      this.reply("334 UGFzc3dvcmQ6");
    } else {
      this.finishAuth({ method: "LOGIN", username: this.loginUser, password: fromB64(line) });
    }
  }

  private authPlain(b64: string): void {
    // RFC 4616: authzid \0 authcid \0 passwd
    const [, username = "", password = ""] = fromB64(b64).split("\0");
    this.finishAuth({ method: "PLAIN", username, password });
  }

  private finishAuth(auth: FakeSmtpAuth): void {
    this.sinks.auths.push(auth);
    if (this.options.rejectAuth) this.reject("535 5.7.8 Authentication credentials invalid");
    else this.reply("235 2.7.0 Authentication successful");
  }

  private onAuthCommand(line: string): void {
    const [, method = "", initial] = line.split(" ");
    if (method.toUpperCase() === "PLAIN") {
      if (initial) this.authPlain(initial);
      else {
        this.authStep = "plain";
        this.reply("334 ");
      }
    } else if (method.toUpperCase() === "LOGIN") {
      this.authStep = "login-user";
      this.reply("334 VXNlcm5hbWU6");
    } else {
      this.reply("504 5.5.4 Unrecognized authentication type");
    }
  }

  private onCommand(line: string): void {
    const verb = (line.split(" ", 1)[0] ?? "").toUpperCase();
    // Che credential: dòng AUTH chỉ giữ "AUTH <METHOD>".
    this.sinks.commands.push(verb === "AUTH" ? line.split(" ").slice(0, 2).join(" ") : line);
    switch (verb) {
      case "EHLO":
        this.reply("250-fake.smtp.test");
        if (this.options.advertiseAuth ?? true) this.reply("250-AUTH PLAIN LOGIN");
        this.reply("250 8BITMIME");
        return;
      case "HELO":
        return this.reply("250 fake.smtp.test");
      case "AUTH":
        return this.onAuthCommand(line);
      case "MAIL":
        this.mailFrom = addressOf(line);
        this.rcptTo = [];
        return this.reply("250 2.1.0 Ok");
      case "RCPT":
        if (this.options.rejectRcpt) return this.reject("550 5.1.1 Recipient rejected");
        this.rcptTo.push(addressOf(line));
        return this.reply("250 2.1.5 Ok");
      case "DATA":
        this.inData = true;
        this.reply("354 End data with <CR><LF>.<CR><LF>");
        if (this.options.dropAfterData) this.socket.destroy();
        return;
      case "RSET":
      case "NOOP":
        return this.reply("250 2.0.0 Ok");
      case "QUIT":
        this.reply("221 2.0.0 Bye");
        this.socket.end();
        return;
      default:
        this.reply("502 5.5.2 Command not recognized");
    }
  }
}

export function startFakeSmtpServer(options: FakeSmtpOptions = {}): Promise<FakeSmtpServer> {
  const sinks: FakeSmtpSinks = { commands: [], auths: [], messages: [] };
  const sockets = new Set<Socket>();
  let connections = 0;

  const server = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // Client đóng giữa chừng (vd. nodemailer `close()` sau lỗi) — không phải lỗi của server giả. Lỗi phía
    // server vẫn lộ ra qua các assert dương (`auths`/`messages` thiếu).
    socket.on("error", () => undefined);
    new FakeSmtpSession(socket, options, sinks);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      // Sau khi listen xong, lỗi server KHÔNG được rơi vào promise đã settle (mất im lặng): gỡ `reject`
      // để một lỗi muộn thành `error` không ai nghe ⇒ ném ⇒ vitest ĐỎ.
      server.off("error", reject);
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        get connections() {
          return connections;
        },
        ...sinks,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Giải quoted-printable (bỏ soft line break `=\r\n`, `=XX` → byte) rồi đọc UTF-8. */
function decodeQuotedPrintable(body: string): string {
  const src = body.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < src.length; i += 1) {
    const hex = src.slice(i + 1, i + 3);
    if (src[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(src.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Socket đọc bằng `latin1` (1 ký tự = 1 byte) ⇒ thân 7bit/8bit phải đọc lại byte thành UTF-8. */
const latin1ToUtf8 = (s: string): string => Buffer.from(s, "latin1").toString("utf8");

/** Một phần MIME lá đã giải mã theo `Content-Transfer-Encoding` của nó. */
export interface DecodedMimePart {
  contentType: string;
  text: string;
}

/**
 * Tách thư thành các phần lá + giải mã thân (quoted-printable / base64 / 7bit / 8bit) bằng `Buffer` của
 * Node — KHÔNG dùng chính thư viện đang bị đo. Đủ cho thư `text` + `html` mà InviteMailService gửi, KHÔNG
 * phải bộ parse MIME tổng quát. 9.x và 10.x có thể chọn transfer-encoding khác nhau ⇒ spec chỉ assert trên
 * nội dung ĐÃ GIẢI MÃ, không grep DATA thô.
 */
export function decodeMimeParts(raw: string): DecodedMimePart[] {
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(raw)?.[1];
  const chunks = boundary ? raw.split(`--${boundary}`).slice(1, -1) : [raw];
  return chunks.map((chunk) => {
    const sep = chunk.indexOf(CRLF + CRLF);
    if (sep === -1) throw new Error("Phần MIME thiếu dòng trống giữa header và thân");
    const headers = chunk.slice(0, sep);
    const body = chunk.slice(sep + 2 * CRLF.length).replace(/\r\n$/, "");
    const encoding = /content-transfer-encoding:\s*([\w-]+)/i.exec(headers)?.[1]?.toLowerCase();
    const contentType = /content-type:\s*([^;\r\n]+)/i.exec(headers)?.[1]?.toLowerCase() ?? "";
    let text: string;
    if (encoding === "base64")
      text = Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
    else if (encoding === "quoted-printable") text = decodeQuotedPrintable(body);
    else text = latin1ToUtf8(body);
    return { contentType, text };
  });
}

/** Đọc header `Subject` (gộp dòng gấp + giải encoded-word RFC 2047 dạng Q/B, UTF-8). */
export function decodeSubject(raw: string): string {
  const head = raw.slice(0, raw.indexOf(CRLF + CRLF)).replace(/\r\n[ \t]+/g, " ");
  const line = latin1ToUtf8(/^subject:\s*(.*)$/im.exec(head)?.[1] ?? "");
  return line
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?utf-8\?([qb])\?([^?]*)\?=/gi, (_m: string, enc: string, text: string) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : decodeQuotedPrintable(text.replace(/_/g, " ")),
    );
}
