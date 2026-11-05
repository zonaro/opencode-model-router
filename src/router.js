import { classifyFailure, codexWindows, exhaustedCodexReset } from "./limits.js";
import { normalizeConfig } from "./config.js";
import { readCodexStatus } from "./status.js";

export function modelRef(ref) {
  if (typeof ref !== "string") return null;
  const slash = ref.indexOf("/");
  if (slash < 1 || slash === ref.length - 1) return null;
  const hash = ref.lastIndexOf("#");
  const base = hash > slash ? ref.slice(0, hash) : ref;
  const [providerID, ...pieces] = base.split("/");
  return { providerID, id: pieces.join("/"), ...(hash > slash ? { variant: ref.slice(hash + 1) } : {}) };
}

export function refString(model) {
  return `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`;
}

function catalogKey(model) { return `${model.providerID}/${model.id}`; }

export function quotaGroup(model, failure, config) {
  const id = catalogKey(model);
  if (config.quotaGroups[id]) return config.quotaGroups[id];
  if (failure?.reason === "codex") return "account:codex-oauth";
  if (failure?.reason === "claude-subscription") return `provider:${model.providerID}`;
  if (failure?.reason === "claudinio") return `provider:${model.providerID}`;
  if (model.providerID === "openrouter" && (model.id.endsWith(":free") || model.id === "free")) return "account:openrouter-free";
  if (/kilo/i.test(model.providerID) && /free/i.test(model.id)) return "account:kilo-free";
  return failure?.scope === "provider" ? `provider:${model.providerID}` : `model:${id}`;
}

function isPaid(model) {
  const tiers = Array.isArray(model.cost) ? model.cost : model.cost ? [model.cost] : [];
  if (!tiers.length) return !/(?:^|[\/:_-])free(?:$|[\/:_-])/.test(model.id);
  return tiers.some((cost) => Number(cost.input) > 0 || Number(cost.output) > 0);
}

export function chooseModel({ config, agent, current, models, cooldowns, now = Date.now(), exclude = new Set() }) {
  const chain = config.agents[agent]?.length ? config.agents[agent] : config.models;
  const available = new Map(models.filter((m) => m.enabled !== false).map((m) => [catalogKey(m), m]));
  for (const ref of chain) {
    const model = modelRef(ref);
    if (!model || config.disabledModels.includes(ref) || config.disabledModels.includes(catalogKey(model))) continue;
    const definition = available.get(catalogKey(model));
    if (!definition || exclude.has(ref) || exclude.has(catalogKey(model))) continue;
    if (!config.allowTextOnlyModels && definition.capabilities?.tools === false) continue;
    const premiumExempt = config.subscriptionModels.includes(catalogKey(model));
    if (!config.allowPaid && isPaid(definition) && !premiumExempt) continue;
    if (model.variant && definition.variants && !Object.hasOwn(definition.variants, model.variant)) continue;
    const modelBlock = cooldowns[`model:${catalogKey(model)}`];
    const providerBlock = cooldowns[`provider:${model.providerID}`];
    const customBlock = cooldowns[config.quotaGroups[catalogKey(model)]];
    const inferredBlocks = [
      model.providerID === "openrouter" ? cooldowns["account:openrouter-free"] : null,
      /kilo/i.test(model.providerID) ? cooldowns["account:kilo-free"] : null,
      model.providerID === "openai" && config.subscriptionModels.includes(catalogKey(model))
        ? cooldowns["account:codex-oauth"] : null
    ];
    if ([modelBlock, providerBlock, customBlock, ...inferredBlocks].some((item) => item && item.until > now)) continue;
    return model;
  }
  return null;
}

/** State machine used by the actual OpenCode hooks and by deterministic tests. */
export class ModelRouter {
  constructor(ctx, config = normalizeConfig(), clock = Date.now) {
    this.ctx = ctx;
    this.config = config;
    this.clock = clock;
    this.catalog = [];
    this.cooldowns = {};
    this.sessions = new Map();
    this.responses = new Map();
    this.lastCodexCheck = 0;
  }

  async initialize() {
    try { this.cooldowns = (await this.ctx.storage.get("cooldowns")) || {}; } catch { /* optional storage */ }
    await this.refreshCatalog();
  }

  setConfig(config) { this.config = normalizeConfig(config); }

  async refreshCatalog() {
    try { const data = await this.ctx.model.list(); this.catalog = Array.isArray(data) ? data : []; } catch { this.catalog = []; }
    return this.catalog;
  }

  session(sessionID) {
    if (!this.sessions.has(sessionID)) {
      this.sessions.set(sessionID, { managed: false, target: null, current: null, agent: null, switches: 0, pinned: false });
    }
    return this.sessions.get(sessionID);
  }

  observeRequest(event) {
    if (event.kind && event.kind !== "primary") return;
    const state = this.session(event.sessionID);
    const incoming = refString(event.model);
    if (state.managed && state.target && state.target !== incoming && this.config.respectManualSelection) {
      state.pinned = true;
      state.managed = false;
    }
    state.current = incoming;
    state.agent = event.agent || state.agent;
  }

