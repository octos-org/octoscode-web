/**
 * Exact upstream contract used by the checked protocol fixtures.
 *
 * Keep this value in one production-owned module so release artifacts can
 * identify the contract they were built and tested against.
 */
export const SUPPORTED_OCTOS_CONTRACT = {
  repository: "https://github.com/octos-org/octos",
  revision: "04cb5596ec0935926d2e8afdd0826bfa18e0c4bb",
  contract_blob: "853140d45c3e59e1c4ab2e4445c0282dbb09a8bc",
  path: "crates/octos-core/src/ui_protocol.rs",
  protocol: "octos.ui.v1",
} as const;
