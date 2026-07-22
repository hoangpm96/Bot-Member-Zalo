import { test } from "node:test";
import assert from "node:assert/strict";
import { assessBotHealth } from "./health-state.js";

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