  async captureResponse(event) {
    const { sessionID, model, response } = event;
    if (!response || !sessionID || !model) return;
    const now = this.clock();
    const windows = model.providerID === "openai" ? codexWindows(response.headers, now) : [];
    const reset = exhaustedCodexReset(windows, now);
    if (reset !== null) await this.block(model, { reason: "codex", scope: "provider", resetAt: reset }, now);
    const id = `${sessionID}:${refString(model)}`;
    const safeHeaders = {};
    for (const [name, value] of response.headers) {
      if (/^(retry-after|x-codex-[a-z0-9-]*(used-percent|reset-at|reset-after-seconds|window-minutes)|x-ratelimit-(reset|remaining|limit))$/i.test(name)) safeHeaders[name] = value;
    }
    this.responses.set(id, { time: now, status: response.status, headers: safeHeaders, message: "" });
    // Read only small failed responses. Never retain token-bearing headers or bodies.
    if (response.status === 429 && typeof response.clone === "function") {
      try {
        const body = (await response.clone().text()).slice(0, 16384);
        const saved = this.responses.get(id);
        if (saved) {
          let parsed = body;
          try { const json = JSON.parse(body); parsed = json.error?.message || json.error?.type || body; } catch { /* non-JSON */ }
          saved.message = String(parsed).slice(0, 1000);
        }
      } catch { /* stream unavailable */ }
    }
    if (this.responses.size > 256) this.responses.delete(this.responses.keys().next().value);
  }

  async block(model, failure, now = this.clock()) {
    const group = quotaGroup(model, failure, this.config);
    const until = Math.max(now + this.config.safetyMarginMs, (failure.resetAt || now + this.config.unknownQuotaCooldownSeconds * 1000) + this.config.safetyMarginMs);
    this.cooldowns[group] = { until, reason: failure.reason, lastModel: catalogKey(model) };
    try { await this.ctx.storage.set("cooldowns", this.cooldowns); } catch { /* best effort */ }
  }

  async handleRetry(event) {
    if (!this.config.enabled || event.kind && event.kind !== "primary") return false;
    const now = this.clock();
    const state = this.session(event.sessionID);
    if (state.pinned && this.config.respectManualSelection) return false;
    if (state.switches >= this.config.maxSwitchesPerTurn) return false;
    const key = `${event.sessionID}:${refString(event.model)}`;
    const cached = this.responses.get(key);
    const fresh = cached && now - cached.time <= 30000 ? cached : null;
    const failure = classifyFailure({
      providerID: event.model.providerID,
      status: event.error?.status || fresh?.status,
      message: `${event.error?.message || ""} ${fresh?.message || ""}`,
      headers: fresh?.headers,
      now
    });
    if (!["quota", "transient"].includes(failure.kind)) return false;
    if (failure.reason === "codex" && !failure.resetAt && this.config.providers.codexStatusFallback === "app-server" && now - this.lastCodexCheck >= 60000) {
      this.lastCodexCheck = now;
      // The Codex CLI must already use the same OAuth account; no tokens are read here.
      failure.resetAt = await readCodexStatus();
    }
    await this.block(event.model, failure, now);
    const exclude = new Set([refString(event.model)]);
    let next = chooseModel({ config: this.config, agent: event.agent, current: event.model, models: this.catalog, cooldowns: this.cooldowns, now, exclude });
    if (!next) { await this.refreshCatalog(); next = chooseModel({ config: this.config, agent: event.agent, models: this.catalog, cooldowns: this.cooldowns, now, exclude }); }
    if (!next) return false; // Let OpenCode handle terminal retries; no synthetic prompt.
    try {
      await this.ctx.session.switchModel({ sessionID: event.sessionID, model: next });
      state.managed = true;
      state.target = refString(next);
      state.current = refString(next);
      state.agent = event.agent;
      state.switches++;
      event.decision = { retry: true, delay: 100 };
      console.info(`[model-router] ${event.sessionID}: fallback ${refString(event.model)} -> ${refString(next)} (${failure.reason}).`);
      return true;
    } catch (error) {
      console.warn(`[model-router] ${event.sessionID}: falha ao trocar de modelo.`);
      return false;
    }
  }

  async promote(sessionID, agent) {
    const state = this.session(sessionID);
    if (!this.config.enabled || !state.managed || state.pinned) return false;
    const next = chooseModel({ config: this.config, agent: agent || state.agent, models: this.catalog, cooldowns: this.cooldowns, now: this.clock() });
    if (!next || refString(next) === state.target) return false;
    try {
      await this.ctx.session.switchModel({ sessionID, model: next });
      state.target = refString(next);
      state.current = state.target;
      console.info(`[model-router] ${sessionID}: prioridade recuperada -> ${state.target}.`);
      return true;
    } catch { return false; }
  }

  async routePrompt(sessionID, agent) {
    const state = this.session(sessionID);
    if (!this.config.enabled || state.pinned) return false;
    if (state.managed) return this.promote(sessionID, agent);
    // Explicit opt-in for automatic selection of the first model on a new session.
    if (this.config.respectManualSelection) return false;
    const next = chooseModel({ config: this.config, agent: agent || state.agent, models: this.catalog, cooldowns: this.cooldowns, now: this.clock() });
    if (!next) return false;
    try {
      await this.ctx.session.switchModel({ sessionID, model: next });
      state.managed = true;
      state.target = refString(next);
      state.current = state.target;
      state.agent = agent || state.agent;
      return true;
    } catch { return false; }
  }

  async onTurnSuccess(sessionID) {
    const state = this.session(sessionID);
    state.switches = 0;
    await this.promote(sessionID);
  }

  async tick() {
    const now = this.clock();
    let changed = false;
    for (const [key, value] of Object.entries(this.cooldowns)) {
      if (value.until <= now) { delete this.cooldowns[key]; changed = true; }
    }
    if (changed) {
      try { await this.ctx.storage.set("cooldowns", this.cooldowns); } catch { /* best effort */ }
    }
    for (const [sessionID, state] of this.sessions) {
      if (state.managed) await this.promote(sessionID);
    }
  }
}
