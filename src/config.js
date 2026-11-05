import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const CONFIG_FILE = join(homedir(), ".config", "opencode", "model-router.json");
export const CATALOG_FILE = join(homedir(), ".config", "opencode", "model-router-catalog.json");
export const STATUS_FILE = join(homedir(), ".config", "opencode", "model-router-status.json");

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  allowPaid: false,
  allowTextOnlyModels: false,
  respectManualSelection: true,
  safetyMarginMs: 5000,
  unknownQuotaCooldownSeconds: 900,
  maxSwitchesPerTurn: 8,
  models: [],
  subscriptionModels: [],
  agents: {},
  disabledModels: [],
  quotaGroups: {},
  providers: { codexStatusFallback: "off" },
  integration: { slimFallbackDisabled: false }
});

const validID = (v) => typeof v === "string" && v.length > 2 && v.length < 240 && v.includes("/") && !/[\s\u0000-\u001f]/.test(v);
const cleanList = (v) => Array.isArray(v) ? [...new Set(v.filter(validID))].slice(0, 200) : [];

export function normalizeConfig(input = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const agents = {};
  if (raw.agents && typeof raw.agents === "object" && !Array.isArray(raw.agents)) {
    for (const [name, models] of Object.entries(raw.agents).slice(0, 150)) {
      if (/^[\w.-]{1,100}$/.test(name)) agents[name] = cleanList(models);
    }
  }
  const quotaGroups = {};
  if (raw.quotaGroups && typeof raw.quotaGroups === "object") {
    for (const [id, group] of Object.entries(raw.quotaGroups)) {
      if (validID(id) && typeof group === "string" && /^[\w.-]{1,100}$/.test(group)) quotaGroups[id] = group;
    }
  }
  return {
    enabled: raw.enabled !== false,
    allowPaid: raw.allowPaid === true,
    allowTextOnlyModels: raw.allowTextOnlyModels === true,
    respectManualSelection: raw.respectManualSelection !== false,
    safetyMarginMs: Number.isInteger(raw.safetyMarginMs) ? Math.max(0, Math.min(60_000, raw.safetyMarginMs)) : 5000,
    unknownQuotaCooldownSeconds: Number.isInteger(raw.unknownQuotaCooldownSeconds) ? Math.max(30, Math.min(86400, raw.unknownQuotaCooldownSeconds)) : 900,
    maxSwitchesPerTurn: Number.isInteger(raw.maxSwitchesPerTurn) ? Math.max(1, Math.min(50, raw.maxSwitchesPerTurn)) : 8,
    models: cleanList(raw.models),
    subscriptionModels: cleanList(raw.subscriptionModels),
    agents,
    disabledModels: cleanList(raw.disabledModels),
    quotaGroups,
    providers: { codexStatusFallback: ["off", "app-server"].includes(raw.providers?.codexStatusFallback) ? raw.providers.codexStatusFallback : "off" },
    integration: { slimFallbackDisabled: raw.integration?.slimFallbackDisabled === true }
  };
}

export async function loadConfig(file = CONFIG_FILE) {
  try {
    return normalizeConfig(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("[model-router] Config inválida: mantendo padrões seguros.");
    return normalizeConfig();
  }
}

export async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, file);
  } catch (error) {
    try { const { unlink } = await import("node:fs/promises"); await unlink(tmp); } catch { /* already removed */ }
    throw error;
  }
}

export function createConfigMonitor(file = CONFIG_FILE, onChange = () => {}) {
  let previous = "";
  return async () => {
    let stamp = "missing";
    try { const s = await stat(file); stamp = `${s.mtimeMs}-${s.size}`; } catch { /* missing */ }
    if (stamp === previous) return false;
    previous = stamp;
    await onChange(await loadConfig(file));
    return true;
  };
}
