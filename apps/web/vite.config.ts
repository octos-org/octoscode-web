import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";
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
  plugins: [
    react(),
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
