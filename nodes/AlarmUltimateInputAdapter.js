"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch (_err) {
    return [];
  }
}

function loadBuiltinPresets() {
  const presetsDir = path.join(__dirname, "presets", "input-adapter");
  const files = safeReadDir(presetsDir)
    .filter((f) => f.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b));

  const presets = [];
  for (const file of files) {
    const fullPath = path.join(presetsDir, file);
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(fullPath);
      const preset = mod && typeof mod === "object" ? mod : null;
      if (!preset) continue;
      if (typeof preset.id !== "string" || preset.id.trim().length === 0) continue;
      if (typeof preset.name !== "string" || preset.name.trim().length === 0) continue;
      if (typeof preset.code !== "string" || preset.code.trim().length === 0) continue;
      presets.push({
        id: preset.id.trim(),
        name: preset.name.trim(),
        description: typeof preset.description === "string" ? preset.description.trim() : "",
        code: preset.code,
      });
    } catch (_err) {
      // ignore broken preset files
    }
  }
  return presets;
}

function buildContextApi(node) {
  const nodeCtx = node.context();
  const flowCtx = node.context().flow;
  const globalCtx = node.context().global;

  function wrap(ctx) {
    return {
      get: (key) => ctx.get(key),
      set: (key, value) => ctx.set(key, value),
    };
  }

  return {
    node: wrap(nodeCtx),
    flow: wrap(flowCtx),
    global: wrap(globalCtx),
  };
}

module.exports = function (RED) {
  const builtins = loadBuiltinPresets();
  const builtinById = new Map(builtins.map((p) => [p.id, p]));

  if (RED && RED.httpAdmin && typeof RED.httpAdmin.get === "function") {
    const needsRead =
      RED.auth && typeof RED.auth.needsPermission === "function"
        ? RED.auth.needsPermission("AlarmUltimateInputAdapter.read")
        : (req, res, next) => next();

    RED.httpAdmin.get("/alarm-ultimate/input-adapter/presets", needsRead, (_req, res) => {
      res.json({ presets: builtins });
    });
  }

  function AlarmUltimateInputAdapter(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const REDUtil = RED.util;

    const presetSource = config.presetSource === "user" ? "user" : "builtin";
    const presetId =
      typeof config.presetId === "string" && config.presetId.trim().length > 0
        ? config.presetId.trim()
        : "passthrough";
    const userCode = typeof config.userCode === "string" ? config.userCode : "";

    const preset =
      presetSource === "user"
        ? {
            id: "custom",
            name: "Custom",
            code: userCode,
          }
        : builtinById.get(presetId);
    const sandbox = {
      msg: null,
      context: buildContextApi(node),
      log: (...args) => node.log(args.map(String).join(" ")),
      warn: (...args) => node.warn(args.map(String).join(" ")),
      error: (...args) => node.error(args.map(String).join(" ")),
      fn: null,
      result: undefined,
    };
    const vmContext = vm.createContext(sandbox);

    function compile(code) {
      const body = String(code || "").trim();
      if (!body) return null;
      const fnScript = new vm.Script(
        `fn = (function (msg, context, log, warn, error) { "use strict";\n${body}\n});`,
      );
      fnScript.runInContext(vmContext, { timeout: 250 });
      const callScript = new vm.Script(
        `result = fn(msg, context, log, warn, error);`,
      );
      return { callScript };
    }

    let compiled = null;
    try {
      if (!preset || typeof preset.code !== "string" || preset.code.trim().length === 0) {
        node.status({
          fill: "red",
          shape: "ring",
          text: presetSource === "user" ? "missing user code" : "preset not found",
        });
      } else {
        compiled = compile(preset.code);
        node.status({
          fill: "green",
          shape: "dot",
          text: presetSource === "user" ? "preset: custom" : `preset: ${preset.name}`,
        });
      }
    } catch (err) {
      node.status({ fill: "red", shape: "dot", text: "invalid preset" });
      node.error(err);
    }

    node.on("input", (msg, send, done) => {
      const doSend = send || ((m) => node.send(m));
      if (!compiled) {
        if (done) done();
        return;
      }

      try {
        sandbox.msg = msg ? REDUtil.cloneMessage(msg) : {};
        sandbox.result = undefined;
        compiled.callScript.runInContext(vmContext, { timeout: 100 });
        const out = sandbox.result;

        if (out === undefined || out === null) {
          if (done) done();
          return;
        }

        if (Array.isArray(out)) {
          out.filter(Boolean).forEach((m, idx) => {
            if (idx === 0) doSend(m);
            else doSend(REDUtil.cloneMessage(m));
          });
          if (done) done();
          return;
        }

        if (typeof out === "object") {
          doSend(out);
          if (done) done();
          return;
        }

        doSend({ ...(msg || {}), payload: out });
        if (done) done();
      } catch (err) {
        node.status({ fill: "red", shape: "dot", text: "transform error" });
        node.error(err, msg);
        if (done) done(err);
      }
    });
  }

  RED.nodes.registerType("AlarmUltimateInputAdapter", AlarmUltimateInputAdapter);
};
