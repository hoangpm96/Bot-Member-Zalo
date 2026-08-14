import assert from "node:assert/strict";
import { test } from "node:test";
import {
  htmlToText,
  parseWidgetHtml,
  resolveTopics,
  toRawJobItems,
  type WidgetMessage,
} from "./telegram-widget.js";

/**
 * Fixture theo đúng HTML thật của Post Widget (đo trên group
 * @businessanalystvietnam): tác giả thật nằm trong thẻ `a` có href, còn tên
 * trong khối trả lời là `span` — đây chính là chỗ dễ bóc nhầm nhất.
 */
function widget(input: {
  author: string;
  username: string;
  text: string;
  time: string;
  replyTo?: number;
  replyText?: string;
}): string {
  const reply =
    input.replyTo === undefined
      ? ""
      : `<a class="tgme_widget_message_reply user-color-default" href="https://t.me/g/${input.replyTo}" ">
           <div class="tgme_widget_message_author accent_color">
             <span class="tgme_widget_message_author_name" dir="auto">Hoang Phan</span>
           </div>
           <div class="tgme_widget_message_metatext js-message_reply_text" dir="auto">${input.replyText ?? "Service message"}</div>
         </a>`;

  return `<div class="tgme_widget_message_author accent_color">
      <a class="tgme_widget_message_author_name" href="https://t.me/${input.username}"><span dir="auto">${input.author}</span></a>
      &nbsp;in&nbsp;<a class="tgme_widget_message_owner_name" href="https://t.me/g"><span dir="auto">Nhóm BA</span></a>
    </div>
    ${reply}
    <div class="tgme_widget_message_text js-message_text" dir="auto">${input.text}</div>
    <time datetime="${input.time}"></time>`;
}

test("lấy đúng tác giả thật, không lấy nhầm tên trong khối trả lời", () => {
  const html = widget({
    author: "Đức Anh",
    username: "tranducanh_hunter",
    text: "Mình tìm 1 bạn BA từ 3-4 năm kn",
    time: "2026-08-11T03:20:00+00:00",
    replyTo: 440,
  });

  const msg = parseWidgetHtml(html, "businessanalystvietnam", 35759)!;
  assert.equal(msg.author, "Đức Anh");
  assert.equal(msg.authorUsername, "tranducanh_hunter");
  assert.equal(msg.topicRoot, 440);
  assert.equal(msg.replyTo, null);
  assert.equal(msg.url, "https://t.me/businessanalystvietnam/35759");
  assert.equal(msg.ts, Date.parse("2026-08-11T03:20:00+00:00"));
});

test("người đăng không có username vẫn lấy được tên", () => {
  // Telegram render `span` lồng `span` khi tài khoản không có username công khai.
  const html = `<div class="tgme_widget_message_author accent_color"><span class="tgme_widget_message_author_name"><span dir="auto">Hoai Bui</span></span>&nbsp;in&nbsp;<a class="tgme_widget_message_owner_name" href="https://t.me/g"><span dir="auto">Nhóm BA</span></a></div>
    <a class="tgme_widget_message_reply user-color-default" href="https://t.me/g/440" ">
      <div class="tgme_widget_message_author accent_color">
        <span class="tgme_widget_message_author_name" dir="auto">Hoang Phan</span>
      </div>
      <div class="tgme_widget_message_metatext js-message_reply_text" dir="auto">Service message</div>
    </a>
    <div class="tgme_widget_message_text js-message_text" dir="auto">[TUYỂN DỤNG GẤP] BUSINESS ANALYST</div>
    <time datetime="2026-08-11T02:30:00+00:00"></time>`;

  const msg = parseWidgetHtml(html, "g", 35752)!;
  assert.equal(msg.author, "Hoai Bui");
  assert.equal(msg.authorUsername, null);
  assert.equal(msg.topicRoot, 440);
});

test("tin trả lời người khác thì ghi replyTo, không phải topicRoot", () => {
  const html = widget({
    author: "Nam",
    username: "nam",
    text: "Bên bạn còn tuyển không?",
    time: "2026-08-11T04:00:00+00:00",
    replyTo: 35752,
    replyText: "[TUYỂN DỤNG GẤP] BUSINESS ANALYST",
  });

  const msg = parseWidgetHtml(html, "g", 35760)!;
  assert.equal(msg.replyTo, 35752);
  assert.equal(msg.topicRoot, null);
});

test("id không tồn tại (không có thẻ time) trả null", () => {
  assert.equal(parseWidgetHtml("<html><body>Post not found</body></html>", "g", 1), null);
});

test("giữ xuống dòng và giải mã ký tự HTML", () => {
  assert.equal(htmlToText("Tuyển BA<br/>Lương 20-25M"), "Tuyển BA\nLương 20-25M");
  assert.equal(htmlToText("Ph&#7909;c &amp; l&#7907;i"), "Phục & lợi");
  assert.equal(htmlToText('A&nbsp;&quot;B&quot;'), 'A "B"');
});

function msg(id: number, extra: Partial<WidgetMessage>): WidgetMessage {
  return {
    messageId: id,
    author: "A",
    authorUsername: "a",
    text: `tin ${id}`,
    ts: id,
    topicRoot: null,
    replyTo: null,
    url: `https://t.me/g/${id}`,
    ...extra,
  };
}

test("lần ngược chuỗi trả lời để ra topic, không tốn request", () => {
  const batch = [
    msg(100, { topicRoot: 440 }),
    msg(101, { replyTo: 100 }),
    msg(102, { replyTo: 101 }),
    msg(200, { topicRoot: 30819 }),
  ];

  const topics = resolveTopics(batch);
  assert.equal(topics.get(101), 440);
  assert.equal(topics.get(102), 440);
  assert.equal(topics.get(200), 30819);
});

test("tin cha nằm ngoài lô thì để trống, không đoán bừa", () => {
  const topics = resolveTopics([msg(101, { replyTo: 99 })]);
  assert.equal(topics.get(101), null);
});

test("chuỗi trả lời vòng lại chính nó không làm treo", () => {
  const topics = resolveTopics([msg(1, { replyTo: 2 }), msg(2, { replyTo: 1 })]);
  assert.equal(topics.get(1), null);
});

test("chỉ giữ tin đúng topic và có nội dung", () => {
  const items = toRawJobItems(
    [
      msg(100, { topicRoot: 440, text: "Tuyển BA" }),
      msg(101, { replyTo: 100, text: "Còn tuyển không?" }),
      msg(200, { topicRoot: 30819, text: "Mirror Zalo" }),
      msg(300, { topicRoot: 440, text: "" }),
    ],
    440,
  );

  assert.deepEqual(
    items.map((i) => i.sourceId),
    ["100", "101"],
  );
  assert.equal(items[0]!.source, "telegram");
  assert.equal(items[0]!.sourceUrl, "https://t.me/g/100");
});
