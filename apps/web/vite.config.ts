import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import { SUPPORTED_OCTOS_CONTRACT } from "../../packages/client/src/contract.ts";
import coreRuntime from "../../packages/client/core-runtime.json" with { type: "json" };

const VERIFIED_CORE_RUNTIME = {
  repository: coreRuntime.repository,
  tag: coreRuntime.tag,
  version: coreRuntime.version,
  revision: coreRuntime.revision,
  required_web_methods: coreRuntime.required_web_methods,
  required_web_features: coreRuntime.required_web_features,
  required_solo_onboarding_methods:
    coreRuntime.required_solo_onboarding_methods,
  forward_compatible_methods: coreRuntime.forward_compatible_methods,
};

function releaseValue(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

const packageFile = (name: string, file: string) =>
  join(
    dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)),
    file,
  );

// Files loaded at run time by path, so they keep their own names inside one
// directory named for a hash of its contents (immutable under /assets/).
// pdfjs: the decoders pdf.js 6 imports for CCITT, JBIG2 and JPEG 2000 images
// when WebAssembly is off; without them those scans render blank (T-0567).
// ocr: Tesseract.js for local text recognition (T-0568). The core finds its
// .wasm beside worker.min.js, and deploy/nginx.conf lets only this directory
// compile WebAssembly. probe.js tells the page whether that policy is there.
const STATIC_ASSET_GROUPS = {
  pdfjs: {
    "jbig2_nowasm_fallback.js": packageFile(
      "pdfjs-dist",
      "wasm/jbig2_nowasm_fallback.js",
    ),
    "openjpeg_nowasm_fallback.js": packageFile(
      "pdfjs-dist",
      "wasm/openjpeg_nowasm_fallback.js",
    ),
  },
  ocr: {
    "worker.min.js": packageFile("tesseract.js", "dist/worker.min.js"),
    "tesseract-core-simd-lstm.js": packageFile(
      "tesseract.js-core",
      "tesseract-core-simd-lstm.js",
    ),
    "tesseract-core-simd-lstm.wasm": packageFile(
      "tesseract.js-core",
      "tesseract-core-simd-lstm.wasm",
    ),
    "eng.traineddata.gz": packageFile(
      "@tesseract.js-data/eng",
      "4.0.0_best_int/eng.traineddata.gz",
    ),
    "chi_sim.traineddata.gz": packageFile(
      "@tesseract.js-data/chi_sim",
      "4.0.0_best_int/chi_sim.traineddata.gz",
    ),
    "probe.js": Buffer.from(
      "WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])).then(()=>postMessage(true),()=>postMessage(false));\n",
    ),
  },
} satisfies Record<string, Record<string, string | Buffer>>;

function staticAssets(): Plugin {
  const files = new Map<string, Buffer>();
  const directories: Record<string, string> = {};
  for (const [group, entries] of Object.entries(STATIC_ASSET_GROUPS)) {
    const contents = Object.entries(entries).map(
      ([name, source]) =>
        [
          name,
          typeof source === "string" ? readFileSync(source) : source,
        ] as const,
    );
    const hash = createHash("sha256");
    for (const [name, content] of contents) hash.update(name).update(content);
    const directory = `assets/${group}-${hash.digest("hex").slice(0, 8)}/`;
    directories[group] = directory;
    for (const [name, content] of contents)
      files.set(`${directory}${name}`, content);
  }
  const types: Record<string, string> = {
    js: "text/javascript",
    wasm: "application/wasm",
  };
  return {
    name: "octoscode-web-static-assets",
    config: () => ({
      define: { __OCTOSCODE_STATIC_ASSETS__: JSON.stringify(directories) },
    }),
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0]?.slice(basePath().length);
        const content = path ? files.get(path) : undefined;
        if (!content) return next();
        response.setHeader(
          "Content-Type",
          types[path!.split(".").pop()!] ?? "application/octet-stream",
        );
        response.end(content);
      });
    },
    generateBundle() {
      for (const [fileName, source] of files)
        this.emitFile({ type: "asset", fileName, source });
    },
  };
}

function basePath(): string {
  const value = releaseValue("OCTOSCODE_WEB_BASE_PATH", "/");
  if (!value.startsWith("/") || !value.endsWith("/")) {
    throw new Error(
      "OCTOSCODE_WEB_BASE_PATH must be an absolute path ending in '/', for example /octoscode/",
    );
  }
  return value;
}

export default defineConfig({
  base: basePath(),
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Receipts load only after their explicit typed RPC. Narrow tests
          // keep live-event/capability helpers out of these cold chunks and
          // leave unrelated app/vendor modules to normal chunk optimization.
          groups: ["hydrate", "session", "client"]
            .map((name) => ({
              name: `receipt-${name}`,
              test: (id: string) =>
                id
                  .replaceAll("\\", "/")
                  .endsWith(`packages/client/src/${name}.ts`),
              includeDependenciesRecursively: false,
            }))
            .concat([
              {
                // v0.10.0: guards and contract constants shared by synchronous
                // notifications and lazy response decoders stay isolated so a
                // notification guard cannot preload task/workspace/hydrate
                // decoders.
                name: "protocol-values",
                test: (id: string) =>
                  /[\\/]packages[\\/]client[\\/]src[\\/](supervision-values|turn-state-values|projection|workspace-events|generated[\\/]core-contract)\.ts$/.test(
                    id,
                  ),
                includeDependenciesRecursively: false,
              },
              {
                // v0.10.0: stable React vendor chunk for returning users.
                name: "vendor-react",
                test: (id: string) =>
                  /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(
                    id,
                  ),
                includeDependenciesRecursively: true,
              },
            ]),
        },
      },
    },
  },
  plugins: [
    react(),
    staticAssets(),
    {
      name: "octoscode-web-build-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "octoscode-web-build.json",
          source: `${JSON.stringify(
            {
              schema_version: 2,
              release: releaseValue("OCTOSCODE_WEB_RELEASE", "dev"),
              source_revision: releaseValue(
                "OCTOSCODE_WEB_REVISION",
                "unknown",
              ),
              supported_octos_contract: SUPPORTED_OCTOS_CONTRACT,
              verified_core_runtime: VERIFIED_CORE_RUNTIME,
            },
            null,
            2,
          )}\n`,
        });
      },
    },
  ],
  server: {
    port: 4173,
    ...developmentProxy(),
  },
  preview: developmentProxy(),
});

function developmentProxy(): { proxy: Record<string, ProxyOptions> } | object {
  const target = process.env.OCTOSCODE_DEV_PROXY_TARGET?.trim();
  if (!target) return {};
  const trustedOrigin = process.env.OCTOSCODE_DEV_PROXY_ORIGIN?.trim();
  return {
    proxy: {
      "/api": {
        target,
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          if (!trustedOrigin) return;
          proxy.on("proxyReqWs", (request) => {
            request.setHeader("Origin", trustedOrigin);
          });
        },
      },
    },
  };
}
