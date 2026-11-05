import { spawn } from "node:child_process";

/** Read Codex quota through its documented app-server RPC, not `codex exec /status`. */
export async function readCodexStatus({ command = "codex", timeoutMs = 5000, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let child, timer, done = false, buffer = "", byteCount = 0;
    const finish = (answer = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child?.kill(); } catch { /* exited */ }
      resolve(answer);
    };
    const send = (message) => { try { child.stdin.write(JSON.stringify(message) + "\n"); } catch { finish(); } };
    const consume = (line) => {
      let rpc;
      try { rpc = JSON.parse(line); } catch { return; }
      if (rpc.id === 1) {
        if (rpc.error) return finish();
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read", params: { excludeResetCreditDetails: true } });
      } else if (rpc.id === 2) {
        if (rpc.error || !rpc.result) return finish();
        const data = rpc.result;
        const buckets = data.rateLimitsByLimitId && typeof data.rateLimitsByLimitId === "object"
          ? Object.values(data.rateLimitsByLimitId) : [data.rateLimits];
        const now = Date.now();
        const resets = [];
        for (const bucket of buckets) {
          for (const kind of ["primary", "secondary"]) {
            const w = bucket?.[kind];
            if (Number(w?.usedPercent) >= 100 && Number.isFinite(Number(w?.resetsAt))) {
              const at = Number(w.resetsAt) * 1000;
              if (at > now) resets.push(at);
            }
          }
        }
        finish(resets.length ? Math.max(...resets) : null);
      }
    };
    try { child = spawnImpl(command, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "ignore"], shell: false }); }
    catch { return finish(); }
    timer = setTimeout(() => finish(), timeoutMs);
    timer.unref?.();
    child.on("error", () => finish());
    child.on("close", () => finish());
    child.stdin.on("error", () => finish());
    child.stdout.on("error", () => finish());
    child.stdout.on("data", (bytes) => {
      if (done || (byteCount += bytes.length) > 512 * 1024) return finish();
      buffer += bytes.toString("utf8");
      while (!done && buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) consume(line);
      }
    });
    send({ id: 1, method: "initialize", params: {
      clientInfo: { name: "opencode-model-router", title: "Model Router", version: "0.1.0" }, capabilities: {}
    } });
  });
}
