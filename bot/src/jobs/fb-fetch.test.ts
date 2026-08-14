import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRouteOrder,
  isGroupFeedHtml,
  parseProxyEntry,
  parseProxyList,
  STORY_DELIM,
} from "./fb-fetch.js";

test("nhận proxy dạng URL đầy đủ, giữ nguyên", () => {
  assert.equal(
    parseProxyEntry("http://user:pass@1.2.3.4:8080"),
    "http://user:pass@1.2.3.4:8080",
  );
  assert.equal(parseProxyEntry("socks5://1.2.3.4:1080"), "socks5://1.2.3.4:1080");
});

test("nhận proxy dạng Webshare xuất ra (host:port:user:pass)", () => {
  assert.equal(
    parseProxyEntry("198.23.239.134:6540:qcmazvhl:22lkqlac"),
    "http://qcmazvhl:22lkqlac@198.23.239.134:6540",
  );
});

test("mật khẩu có ký tự đặc biệt phải được mã hoá, không làm vỡ URL", () => {
  const url = parseProxyEntry("1.2.3.4:80:user@name:p@ss:word");
  // 5 phần thì không phải dạng hợp lệ — thà bỏ qua còn hơn ghép sai thành URL khác.
  assert.equal(url, null);
  assert.equal(parseProxyEntry("1.2.3.4:80:us er:p@ss"), "http://us%20er:p%40ss@1.2.3.4:80");
});

test("nhận proxy trần host:port cho danh sách miễn phí", () => {
  assert.equal(parseProxyEntry("103.174.122.217:8080"), "http://103.174.122.217:8080");
});

test("bỏ qua dòng rỗng, dòng chú thích và dòng rác", () => {
  assert.equal(parseProxyEntry(""), null);
  assert.equal(parseProxyEntry("   "), null);
  assert.equal(parseProxyEntry("# ghi chú"), null);
  assert.equal(parseProxyEntry("linh tinh"), null);
});

test("bóc danh sách nhiều dòng, bỏ trùng", () => {
  const list = parseProxyList(`
    1.2.3.4:8080
    1.2.3.4:8080
    5.6.7.8:3128, 9.9.9.9:80
    # dòng chú thích
  `);
  assert.deepEqual(list, [
    "http://1.2.3.4:8080",
    "http://5.6.7.8:3128",
    "http://9.9.9.9:80",
  ]);
});

test("chỉ coi là feed group khi có node Story", () => {
  assert.ok(isGroupFeedHtml(`<html>...${STORY_DELIM},"post_id":"1"...</html>`));
  // Trang đăng nhập của Facebook và trang lỗi của proxy đều trả 200 — phải trượt.
  assert.equal(isGroupFeedHtml("<html><body>Log in to Facebook</body></html>"), false);
  assert.equal(isGroupFeedHtml("<html><body>502 Bad Gateway</body></html>"), false);
});

test("chưa có cache thì gọi thẳng trước, rồi tới proxy trả phí", () => {
  const order = buildRouteOrder({
    cached: undefined,
    paid: ["http://a:1", "http://b:2"],
    paidAttempts: 1,
  });
  assert.deepEqual(order, [null, "http://a:1", "http://b:2"]);
});

test("có cache thì đường đã thành công lần trước đứng đầu, không bị lặp lại", () => {
  const order = buildRouteOrder({
    cached: "http://b:2",
    paid: ["http://a:1", "http://b:2"],
    paidAttempts: 1,
  });
  assert.deepEqual(order, ["http://b:2", null, "http://a:1"]);
});

test("cache là gọi thẳng thì thứ tự giữ nguyên, không nhân đôi", () => {
  const order = buildRouteOrder({ cached: null, paid: ["http://a:1"], paidAttempts: 1 });
  assert.deepEqual(order, [null, "http://a:1"]);
});

test("proxy miễn phí đã dùng được lần trước vẫn được thử lại đầu tiên", () => {
  // Con này không nằm trong danh sách trả phí — vẫn phải đứng đầu hàng.
  const order = buildRouteOrder({
    cached: "http://free:8080",
    paid: ["http://a:1"],
    paidAttempts: 1,
  });
  assert.deepEqual(order, ["http://free:8080", null, "http://a:1"]);
});

test("proxy trả phí được thử lại nhiều lượt, xen kẽ giữa các nhà cung cấp", () => {
  // Residential xoay vòng: mỗi lượt là một IP thoát mới, nên lặp là có ý nghĩa.
  const order = buildRouteOrder({
    cached: undefined,
    paid: ["http://a:1", "http://b:2"],
    paidAttempts: 3,
  });
  assert.deepEqual(order, [
    null,
    "http://a:1",
    "http://b:2",
    "http://a:1",
    "http://b:2",
    "http://a:1",
    "http://b:2",
  ]);
});

test("cache chỉ ăn một lượt lặp, các lượt còn lại vẫn giữ để bốc IP mới", () => {
  const order = buildRouteOrder({
    cached: "http://a:1",
    paid: ["http://a:1"],
    paidAttempts: 3,
  });
  // 1 lượt lên đầu + 2 lượt còn lại = vẫn đúng 3 lần thử proxy.
  assert.deepEqual(order, ["http://a:1", null, "http://a:1", "http://a:1"]);
});
