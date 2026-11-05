/** Pure quota parsing; never receives credentials or stores response bodies. */
const CLAUDINIO = /Claudinio:\s*Budget exceeded for window\s*['"]?([^'".]+)['"]?\.\s*Resets in\s*(\d+)s/i;
const LIMIT_HINT = /rate.?limit|too many requests|usage.?limit|quota|budget exceeded|anti.runaway|resource exhausted|capacity exceeded/i;
const CODEX_HINT = /usage_limit_reached|subscription_sharing_usage_limit_exceeded|codex|chatgpt.*limit/i;
const RESET_FIELDS = /resets?[_ -]?(?:in[_ -]?seconds|after[_ -]?seconds|in)\D{0,8}(\d+)/i;

/** Handle human-readable 5h/weekly subscription notices without guessing a timezone. */
export function parseHumanReset(message, now = Date.now()) {
  const text = String(message || "");
  const segment = /resets?\s+in\s+([^.!\n]+)/i.exec(text)?.[1];
  if (segment) {
    const units = /(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
    let total = 0, matched = false, match;
    while ((match = units.exec(segment))) {
      matched = true;
      const unit = match[2].toLowerCase();
      const multiplier = unit.startsWith("d") ? 86400 : unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
      total += Number(match[1]) * multiplier;
    }
    if (matched && Number.isSafeInteger(total) && total <= 60 * 60 * 24 * 366) return now + total * 1000;
  }
  const iso = /resets?\s+at\s+(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d))/i.exec(text)?.[1];
  const date = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(date) && date > now ? date : null;
}

export function secondsFromClaudinio(message) {
  const match = CLAUDINIO.exec(String(message ?? ""));
  return match ? Number(match[2]) : null;
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(String(value).trim());
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
  const date = Date.parse(String(value));
  return Number.isFinite(date) && date > now ? date : null;
}

function header(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : null;
}

function positiveNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function resetFromHeader(headers, prefix, now) {
  const absolute = positiveNumber(header(headers, `${prefix}-reset-at`));
  if (absolute !== null) return absolute > 1e12 ? absolute : absolute * 1000;
  const seconds = positiveNumber(header(headers, `${prefix}-reset-after-seconds`));
  return seconds === null ? null : now + seconds * 1000;
}

/** Codex headers label windows primary/secondary; their duration is not fixed. */
export function codexWindows(headers, now = Date.now()) {
  const windows = [];
  for (const prefix of ["x-codex-primary", "x-codex-secondary"]) {
    const resetAt = resetFromHeader(headers, prefix, now);
    const usedPercent = positiveNumber(header(headers, `${prefix}-used-percent`));
    const windowMinutes = positiveNumber(header(headers, `${prefix}-window-minutes`));
    if (resetAt !== null) windows.push({ prefix, resetAt, usedPercent, windowMinutes });
  }
  return windows;
}

/** A blocked quota must wait for every exhausted account window. */
export function exhaustedCodexReset(windows, now = Date.now()) {
  const exhausted = windows.filter((w) => w.usedPercent !== null && w.usedPercent >= 100 && w.resetAt > now);
  return exhausted.length ? Math.max(...exhausted.map((w) => w.resetAt)) : null;
}

export function classifyFailure({ providerID = "", message = "", status, headers, now = Date.now() }) {
  const text = String(message || "");
  if (status === 401 || status === 403 || /invalid.?api.?key|unauthorized|payment required|insufficient credits/i.test(text)) {
    return { kind: "fatal", reason: "authentication-or-billing", resetAt: null };
  }
  const claudinioSeconds = secondsFromClaudinio(text);
  if (claudinioSeconds !== null) {
    return { kind: "quota", reason: "claudinio", resetAt: now + claudinioSeconds * 1000, scope: "provider" };
  }
  const codex = providerID === "openai" && (CODEX_HINT.test(text) || codexWindows(headers, now).length > 0);
  if (codex && (status === 429 || /usage_limit_reached|subscription_sharing_usage_limit_exceeded/i.test(text))) {
    const resetMatch = RESET_FIELDS.exec(text);
    const fromText = parseHumanReset(text, now) || (resetMatch ? now + Number(resetMatch[1]) * 1000 : null);
    const fromWindows = exhaustedCodexReset(codexWindows(headers, now), now);
    const fromRetry = parseRetryAfter(header(headers, "retry-after"), now);
    return { kind: "quota", reason: "codex", resetAt: Math.max(...[fromText, fromWindows, fromRetry].filter(Boolean), 0) || null, scope: "provider" };
  }
  if (status === 429 || LIMIT_HINT.test(text)) {
    const retry = parseRetryAfter(header(headers, "retry-after"), now);
    const humanReset = parseHumanReset(text, now);
    const isClaudeSubscription = /(?:weekly|five.hour|5.hour|5h)\s+(?:usage\s+)?limit/i.test(text) && /claude|anthropic|usage limit/i.test(`${providerID} ${text}`);
    return { kind: "quota", reason: isClaudeSubscription ? "claude-subscription" : "generic-rate-limit", resetAt: retry || humanReset, scope: isClaudeSubscription ? "provider" : "model" };
  }
  if ([408, 500, 502, 503, 504].includes(status) || /overloaded|service unavailable|timeout|ECONNRESET/i.test(text)) {
    return { kind: "transient", reason: "upstream", resetAt: now + 30_000, scope: "model" };
  }
  return { kind: "other", reason: "unhandled", resetAt: null };
}
