import test from "node:test";
import assert from "node:assert/strict";
import { secondsFromClaudinio, parseRetryAfter, parseHumanReset, classifyFailure, codexWindows, exhaustedCodexReset } from "../src/limits.js";

test("Claudinio anti-runaway recognizes exact provider wording", () => {
  assert.equal(secondsFromClaudinio("Claudinio: Budget exceeded for window '1h'. Resets in 3126s. Please check"), 3126);
  assert.equal(secondsFromClaudinio("Claudinio: Budget exceeded for window '24h'. Resets in 6s."), 6);
  assert.equal(secondsFromClaudinio("Rate limit resets in 6s"), null);
});

test("Codex windows are derived from headers, not assumed to be 5h/weekly", () => {
  const now = 1000000000000;
  const headers = new Headers({
    "x-codex-primary-used-percent": "100",
    "x-codex-primary-window-minutes": "300",
    "x-codex-primary-reset-after-seconds": "100",
    "x-codex-secondary-used-percent": "100",
    "x-codex-secondary-window-minutes": "10080",
    "x-codex-secondary-reset-after-seconds": "200"
  });
  const windows = codexWindows(headers, now);
  assert.deepEqual(windows.map((w) => w.windowMinutes), [300, 10080]);
  assert.equal(exhaustedCodexReset(windows, now), now + 200000);
});

test("retry-after parses seconds and HTTP-date", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  assert.equal(parseRetryAfter("50", now), now + 50_000);
  assert.equal(parseRetryAfter("Thu, 05 Nov 2026 12:01:00 GMT", now), now + 60_000);
  assert.equal(parseRetryAfter("nonsense", now), null);
});

test("human 5-hour/weekly notices parse compound durations without a timezone guess", () => {
  const now = 1000000;
  assert.equal(parseHumanReset("Weekly usage limit reached. Resets in 2 days 4 hours.", now), now + (2 * 86400 + 4 * 3600) * 1000);
  assert.equal(parseHumanReset("5-hour limit reached. Resets at 15:00", now), null);
  assert.equal(classifyFailure({ providerID: "anthropic", status: 429, message: "Weekly usage limit reached. Resets in 2 days.", now }).reason, "claude-subscription");
});

test("Codex 429 and generic 429 differ; 401 never fails over", () => {
  const now = 100000;
  assert.deepEqual(classifyFailure({ providerID: "openai", status: 429, message: "usage_limit_reached Resets in 90s", now }),
    { kind: "quota", reason: "codex", resetAt: now + 90000, scope: "provider" });
  assert.equal(classifyFailure({ providerID: "openrouter", status: 429, message: "Too many requests", now }).reason, "generic-rate-limit");
  assert.equal(classifyFailure({ providerID: "openai", status: 401, message: "Unauthorized", now }).kind, "fatal");
});
