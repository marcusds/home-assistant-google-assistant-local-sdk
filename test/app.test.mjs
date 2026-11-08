// Runs the compiled app.js in a sandbox with a mocked `smarthome` global.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const APP_JS = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

const ErrorCode = {
  NOT_SUPPORTED: "NOT_SUPPORTED",
  INVALID_REQUEST: "INVALID_REQUEST",
  GENERIC_ERROR: "GENERIC_ERROR",
  DEVICE_NOT_IDENTIFIED: "DEVICE_NOT_IDENTIFIED",
  DEVICE_NOT_SUPPORTED: "DEVICE_NOT_SUPPORTED",
  DEVICE_VERIFICATION_FAILED: "DEVICE_VERIFICATION_FAILED",
};

class HandlerError extends Error {
  constructor(requestId, errorCode, debugString) {
    super(debugString);
    this.requestId = requestId;
    this.errorCode = errorCode;
    this.debugString = debugString;
  }
}
class DeviceNotIdentifiedError extends HandlerError {
  constructor(requestId, debugString) {
    super(requestId, ErrorCode.DEVICE_NOT_IDENTIFIED, debugString);
  }
}
class DeviceNotSupportedError extends HandlerError {
  constructor(requestId, debugString) {
    super(requestId, ErrorCode.DEVICE_NOT_SUPPORTED, debugString);
  }
}
class InvalidRequestError extends HandlerError {
  constructor(requestId, debugString) {
    super(requestId, ErrorCode.INVALID_REQUEST, debugString);
  }
}

const CUSTOM_DATA = { webhookId: "hook123", httpPort: 8123, uuid: "uuid-1" };
const PROXY_DEVICE = {
  id: "proxy",
  scanData: { mdnsScanData: { texts: ["version=2026.11.0", "uuid=uuid-1"] } },
};
const HA_DEVICE = { id: "light.kitchen", customData: CUSTOM_DATA };

/**
 * Load app.js with a mocked SDK. `responses` is a list of HTTP bodies (or
 * Errors to throw) returned by successive deviceManager.send calls.
 */
