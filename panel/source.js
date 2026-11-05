import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";

const host = connectHost();
const CONFIG = "~/.config/opencode/model-router.json";
const CATALOG = "~/.config/opencode/model-router-catalog.json";
const STATUS = "~/.config/opencode/model-router-status.json";
const defaults = {
  enabled: true, allowPaid: false, allowTextOnlyModels: false, respectManualSelection: true,
  safetyMarginMs: 5000, unknownQuotaCooldownSeconds: 900, maxSwitchesPerTurn: 8,
  models: [], subscriptionModels: [], agents: {}, disabledModels: [], quotaGroups: {},
  providers: { codexStatusFallback: "off" }, integration: { slimFallbackDisabled: false }
};
const state = { config: structuredClone(defaults), catalog: { models: [], agents: [] }, status: { cooldowns: [], sessions: [] }, agent: "", filter: "", dirty: false, loaded: false, message: "" };
const root = document.getElementById("root");
let initialized = false;

const h = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
};
const append = (parent, ...elements) => { for (const element of elements) parent.append(element); return parent; };
const button = (label, action, className = "") => {
  const element = h("button", className, label);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
};
const checkbox = (label, checked, action) => {
  const line = h("label", "toggle");
  const box = h("input"); box.type = "checkbox"; box.checked = checked;
  box.addEventListener("change", () => { action(box.checked); dirty(); });
  append(line, box, h("span", "", label));
  return line;
};
const section = (title, description) => {
  const element = h("section", "section");
  append(element, h("h2", "", title));
  if (description) element.append(h("p", "muted", description));
  return element;
};
const unique = (list) => [...new Set(list)];
const catalogModel = (ref) => state.catalog.models.find((model) => model.id === ref || model.id.split("#")[0] === ref.split("#")[0]);
const chain = () => state.agent ? (state.config.agents[state.agent] ||= []) : state.config.models;
const replaceChain = (list) => {
  if (state.agent) state.config.agents[state.agent] = unique(list);
  else state.config.models = unique(list);
  dirty(); render();
};
function dirty() { state.dirty = true; state.message = "Alterações não salvas"; }

async function load() {
  try {
    const { content } = await host.readFile(CONFIG);
    const parsed = JSON.parse(content);
    state.config = { ...structuredClone(defaults), ...parsed,
      agents: parsed.agents && typeof parsed.agents === "object" ? parsed.agents : {},
      providers: { ...defaults.providers, ...parsed.providers },
      integration: { ...defaults.integration, ...parsed.integration }
    };
  } catch (error) {
    if (error.code !== "NOT_FOUND") state.message = `Configuração: ${error.message}`;
  }
  try { state.catalog = JSON.parse((await host.readFile(CATALOG)).content); }
  catch { state.message ||= "Catálogo indisponível. Instale e inicialize primeiro o plugin OpenCode."; }
  state.loaded = true;
  render();
  void loadStatus();
}

async function loadStatus() {
  try { state.status = JSON.parse((await host.readFile(STATUS)).content); } catch { /* plugin offline */ }
  paintStatus();
}

function paintStatus() {
  const container = document.getElementById("quota-status");
  if (!container) return;
  container.replaceChildren();
  const now = Date.now();
  const active = (state.status.cooldowns || []).filter((cooldown) => cooldown.until > now);
  if (!active.length) container.append(h("p", "muted", "Nenhum cooldown registrado."));
  for (const entry of active) {
    const remaining = Math.ceil((entry.until - now) / 60000);
    const line = h("div", "row between");
    append(line, h("span", "", entry.group), h("span", "badge warn", `${remaining} min`));
    container.append(line);
  }
  const sessions = (state.status.sessions || []).length;
  container.append(h("small", "", `${sessions} sessão(ões) em fallback gerenciado.`));
}

async function save() {
  try {
    await host.writeFile(CONFIG, JSON.stringify(state.config, null, 2) + "\n");
    state.dirty = false; state.message = "Salvo! O OpenCode atualizará as regras automaticamente.";
    host.toast({ kind: "success", message: "Prioridades do Model Router salvas" });
  } catch (error) {
    state.message = `Falha ao salvar: ${error.message}`;
    host.toast({ kind: "error", message: state.message });
  }
  render();
}

