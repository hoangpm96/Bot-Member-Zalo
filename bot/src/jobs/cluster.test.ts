import assert from "node:assert/strict";
import { test } from "node:test";
import { clusterMessages, type ClusterableMessage } from "./cluster.js";

const MIN = 60_000;
const GAP = 15 * MIN;

function msg(
  senderId: string,
  messageId: string,
  text: string,
  minutes: number,
): ClusterableMessage {
  return { senderId, author: `Người ${senderId}`, messageId, text, ts: minutes * MIN };
}

test("ghép nhiều tin của cùng người trong cửa sổ thành một cụm", () => {
  const items = clusterMessages(
    [
      msg("u1", "m1", "Team mình cần tuyển BA", 0),
      msg("u1", "m2", "Lương 20-25tr", 3),
      msg("u1", "m3", "HN, inbox mình nhé", 7),
    ],
    "zalo",
    GAP,
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]!.text, "Team mình cần tuyển BA\nLương 20-25tr\nHN, inbox mình nhé");
  // Id và mốc thời gian lấy theo tin đầu tiên của cụm.
  assert.equal(items[0]!.sourceId, "m1");
  assert.equal(items[0]!.postedAt, 0);
});

test("người khác chen vào giữa không cắt cụm", () => {
  const items = clusterMessages(
    [
      msg("u1", "m1", "Cần tuyển BA", 0),
      msg("u2", "m2", "Hóng ạ", 1),
      msg("u1", "m3", "Lương 25tr", 2),
    ],
    "zalo",
    GAP,
  );

  const u1 = items.find((i) => i.sourceId === "m1");
  assert.equal(u1!.text, "Cần tuyển BA\nLương 25tr");
  assert.equal(items.length, 2);
});

test("im lặng quá cửa sổ thì mở cụm mới", () => {
  const items = clusterMessages(
    [
      msg("u1", "m1", "Tin tuyển dụng buổi sáng", 0),
      msg("u1", "m2", "Tin tuyển dụng buổi chiều", 400),
    ],
    "telegram",
    GAP,
  );

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.sourceId),
    ["m1", "m2"],
  );
});

test("bỏ tin rỗng và sắp xếp theo thời gian", () => {
  const items = clusterMessages(
    [msg("u1", "m2", "   ", 5), msg("u2", "m3", "Tuyển PO", 2), msg("u1", "m1", "Tuyển BA", 0)],
    "zalo",
    GAP,
  );

  assert.deepEqual(
    items.map((i) => i.text),
    ["Tuyển BA", "Tuyển PO"],
  );
});
