import { test } from "node:test";
import assert from "node:assert/strict";
import { assessBotHealth, parseLoginState, isAwaitingQrLogin } from "./health-state.js";

const NOW = new Date("2026-07-22T07:00:00.000Z").getTime();

test("healthy khi heartbeat mới và WebSocket connected", () => {
  const result = assessBotHealth({ heartbeatAt: NOW - 60_000, socketState: "connected" }, NOW);
  assert.equal(result.unhealthy, false);
});

test("unhealthy khi WebSocket closed dù heartbeat vẫn mới", () => {
  const result = assessBotHealth({ heartbeatAt: NOW - 60_000, socketState: "closed" }, NOW);
  assert.equal(result.heartbeatStale, false);
  assert.equal(result.socketConnected, false);
  assert.equal(result.unhealthy, true);
});

test("unhealthy khi heartbeat stale dù WebSocket còn ghi connected", () => {
  const result = assessBotHealth({ heartbeatAt: NOW - 11 * 60_000, socketState: "connected" }, NOW);
  assert.equal(result.heartbeatStale, true);
  assert.equal(result.unhealthy, true);
});

test("unhealthy khi chưa có health state", () => {
  const result = assessBotHealth(null, NOW);
  assert.equal(result.unhealthy, true);
});

test("parseLoginState đọc được JSON hợp lệ, trả null khi hỏng/thiếu", () => {
  const ok = parseLoginState(JSON.stringify({ state: "waiting_scan", updatedAt: NOW, pid: 123 }));
  assert.deepEqual(ok, { state: "waiting_scan", updatedAt: NOW, pid: 123 });
  assert.equal(parseLoginState(undefined), null);
  assert.equal(parseLoginState("not json"), null);
  assert.equal(parseLoginState(JSON.stringify({ updatedAt: NOW })), null);
});

test("isAwaitingQrLogin: true khi đang chờ quét và bản ghi còn mới", () => {
  const login = { state: "waiting_scan", updatedAt: NOW - 2 * 60_000, pid: 123 };
  assert.equal(isAwaitingQrLogin(login, NOW), true);
});

test("isAwaitingQrLogin: false khi đã logged_in hoặc bản ghi quá cũ", () => {
  assert.equal(isAwaitingQrLogin({ state: "logged_in", updatedAt: NOW, pid: 1 }, NOW), false);
  // Bản ghi cũ = process login cũng chết → không kết luận "chờ QR" từ dữ liệu ôi.
  assert.equal(
    isAwaitingQrLogin({ state: "waiting_scan", updatedAt: NOW - 11 * 60_000, pid: 1 }, NOW),
    false,
  );
  assert.equal(isAwaitingQrLogin(null, NOW), false);
});