function modelRow(ref, index, list) {
  const meta = catalogModel(ref);
  const item = h("div", "model");
  item.draggable = true;
  item.dataset.ref = ref;
  const info = h("div", "model-info");
  append(info, h("div", "model-name", meta?.name || ref), h("div", "model-id", ref));
  const badges = h("div", "row wrap");
  if (!meta) badges.append(h("span", "badge warn", "Ausente"));
  if (meta?.paid) badges.append(h("span", "badge", "API paga"));
  if (state.config.disabledModels.includes(ref)) badges.append(h("span", "badge warn", "Desligado"));
  info.append(badges);
  const controls = h("div", "row actions");
  const up = button("↑", () => { if (index) { const copy = [...list]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; replaceChain(copy); } }, "tiny");
  const down = button("↓", () => { if (index < list.length - 1) { const copy = [...list]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; replaceChain(copy); } }, "tiny");
  up.disabled = index === 0; down.disabled = index === list.length - 1;
  controls.append(up, down, button("×", () => replaceChain(list.filter((item) => item !== ref)), "tiny"));
  append(item, info, controls);
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", ref);
    event.dataTransfer.effectAllowed = "move";
    item.classList.add("dragging");
  });
  item.addEventListener("dragend", () => item.classList.remove("dragging"));
  item.addEventListener("dragover", (event) => { event.preventDefault(); item.classList.add("drop-target"); });
  item.addEventListener("dragleave", () => item.classList.remove("drop-target"));
  item.addEventListener("drop", (event) => {
    event.preventDefault(); item.classList.remove("drop-target");
    const source = event.dataTransfer.getData("text/plain");
    if (!list.includes(source) || source === ref) return;
    const result = list.filter((id) => id !== source);
    result.splice(result.indexOf(ref), 0, source);
    replaceChain(result);
  });
  return item;
}

