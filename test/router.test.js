import test from "node:test";
import assert from "node:assert/strict";
import { ModelRouter, chooseModel, modelRef, quotaGroup } from "../src/router.js";
import { normalizeConfig } from "../src/config.js";

const models = [
  { providerID: "openai", id: "codex", enabled: true, cost: [{ input: 1, output: 2 }], capabilities: { tools: true } },
  { providerID: "claudinio", id: "sonnet", enabled: true, cost: [{ input: 0, output: 0 }] },
  { providerID: "kilo", id: "auto/free", enabled: true, cost: [{ input: 0, output: 0 }] },
  { providerID: "openrouter", id: "free", enabled: true, cost: [{ input: 0, output: 0 }] }
];
const config = () => normalizeConfig({
  models: ["openai/codex", "claudinio/sonnet", "kilo/auto/free", "openrouter/free"],
  subscriptionModels: ["openai/codex"],
  agents: { explorer: ["kilo/auto/free", "openrouter/free"] }
});

function mockCtx() {
  const storage = new Map();
  const switches = [];
  return {
    model: { list: async () => models },
    storage: { get: async (key) => storage.get(key), set: async (key, value) => storage.set(key, structuredClone(value)) },
    session: { switchModel: async (args) => { switches.push(args); } },
    switches
  };
}

test("model refs preserve multi-segment IDs and optional variants", () => {
  assert.deepEqual(modelRef("kilo/auto/free#high"), { providerID: "kilo", id: "auto/free", variant: "high" });
});

test("global priority, agent priority, disabled and paid protection", () => {
  const c = config();
  assert.equal(chooseModel({ config: c, models, cooldowns: {}, agent: "build" }).id, "codex");
  assert.equal(chooseModel({ config: c, models, cooldowns: {}, agent: "explorer" }).id, "auto/free");
  c.disabledModels = ["openai/codex"];
  assert.equal(chooseModel({ config: c, models, cooldowns: {}, agent: "build" }).providerID, "claudinio");
  c.disabledModels = []; c.subscriptionModels = [];
  assert.equal(chooseModel({ config: c, models, cooldowns: {}, agent: "build" }).providerID, "claudinio");
});

test("models without tool calling are skipped unless explicitly allowed", () => {
  const c = config();
  const withoutTools = models.map((m) => m.providerID === "openai" ? { ...m, capabilities: { tools: false } } : m);
  assert.equal(chooseModel({ config: c, models: withoutTools, cooldowns: {}, agent: "build" }).providerID, "claudinio");
  c.allowTextOnlyModels = true;
  assert.equal(chooseModel({ config: c, models: withoutTools, cooldowns: {}, agent: "build" }).providerID, "openai");
});

test("Claudinio and Codex groups share account/provider quota", () => {
  const c = config();
  assert.equal(quotaGroup(models[0], { reason: "codex" }, c), "account:codex-oauth");
  assert.equal(quotaGroup(models[1], { reason: "claudinio" }, c), "provider:claudinio");
});

test("Codex OAuth cooldown does not disable unrelated OpenAI API models", () => {
  const c = config();
  c.allowPaid = true;
  c.models = ["openai/api-other", "openai/codex", "claudinio/sonnet"];
  const otherApiModel = { ...models[0], id: "api-other" };
  const selected = chooseModel({
    config: c,
    models: [otherApiModel, ...models],
    cooldowns: { "account:codex-oauth": { until: 999999 } },
    now: 100000
  });
  assert.equal(selected.id, "api-other");
});

test("429 switches in the same session, never submits an artificial prompt", async () => {
  let now = 100000;
  const ctx = mockCtx();
  const router = new ModelRouter(ctx, config(), () => now);
  await router.initialize();
  router.observeRequest({ sessionID: "ses_1", agent: "build", model: models[0], kind: "primary" });
  const event = { sessionID: "ses_1", agent: "build", model: models[0], error: { status: 429, message: "usage_limit_reached Resets in 100s" }, attempt: 2, decision: { retry: false } };
  assert.equal(await router.handleRetry(event), true);
  assert.deepEqual(event.decision, { retry: true, delay: 100 });
  assert.equal(ctx.switches.length, 1);
  assert.equal(ctx.switches[0].model.providerID, "claudinio");
  assert.equal(router.cooldowns["account:codex-oauth"].until, now + 105000);
  now += 105001;
  await router.tick();
  assert.equal(ctx.switches.at(-1).model.providerID, "openai");
});

test("per-agent fallback skips blocked quota and follows agent order", async () => {
  const ctx = mockCtx();
  const router = new ModelRouter(ctx, config(), () => 100000);
  await router.initialize();
  const event = { sessionID: "ses_2", agent: "explorer", model: models[2], error: { status: 429, message: "Too many requests" }, attempt: 2, decision: { retry: false } };
  assert.equal(await router.handleRetry(event), true);
  assert.equal(ctx.switches.at(-1).model.providerID, "openrouter");
});

test("invalid error and authentication failure do not cause a switch", async () => {
  const ctx = mockCtx();
  const router = new ModelRouter(ctx, config(), () => 100000);
  await router.initialize();
  for (const error of [{ status: 401, message: "Unauthorized" }, { status: 400, message: "Bad request" }]) {
    assert.equal(await router.handleRetry({ sessionID: "s", agent: "build", model: models[0], error, attempt: 2, decision: { retry: false } }), false);
  }
  assert.equal(ctx.switches.length, 0);
});

test("manual user model switch stays pinned", async () => {
  const ctx = mockCtx();
  const router = new ModelRouter(ctx, config(), () => 100000);
  await router.initialize();
  await router.handleRetry({ sessionID: "s", agent: "build", model: models[0], error: { status: 429, message: "usage_limit_reached" }, attempt: 2, decision: { retry: false } });
  router.observeRequest({ sessionID: "s", agent: "build", model: models[3], kind: "primary" });
  assert.equal(router.session("s").pinned, true);
  assert.equal(await router.promote("s"), false);
});
