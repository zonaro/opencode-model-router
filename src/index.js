import { ModelRouter, refString } from "./router.js";
import { loadConfig, CATALOG_FILE, STATUS_FILE, atomicJson, createConfigMonitor } from "./config.js";
import { Plugin } from "@opencode/plugin";

/** OpenCode V2 plugin. Other plugins may coexist; avoid touching tool/context hooks. */
export default Plugin.define({
  id: "zonaro.model-router",
  async setup(ctx) {
    const router = new ModelRouter(ctx, await loadConfig());
    await router.initialize();
    const subscriptions = [];
    const controller = new AbortController();
    let catalogStamp = "";
    const publishCatalog = async () => {
      const models = (await router.refreshCatalog()).map((model) => ({
        id: refString(model),
        providerID: model.providerID,
        name: model.name || model.id,
        enabled: model.enabled !== false,
        paid: (Array.isArray(model.cost) ? model.cost : [model.cost || {}]).some((tier) => Number(tier?.input) > 0 || Number(tier?.output) > 0),
        tools: model.capabilities?.tools !== false,
        context: model.limit?.context || null,
        variants: Object.keys(model.variants || {})
      }));
      let agents = [];
      try { agents = (await ctx.agent.list()).map((agent) => ({ id: agent.id, name: agent.name || agent.id })); } catch { /* server may have no agent API */ }
      const data = { version: 1, models, agents };
      const stamp = JSON.stringify(data);
      if (stamp !== catalogStamp) {
        catalogStamp = stamp;
        await atomicJson(CATALOG_FILE, { ...data, updatedAt: new Date().toISOString() });
      }
    };
    try { await publishCatalog(); } catch { console.warn("[model-router] Catálogo indisponível; configuração manual continua funcionando."); }
    const publishStatus = async () => {
      await atomicJson(STATUS_FILE, {
        updatedAt: new Date().toISOString(),
        cooldowns: Object.entries(router.cooldowns).map(([group, { until, reason, lastModel }]) => ({ group, until, reason, lastModel })),
        sessions: [...router.sessions.values()].filter((s) => s.managed).map((s) => ({ agent: s.agent, target: s.target }))
      });
    };
    try { await publishStatus(); } catch { /* no filesystem permissions */ }

    subscriptions.push(await ctx.session.hook("http.request", (event) => router.observeRequest(event)));
    subscriptions.push(await ctx.session.hook("http.response", (event) => router.captureResponse(event)));
    subscriptions.push(await ctx.session.hook("retry", (event) => router.handleRetry(event)));
    subscriptions.push(await ctx.session.hook("prompt", async (event) => {
      // A prompt is admitted once per user turn. Reset the fallback budget here
      // even on hosts that do not expose a turn-completed event.
      router.session(event.sessionID).switches = 0;
      await router.routePrompt(event.sessionID, event.agent);
    }));

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const body = event.data || event.properties || {};
          if (event.type === "session.step.ended" && ["stop", "tool-calls", "length"].includes(body.finish)) {
            const sessionID = body.sessionID;
            if (sessionID) await router.onTurnSuccess(sessionID);
          } else if (event.type === "session.execution.succeeded") {
            const sessionID = body.sessionID;
            if (sessionID) await router.onTurnSuccess(sessionID);
          } else if (event.type === "session.execution.interrupted") {
            if (body.sessionID && body.reason === "user") router.sessions.delete(body.sessionID);
          } else if (event.type === "session.deleted") {
            const sessionID = body.info?.id || body.sessionID;
            if (sessionID) router.sessions.delete(sessionID);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) console.warn("[model-router] Stream de eventos indisponível.");
      }
    })();

    const checkConfig = createConfigMonitor(undefined, (value) => router.setConfig(value));
    const interval = setInterval(() => {
      void (async () => {
        await checkConfig();
        await router.tick();
        await publishStatus();
      })().catch(() => console.warn("[model-router] Falha ao atualizar configuração."));
    }, 10000);
    interval.unref?.();
    const catalogInterval = setInterval(() => void publishCatalog().catch(() => {}), 60000);
    catalogInterval.unref?.();

    return async () => {
      controller.abort();
      clearInterval(interval);
      clearInterval(catalogInterval);
      await Promise.allSettled(subscriptions.map((subscription) => subscription.dispose()));
    };
  }
});