function render() {
  if (!state.loaded) return;
  root.replaceChildren();
  const header = h("div", "head");
  const title = h("div"); append(title, h("h1", "", "Model Router"), h("small", "", "Prioridade, quotas e recuperação por agente"));
  append(header, title, h("span", "badge", "v0.1.0")); root.append(header);

  const status = section("Quotas observadas", "Bloqueios detectados por respostas reais dos provedores. Sem consultas de inferência para sondagem.");
  const statusContent = h("div", "stack"); statusContent.id = "quota-status"; status.append(statusContent); root.append(status);
  paintStatus();

  const master = section("Roteamento");
  master.append(checkbox("Habilitar fallback automático", state.config.enabled, (value) => { state.config.enabled = value; render(); }));
  master.append(checkbox("Respeitar escolha manual de modelo", state.config.respectManualSelection, (value) => { state.config.respectManualSelection = value; render(); }));
  root.append(master);

  const scope = section("Ordem de prioridade", "Cada agente pode ter sua lista própria. Agentes sem lista usam a prioridade global.");
  const select = h("select");
  const options = [{ id: "", name: "Global (padrão)" }, ...state.catalog.agents];
  for (const option of options) {
    const element = h("option", "", option.name || option.id);
    element.value = option.id;
    select.append(element);
  }
  if (state.agent && !options.some((a) => a.id === state.agent)) {
    const element = h("option", "", state.agent); element.value = state.agent; select.append(element);
  }
  select.value = state.agent;
  select.addEventListener("change", () => { state.agent = select.value; render(); });
  scope.append(select);
  const selected = [...chain()];
  const list = h("div", "model-list");
  selected.forEach((ref, index) => list.append(modelRow(ref, index, selected)));
  if (!selected.length) list.append(h("p", "muted", state.agent ? "Sem ordem própria; a prioridade global será utilizada." : "Adicione modelos do catálogo abaixo."));
  scope.append(list);
  if (state.agent && selected.length) scope.append(button("Usar ordem global", () => replaceChain([])));
  root.append(scope);

  const catalog = section("Modelos disponíveis", "Adicionar coloca o modelo no final da lista selecionada. Desabilitar impede seu uso em qualquer agente.");
  const search = h("input"); search.type = "search"; search.placeholder = "Buscar modelo ou provedor…"; search.value = state.filter;
  catalog.append(search);
  const results = h("div", "model-list"); catalog.append(results);
  const paintResults = () => {
    results.replaceChildren();
    const models = state.catalog.models.filter((model) => model.id.toLowerCase().includes(state.filter.toLowerCase()) || model.name?.toLowerCase().includes(state.filter.toLowerCase()));
    for (const model of models.slice(0, 100)) {
      const row = h("div", "model");
      const info = h("div", "model-info");
      append(info, h("div", "model-name", model.name), h("div", "model-id", model.id));
      const meta = h("div", "row wrap");
      if (model.paid) meta.append(h("span", "badge warn", "Pago"));
      if (!model.tools) meta.append(h("span", "badge warn", "Sem tools"));
      if (!model.enabled) meta.append(h("span", "badge warn", "Indisponível"));
      info.append(meta);
      const actions = h("div", "row actions");
      const added = chain().includes(model.id);
      const add = button(added ? "✓" : "+", () => replaceChain([...chain(), model.id]), "tiny");
      add.disabled = added || !model.enabled;
      const off = state.config.disabledModels.includes(model.id);
      const toggle = button(off ? "Ativar" : "Desligar", () => {
        state.config.disabledModels = off ? state.config.disabledModels.filter((id) => id !== model.id) : unique([...state.config.disabledModels, model.id]);
        dirty(); render();
      }, "tiny");
      append(actions, add, toggle);
      append(row, info, actions); results.append(row);
    }
    if (models.length > 100) results.append(h("small", "", "Mostrando os 100 primeiros. Refine a busca."));
    if (!models.length) results.append(h("p", "muted", "Nenhum modelo encontrado."));
  };
  search.addEventListener("input", () => { state.filter = search.value; paintResults(); });
  paintResults(); root.append(catalog);

  const safety = section("Custos e limites");
  safety.append(checkbox("Permitir modelos pagos via API (cuidado com cobranças)", state.config.allowPaid, (value) => { state.config.allowPaid = value; render(); }));
  safety.append(checkbox("Permitir modelos sem suporte a ferramentas", state.config.allowTextOnlyModels, (value) => { state.config.allowTextOnlyModels = value; render(); }));
  const subscribed = h("div", "stack");
  subscribed.append(h("small", "", "Modelos de assinatura/OAuth liberados sem cobrança por token na API (selecione somente os que você verificou):"));
  for (const ref of unique([...selected, ...state.config.subscriptionModels])) {
    if (!catalogModel(ref)?.paid) continue;
    subscribed.append(checkbox(ref, state.config.subscriptionModels.includes(ref), (checked) => {
      state.config.subscriptionModels = checked ? unique([...state.config.subscriptionModels, ref]) : state.config.subscriptionModels.filter((id) => id !== ref);
    }));
  }
  safety.append(subscribed);
  safety.append(checkbox("Consultar Codex app-server quando quota não informar reset", state.config.providers.codexStatusFallback === "app-server", (checked) => {
    state.config.providers.codexStatusFallback = checked ? "app-server" : "off"; render();
  }));
  const numberLine = h("label", "stack"); numberLine.append(h("span", "", "Cooldown de quota sem horário conhecido (segundos)"));
  const seconds = h("input"); seconds.type = "number"; seconds.min = "30"; seconds.max = "86400"; seconds.value = state.config.unknownQuotaCooldownSeconds;
  seconds.addEventListener("change", () => { state.config.unknownQuotaCooldownSeconds = Math.max(30, Math.min(86400, Number(seconds.value) || 900)); dirty(); });
  numberLine.append(seconds); safety.append(numberLine);
  root.append(safety);

  const alert = h("div", "notice");
  alert.textContent = "Oh My OpenCode Slim: desative somente o fallback interno (fallback.enabled: false) para evitar dois roteadores competindo. Context Mode pode permanecer ativo. O plugin não altera seus presets.";
  root.append(alert);
  const footer = h("div", "footer");
  append(footer, h("small", state.message.startsWith("Falha") ? "error" : "muted", state.message || (state.dirty ? "Alterações pendentes" : "Configuração carregada")), button("Salvar", () => void save(), "primary"));
  root.append(footer);
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  if (initialized) return;
  initialized = true;
  void load();
});
setInterval(() => { if (initialized && state.loaded) void loadStatus(); }, 10000);
window.addEventListener("beforeunload", () => host.dispose());
