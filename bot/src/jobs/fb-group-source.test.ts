import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFbGroupHtml } from "./fb-group-source.js";

/**
 * Fixture rút gọn theo đúng hình dạng JSON mà Facebook nhúng trong HTML trang
 * group (đã đo trên group bahubvn): mỗi bài là một node Story, trong đó
 * owning_profile.name đứng trước post_id, creation_time đứng ngay sau, còn
 * message.text nằm sâu hơn trong comet_sections.
 */
function story(input: {
  postId: string;
  author: string;
  creationTime: number;
  text: string;
}): string {
  return (
    `{"node":{"__typename":"Story","__isFeedUnit":"Story",` +
    `"feedback":{"owning_profile":{"__typename":"User","name":${JSON.stringify(input.author)},` +
    `"id":"pfbid0abc"}},` +
    `"post_id":"${input.postId}","creation_time":${input.creationTime},` +
    `"comet_sections":{"content":{"story":{"message":{"text":${JSON.stringify(input.text)}}}}}}}`
  );
}

const HTML =
  `<!DOCTYPE html><html><body><script>{"data":{"group":{"feed":{"edges":[` +
  story({
    postId: "1273659691420118",
    author: "Hồng Bii",
    creationTime: 1786688689,
    text: "Mình cần tuyển BUSINESS ANALYST từ 1+exp\n\n- Mức lương: 20-27M\n- onsite tại Hoàn Kiếm, HN",
  }) +
  "," +
  story({
    postId: "909373051182119",
    author: "Hoàng Phan",
    creationTime: 1743493004,
    text: "Hi mọi người, mình là Hoàng. Mình có ý định xây dựng cộng đồng BAHUB (bahub.vn)",
  }) +
  `]}}}}</script></body></html>`;

test("bóc đủ trường từ HTML group Facebook", () => {
  const items = parseFbGroupHtml(HTML, "bahubvn");

  assert.equal(items.length, 2);
  const [first] = items;
  assert.equal(first!.source, "facebook");
  assert.equal(first!.sourceId, "1273659691420118");
  assert.equal(first!.author, "Hồng Bii");
  assert.equal(
    first!.sourceUrl,
    "https://www.facebook.com/groups/bahubvn/posts/1273659691420118/",
  );
  assert.equal(first!.postedAt, 1786688689 * 1000);
  assert.match(first!.text, /BUSINESS ANALYST từ 1\+exp/);
  // Xuống dòng trong bài phải giữ nguyên — AI cần chúng để tách các ý.
  assert.match(first!.text, /\n- Mức lương: 20-27M/);
});

test("bỏ qua bài không có nội dung chữ", () => {
  const onlyPhoto =
    `<script>[` +
    `{"node":{"__typename":"Story","post_id":"111","creation_time":1786688689,` +
    `"attachments":[{"media":{"__typename":"Photo"}}]}}` +
    `]</script>`;
  assert.deepEqual(parseFbGroupHtml(onlyPhoto, "bahubvn"), []);
});

test("bài trùng id chỉ lấy một lần", () => {
  const dup =
    HTML +
    story({
      postId: "1273659691420118",
      author: "Hồng Bii",
      creationTime: 1786688689,
      text: "bản lặp trong cùng trang",
    });
  const items = parseFbGroupHtml(dup, "bahubvn");
  assert.equal(items.filter((i) => i.sourceId === "1273659691420118").length, 1);
});

test("HTML không phải trang group thì trả mảng rỗng, không ném lỗi", () => {
  assert.deepEqual(parseFbGroupHtml("<html><body>Log in to Facebook</body></html>", "bahubvn"), []);
});
