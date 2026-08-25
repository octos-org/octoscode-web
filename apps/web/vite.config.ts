import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { SUPPORTED_OCTOS_CONTRACT } from "../../packages/client/src/contract.ts";

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
              schema_version: 1,
              release: releaseValue("OCTOSCODE_WEB_RELEASE", "dev"),
              source_revision: releaseValue(
                "OCTOSCODE_WEB_REVISION",
                "unknown",
              ),
              supported_octos_contract: SUPPORTED_OCTOS_CONTRACT,
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
  },
});
