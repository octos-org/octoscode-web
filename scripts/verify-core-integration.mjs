import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeContract = JSON.parse(
  await readFile(resolve(root, "packages/client/core-runtime.json"), "utf8"),
);
const binary = process.env.OCTOS_BINARY?.trim();

async function main() {
  if (!binary) {
    throw new Error(
      "OCTOS_BINARY must point to the pinned Octos release binary",
    );
  }
  validateRuntimeContract(runtimeContract);

  const { stdout: versionOutput } = await execFileAsync(binary, ["--version"]);
  const expectedVersion = `octos ${runtimeContract.version}`;
  const expectedRevision = runtimeContract.revision.slice(0, 7);
  if (
    !versionOutput.includes(expectedVersion) ||
    !versionOutput.includes(expectedRevision)
  ) {
    throw new Error(
      `Octos binary mismatch: expected ${expectedVersion} (${expectedRevision}), received ${versionOutput.trim()}`,
    );
  }

  const runRoot = await mkdtemp(join(tmpdir(), "octoscode-web-integration-"));
  const dataDir = join(runRoot, "state");
  const workspacePath = join(runRoot, "workspace");
  await mkdir(dataDir);
  await mkdir(workspacePath);
  const workspaceDir = await realpath(workspacePath);
  await writeFile(
    join(workspaceDir, "package.json"),
    '{"name":"octoscode-web-core-smoke","private":true}\n',
  );
  const port = await reservePort();
  const provider = await startProviderFixture();
  const token = `octoscode-web-${randomBytes(18).toString("hex")}`;
  const profileId = "octoscode-web-ci";
  const sessionId = `${profileId}:local:tui#coding`;
  const output = { stdout: "", stderr: "" };
  const child = execFile(
    binary,
    [
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--cwd",
      workspaceDir,
      "--data-dir",
      dataDir,
      "--auth-token",
      token,
      "--solo",
      "--no-network",
    ],
    {
      cwd: workspaceDir,
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 1024 * 1024,
    },
  );
  capture(child.stdout, output, "stdout");
  capture(child.stderr, output, "stderr");

  let socket;
  let succeeded = false;
  try {
    const health = await waitForHealth(port, child);
    assertEqual(health.status, "healthy", "health.status");
    assertEqual(health.service, "octos", "health.service");
    assert(
      typeof health.version === "string" &&
        health.version.startsWith(runtimeContract.version),
      `health.version must start with ${runtimeContract.version}`,
    );

    socket = await RpcSocket.connect(
      port,
      token,
      runtimeContract.required_web_features,
    );
    const beforeCapabilities = capabilitiesFrom(
      await socket.request("config/capabilities/list", {}),
    );
    assertProtocol(beforeCapabilities);
    assertIncludesAll(
      beforeCapabilities.supported_features,
      runtimeContract.required_web_features,
      "negotiated feature",
    );
    assertIncludesAll(
      beforeCapabilities.supported_methods,
      runtimeContract.required_solo_onboarding_methods,
      "solo bootstrap method",
    );

    const catalog = await socket.request("profile/llm/catalog", {});
    assert(
      Object.keys(asRecord(catalog.families, "LLM catalog families")).length >
        0,
      "LLM catalog has no provider families",
    );

    const emptyLaunch = await socket.request("launch/resolve", {
      cwd: workspaceDir,
    });
    assertEqual(emptyLaunch.decision, "no_profile", "empty launch decision");

    const created = await socket.request("profile/local/create", {
      requested_id: profileId,
      name: "Octoscode Web CI",
      username: "",
      email: "",
      make_default: true,
    });
    assertEqual(created.profile_id, profileId, "created profile id");

    const llmProvision = {
      profile_id: profileId,
      selection: {
        family_id: "custom",
        model_id: "octoscode-web-ci-smoke",
        route: {
          route_id: "custom",
          base_url: provider.baseUrl,
          api_key_env: "OCTOSCODE_WEB_CI_API_KEY",
          api_type: "openai",
        },
      },
      api_key: "sk-integration-placeholder-not-a-secret",
    };
    const tested = await socket.request("profile/llm/test", llmProvision);
    assertEqual(tested.profile_id, profileId, "tested profile id");
    assertEqual(tested.applied, true, "provider test result");
    assert(
      provider.requests > 0,
      "profile/llm/test did not reach the provider fixture",
    );

    const saved = await socket.request("profile/llm/upsert", {
      ...llmProvision,
      set_primary: true,
    });
    assertEqual(saved.profile_id, profileId, "saved profile id");
    assertEqual(saved.applied, true, "provider save result");

    const launch = await socket.request("launch/resolve", {
      cwd: workspaceDir,
      profile_id: profileId,
    });
    assert(
      launch.decision === "activate" || launch.decision === "resume",
      `configured launch decision was ${JSON.stringify(launch.decision)}`,
    );
    assertEqual(launch.resolved_profile, profileId, "resolved profile");

    const openedResult = await socket.request("session/open", {
      session_id: sessionId,
      profile_id: profileId,
      cwd: workspaceDir,
    });
    const opened = asRecord(openedResult.opened, "session/open opened");
    assertEqual(opened.session_id, sessionId, "opened session id");
    assertEqual(opened.active_profile_id, profileId, "active profile id");
    assertEqual(opened.workspace_root, workspaceDir, "workspace root");
    const openedCapabilities = asRecord(
      opened.capabilities,
      "session/open capabilities",
    );
    assertProtocol(openedCapabilities);
    assertIncludesAll(
      openedCapabilities.supported_methods,
      runtimeContract.required_web_methods,
      "required Web method",
    );

    const hydrated = await socket.request("session/hydrate", {
      session_id: sessionId,
      include: ["messages", "threads", "turns", "pending_approvals"],
    });
    assertEqual(hydrated.session_id, sessionId, "hydrated session id");
    for (const field of [
      "messages",
      "threads",
      "turns",
      "pending_approvals",
      "pending_questions",
    ]) {
      assert(
        Array.isArray(hydrated[field]),
        `session/hydrate ${field} is not an array`,
      );
    }

    const permissions = await socket.request("permission/profile/list", {
      session_id: sessionId,
    });
    assertEqual(permissions.session_id, sessionId, "permission session id");
    assert(
      Array.isArray(permissions.profiles),
      "permission profiles are not an array",
    );
    assert(
      permissions.profiles.length >= 3,
      "permission profiles are incomplete",
    );

    const status = await socket.request("session/status/read", {
      session_id: sessionId,
    });
    assertEqual(status.session_id, sessionId, "status session id");
    assertEqual(status.profile_id, profileId, "status profile id");
    assertEqual(status.health?.status, "ok", "session health");

    await requestUntilReady(socket, "task/list", { session_id: sessionId });

    const forwardAvailable = runtimeContract.forward_compatible_methods.filter(
      (method) => openedCapabilities.supported_methods.includes(method),
    );
    process.stdout.write(
      `Verified ${runtimeContract.tag} (${expectedRevision}) through real octos serve: ` +
        `health, negotiation, no-profile launch, profile/catalog/test/save, exact TUI session open, ` +
        `hydrate, permissions, supervision and status. Forward methods: ` +
        `${forwardAvailable.length ? forwardAvailable.join(", ") : "not advertised by this release"}.\n`,
    );
    succeeded = true;
  } catch (reason) {
    const safeToken = "[redacted]";
    const logs = `${output.stdout}\n${output.stderr}`
      .replaceAll(token, safeToken)
      .slice(-24_000);
    process.stderr.write(`\nPinned Core server log tail:\n${logs}\n`);
    throw reason;
  } finally {
    socket?.close();
    await stopChild(child);
    await provider.close();
    if (succeeded) await safeRemoveRunRoot(runRoot);
    else process.stderr.write(`Integration state retained at ${runRoot}\n`);
  }
}