function loadApp(responses) {
  const handlers = {};
  const sent = [];
  const deviceManager = {
    getRegisteredDevices: () => [PROXY_DEVICE, HA_DEVICE],
    async send(command, options) {
      sent.push({ command, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { httpResponse: { statusCode: 200, body: next } };
    },
  };
  class App {
    constructor(version) {
      this.version = version;
    }
    getDeviceManager() {
      return deviceManager;
    }
    listen() {
      return Promise.resolve();
    }
  }
  for (const name of [
    "Identify",
    "ReachableDevices",
    "Query",
    "Execute",
    "ProxySelected",
  ]) {
    App.prototype[`on${name}`] = function (handler) {
      handlers[name] = handler;
      return this;
    };
  }

  const smarthome = {
    App,
    Intents: {
      EXECUTE: "action.devices.EXECUTE",
      IDENTIFY: "action.devices.IDENTIFY",
      PROXY_SELECTED: "action.devices.PROXY_SELECTED",
      QUERY: "action.devices.QUERY",
      REACHABLE_DEVICES: "action.devices.REACHABLE_DEVICES",
    },
    Constants: { HttpOperation: { GET: "GET", POST: "POST", PUT: "PUT" } },
    DataFlow: { HttpRequestData: class {} },
    IntentFlow: {
      ErrorCode,
      HandlerError,
      DeviceNotIdentifiedError,
      DeviceNotSupportedError,
      InvalidRequestError,
    },
  };
  const quiet = { log() {}, error() {} };
  vm.runInNewContext(APP_JS, { smarthome, console: quiet, setTimeout });
  return { handlers, sent };
}

const identifyRequest = (mdns) => ({
  requestId: "req-identify",
  inputs: [{ intent: "action.devices.IDENTIFY", payload: { device: mdns } }],
});

const HA_MDNS = {
  mdnsScanData: {
    serviceName: "home._home-assistant._tcp.local",
    data: ["version=2026.11.0"],
    txt: { uuid: "uuid-1" },
  },
};

const queryRequest = {
  requestId: "req-query",
  inputs: [
    {
      intent: "action.devices.QUERY",
      payload: { devices: [{ id: "light.kitchen" }] },
    },
  ],
};

const executeRequest = {
  requestId: "req-execute",
  inputs: [
    {
      intent: "action.devices.EXECUTE",
      payload: { commands: [{ devices: [{ id: "light.kitchen" }] }] },
    },
  ],
};

test("forwards QUERY to the HA webhook with SDK retries", async () => {
  const { handlers, sent } = loadApp([JSON.stringify({ requestId: "x" })]);
  const res = await handlers.Query(queryRequest);
  assert.equal(res.requestId, "x");
  assert.equal(sent.length, 1);
  const { command, options } = sent[0];
  assert.equal(command.path, "/api/webhook/hook123");
  assert.equal(command.port, 8123);
  assert.equal(command.deviceId, "light.kitchen");
  assert.equal(command.additionalHeaders["HA-Cloud-Version"], VERSION);
  assert.deepEqual(JSON.parse(command.data), queryRequest);
  assert.equal(options.retries, 2);
});

test("EXECUTE is sent without retries", async () => {
  const { handlers, sent } = loadApp([JSON.stringify({ requestId: "x" })]);
  await handlers.Execute(executeRequest);
  assert.equal(sent[0].options, undefined);
});

test("empty body on QUERY is retried once after a delay", async () => {
  const { handlers, sent } = loadApp(["", JSON.stringify({ ok: true })]);
  const start = Date.now();
  const res = await handlers.Query(queryRequest);
  assert.equal(res.ok, true);
  assert.equal(sent.length, 2);
  assert.ok(Date.now() - start >= 400, "retry should be delayed");
});

test("empty body twice gives a GENERIC_ERROR", async () => {
  const { handlers } = loadApp(["", ""]);
  await assert.rejects(handlers.Query(queryRequest), (err) => {
    assert.equal(err.errorCode, ErrorCode.GENERIC_ERROR);
    assert.match(err.debugString, /Webhook not registered/);
    return true;
  });
});

test("empty body on EXECUTE is not retried", async () => {
  const { handlers, sent } = loadApp([""]);
  await assert.rejects(handlers.Execute(executeRequest));
  assert.equal(sent.length, 1);
});

test("invalid JSON gives a GENERIC_ERROR", async () => {
  const { handlers } = loadApp(["not json"]);
  await assert.rejects(
    handlers.Query(queryRequest),
    (err) => err.errorCode === ErrorCode.GENERIC_ERROR
  );
});

test("IDENTIFY forwards a Home Assistant device", async () => {
  const { handlers, sent } = loadApp([JSON.stringify({ requestId: "id" })]);
  const res = await handlers.Identify(identifyRequest(HA_MDNS));
  assert.equal(res.requestId, "id");
  assert.equal(sent[0].command.deviceId, "");
});

test("IDENTIFY rejects a device without mDNS data", async () => {
  const { handlers, sent } = loadApp([]);
  await assert.rejects(handlers.Identify(identifyRequest({})), (err) => {
    assert.ok(err instanceof DeviceNotIdentifiedError);
    return true;
  });
  assert.equal(sent.length, 0);
});

test("IDENTIFY rejects a non Home Assistant service", async () => {
  const { handlers } = loadApp([]);
  const mdns = {
    mdnsScanData: { ...HA_MDNS.mdnsScanData, serviceName: "x._http._tcp.local" },
  };
  await assert.rejects(
    handlers.Identify(identifyRequest(mdns)),
    (err) => err instanceof DeviceNotIdentifiedError
  );
});

test("IDENTIFY rejects a UUID mismatch", async () => {
  const { handlers } = loadApp([]);
  const mdns = {
    mdnsScanData: { ...HA_MDNS.mdnsScanData, txt: { uuid: "other" } },
  };
  await assert.rejects(handlers.Identify(identifyRequest(mdns)), (err) => {
    assert.equal(err.errorCode, ErrorCode.DEVICE_VERIFICATION_FAILED);
    assert.match(err.debugString, /HA\/2026\.11\.0/);
    return true;
  });
});
