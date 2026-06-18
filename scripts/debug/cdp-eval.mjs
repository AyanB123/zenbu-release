#!/usr/bin/env node
const args = process.argv.slice(2);

function argValue(name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

const port = Number(argValue("--port", "9222"));
const timeoutMs = Number(argValue("--timeout-ms", "15000"));
const listOnly = args.includes("--list");
const smoke = args.includes("--smoke");
const expression = argValue("--expression", null);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid --port: ${port}`);
}
if (!listOnly && !smoke && !expression) {
  throw new Error("Use --list, --smoke, or --expression <javascript>");
}
if (typeof WebSocket !== "function") {
  throw new Error("This Node runtime does not expose global WebSocket");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function chooseTarget(targets) {
  const pages = targets.filter((target) => target.webSocketDebuggerUrl && target.type === "page");
  return pages.find((target) => /localhost|zenbu|workspace/i.test(`${target.url} ${target.title}`)) ?? pages[0] ?? targets.find((target) => target.webSocketDebuggerUrl);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error("Timed out connecting to CDP target")), timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    }, { once: true });
    socket.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(event.message ?? "WebSocket error"));
    }, { once: true });
  });
}

async function evaluate(target, source) {
  const socket = await connect(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} timed out`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
    else item.resolve(message.result);
  });

  try {
    await send("Runtime.enable");
    const result = await send("Runtime.evaluate", {
      expression: source,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
    return result;
  } finally {
    socket.close();
  }
}

const smokeExpression = `(() => {
  const bodyText = document.body?.innerText ?? "";
  const errors = [...document.querySelectorAll('[role="alert"], .error, [data-error]')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .slice(0, 20);
  return {
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    nodeCount: document.querySelectorAll('*').length,
    bodyText: bodyText.slice(0, 3000),
    errors,
    dimensions: { width: innerWidth, height: innerHeight, devicePixelRatio },
    memory: performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null,
  };
})()`;

const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
if (listOnly) {
  console.log(JSON.stringify({ port, targets }, null, 2));
  process.exit(0);
}

const target = chooseTarget(targets);
if (!target) throw new Error(`No debuggable CDP target found on port ${port}`);
const result = await evaluate(target, smoke ? smokeExpression : expression);
console.log(JSON.stringify({ port, target: { id: target.id, title: target.title, url: target.url, type: target.type }, result }, null, 2));