class RpcSocket {
  static async connect(port, token, features) {
    const url = new URL(`ws://127.0.0.1:${port}/api/ui-protocol/ws`);
    url.searchParams.set("token", token);
    for (const feature of features)
      url.searchParams.append("ui_feature", feature);
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(
        () => rejectPromise(new Error("WebSocket connection timed out")),
        10_000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolvePromise();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          rejectPromise(new Error("WebSocket connection failed"));
        },
        { once: true },
      );
    });
    return new RpcSocket(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => this.receive(event.data));
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Octos UI Protocol connection closed"));
        clearTimeout(pending.timeout);
      }
      this.pending.clear();
    });
  }

  request(method, params) {
    const id = String(this.nextId++);
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`${method} timed out`));
      }, 20_000);
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timeout,
      });
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  async receive(data) {
    const text =
      typeof data === "string" ? data : await new Blob([data]).text();
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      throw new Error("Octos Core smoke received invalid JSON");
    }
    if (!message || typeof message !== "object") return;
    if (typeof message.id !== "string") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) {
      const error = new Error(message.error.message || "Octos RPC failed");
      error.code = message.error.code;
      error.data = message.error.data;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  close() {
    if (this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close(1000, "integration complete");
    }
  }
}

async function requestUntilReady(socket, method, params) {
  const deadline = Date.now() + 20_000;
  let latest;
  while (Date.now() < deadline) {
    try {
      const result = await socket.request(method, params);
      assert(Array.isArray(result.tasks), `${method} tasks are not an array`);
      return result;
    } catch (reason) {
      latest = reason;
      if (reason?.data?.kind !== "runtime_unavailable") throw reason;
      await delay(400);
    }
  }
  throw new Error(`${method} did not become ready`, { cause: latest });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`octos serve exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return await response.json();
    } catch {
      // Startup owns several stores; transient connection refusal is expected.
    }
    await delay(200);
  }
  throw new Error("octos serve did not become healthy within 60 seconds");
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("could not reserve a loopback port");
  }
  const port = address.port;
  await new Promise((resolvePromise, rejectPromise) =>
    server.close((reason) =>
      reason ? rejectPromise(reason) : resolvePromise(),
    ),
  );
  return port;
}

async function startProviderFixture() {
  let requests = 0;
  const server = createHttpServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests += 1;
      const valid =
        request.method === "POST" &&
        request.url === "/v1/chat/completions" &&
        request.headers.authorization ===
          "Bearer sk-integration-placeholder-not-a-secret" &&
        body.includes("octoscode-web-ci-smoke");
      if (!valid) {
        response
          .writeHead(400, { "content-type": "application/json" })
          .end('{"error":{"message":"invalid integration request"}}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "chatcmpl-octoscode-web",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1_000),
          model: "octoscode-web-ci-smoke",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "OK" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 2,
            completion_tokens: 1,
            total_tokens: 3,
          },
        }),
      );
    });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address !== "string", "provider fixture address");
  return {
    get requests() {
      return requests;
    },
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise((resolvePromise, rejectPromise) =>
        server.close((error) =>
          error ? rejectPromise(error) : resolvePromise(),
        ),
      ),
  };
}

function capture(stream, output, key) {
  stream?.on("data", (chunk) => {
    output[key] = `${output[key]}${chunk.toString()}`.slice(-128_000);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGINT");
  const exited = await Promise.race([
    new Promise((resolvePromise) =>
      child.once("exit", () => resolvePromise(true)),
    ),
    delay(10_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => child.once("exit", resolvePromise)),
      delay(5_000),
    ]);
  }
}

async function safeRemoveRunRoot(runRoot) {
  const expectedPrefix = join(tmpdir(), "octoscode-web-integration-");
  if (!runRoot.startsWith(expectedPrefix)) {
    throw new Error(
      `refusing to remove unexpected integration path ${runRoot}`,
    );
  }
  await rm(runRoot, { recursive: true, force: true });
}

function capabilitiesFrom(result) {
  return asRecord(result.capabilities, "config/capabilities/list capabilities");
}

function assertProtocol(capabilities) {
  const version = asRecord(capabilities.version, "protocol version");
  assertEqual(version.protocol, "octos-ui/v1alpha1", "protocol");
  assertEqual(version.schema_version, 1, "protocol schema");
  assertEqual(version.jsonrpc, "2.0", "JSON-RPC version");
  assertEqual(
    capabilities.capabilities_schema_version,
    2,
    "capabilities schema",
  );
  assert(
    Array.isArray(capabilities.supported_methods),
    "supported_methods is not an array",
  );
  assert(
    Array.isArray(capabilities.supported_features),
    "supported_features is not an array",
  );
}

function assertIncludesAll(received, expected, label) {
  assert(Array.isArray(received), `${label} source is not an array`);
  const missing = expected.filter((value) => !received.includes(value));
  assert(missing.length === 0, `missing ${label}s: ${missing.join(", ")}`);
}

function asRecord(value, label) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} is not an object`,
  );
  return value;
}

function assertEqual(actual, expected, label) {
  assert(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateRuntimeContract(value) {
  asRecord(value, "core-runtime.json");
  assertEqual(value.schema_version, 1, "runtime contract schema");
  assert(/^v\d+\.\d+\.\d+/.test(value.tag), "runtime tag is invalid");
  assert(/^[0-9a-f]{40}$/.test(value.revision), "runtime revision is invalid");
  assert(
    Array.isArray(value.required_web_methods),
    "required_web_methods is invalid",
  );
  assert(
    Array.isArray(value.required_web_features),
    "required_web_features is invalid",
  );
  assert(
    Array.isArray(value.required_solo_onboarding_methods),
    "required_solo_onboarding_methods is invalid",
  );
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

await main();
