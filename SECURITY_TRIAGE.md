# Dependency triage — 2026-10-10

Public deployment remains paused. This is a dependency-path and application-surface review, not an exploitability certification or penetration test.

## Measured audit

Before changes: `npm audit --json` reported 34 affected package entries: 5 low, 11 moderate, 14 high, 4 critical. `npm audit fix --dry-run --json` proposed zero package changes. No forced fix was used.

After the two overrides below: both full audit and `npm audit --omit=dev --json` report **20 entries: 0 low, 1 moderate, 15 high, 4 critical**. Thus 14 package findings were removed. These are affected-package counts, not 20 independent vulnerabilities. Parent-package severities are propagated/recomputed; the high subtotal increased as `@cline/agents` was reclassified, not because a new vulnerable leaf was installed.

All remaining findings lie under the production dependency `@cline/sdk@0.0.92`. It is the only direct dependency named by the audit. Its `@cline/core`, `@cline/agents`, and `@cline/llms` packages remain 0.0.92. The other affected entries are transitive; the production-only audit has the same findings as the full audit. No development-only findings or findings in the direct Next/React/decimal dependencies were reported in this run.

## Compatible changes applied

| Dependency path | Before → after | Reason and verification |
| --- | --- | --- |
| SDK → core → OTLP exporters/resources → `@opentelemetry/core` | 2.6.1 → 2.12.0 | Targeted same-major override; the installed graph already uses 2.12.0 elsewhere. Removes the vulnerable baggage-parser copies and inherited moderate findings. [Upstream advisory](https://github.com/advisories/GHSA-8988-4f7v-96qf) fixes versions below 2.8.0. |
| SDK → core → llms → `@langfuse/vercel-ai-sdk@5.9.1` → `@ai-sdk/otel` | 1.0.2 → 1.0.137 | Patch override, deduplicating to the version already used by llms. Removes its old ai 7.0.2 / provider-utils 5.0.0 subtree. |

`npm install --ignore-scripts` updated the lockfile; no major-version change and no SDK API change. Dictionary and focused application/SDK tests, typecheck and production build passed after these changes. Live telemetry/provider operations are not verified without credentials.

## Remaining findings and exposure

| Installed path / leaf versions | Severity | Available remediation / relevant surface |
| --- | --- | --- |
| SDK → core → `simple-git@3.36.0` → `@simple-git/argv-parser@1.1.1` | Critical, including inherited core/SDK entries | Registry latest simple-git is 4.0.2 and argv-parser 2.0.1; both require major-version migration from the pinned SDK subtree. No compatible automatic fix. [Git command-configuration advisory](https://github.com/advisories/GHSA-x6jw-m9v5-85vh), [editor environment advisory](https://github.com/advisories/GHSA-v5rq-49vh-5v5c). MandiNet never instantiates ClineCore workspace/Git operations and exposes no shell/file/Git tools. This reduces reachable functionality; package presence is not proof of exploitable execution or proof of safety. Verify an upstream SDK migration before public release. |
| SDK → core → llms → `@jerome-benoit/sap-ai-provider@4.8.0` → `@sap-ai-sdk/*@2.16.0` → `@sap-cloud-sdk/*@4.9.1` → `jks-js@1.1.7` → `node-forge@1.4.0` | High, propagated through SAP packages | Registry latest node-forge is 1.4.0, still affected by [RSA signature-verification advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv). No fixed leaf release verified. SAP is not an allowed application provider; no SAP credential or certificate-validation workflow is configured. Await fixed upstream dependencies or a reviewed provider-graph migration; do not downgrade SDK/provider majors merely to reduce counts. |
| SDK → core → llms → `dify-ai-provider@1.1.1` → `@ai-sdk/provider-utils@3.0.41` → `undici@5.29.0` → `@fastify/busboy@2.1.1` | Undici/busboy high; provider-utils moderate | Fixed audit ranges require undici ≥6.28.1 and busboy ≥3.2.2: major changes to this old provider subtree. Dify is not an allowed application provider. HTTP parsing/resource-exhaustion advisories still require review if the provider graph changes. Existing allowed-provider copies of undici 6.29.0/7.30.0 are not the affected 5.29.0 copy. No major override applied. |

Audit `fixAvailable: true` on a parent is not evidence that a compatible leaf fix exists: the actual dry run changed nothing. The 20 remaining entries comprise these leaf issues plus their dependent packages. Exact paths and installed versions were checked with `npm ls` (depth 8), package manifests and registry version queries.

## Application restrictions preserved

The plain SDK `Agent` has exactly two request-bound application tools, empty model tools/plugins, no arbitrary network/file/shell tools, an HTTP-provider allowlist (`cline`, `anthropic`, `openai`, `gemini`), iteration/time/request bounds, and same-origin/owner isolation. Provider network calls are server-side. No SDK secret values were printed. Current configuration reports all three Cline values absent; genuine external provider execution remains unverified. Mock-model tests run the actual installed SDK loop and both application tools, but are not live authentication success.

The manual import endpoint's existing authorization and validation have not changed; a closed panel is presentation only. This pass made no deployment, remote configuration or push.


## Re-audit correction — 2026-10-10

A fresh `npm audit --json` and `npm audit --omit=dev --json` against the current installed tree both report **22 affected package entries: 0 low, 3 moderate, 15 high, 4 critical**. This is the current measured result; the earlier 20-entry snapshot above is superseded. The additional two affected-package entries are the direct production dependency `exceljs@4.4.0` (moderate) and its `uuid@8.3.2` child (moderate; advisory covers versions below 11.1.1). The audit's offered `exceljs@3.4.0` remediation is a downgrade from 4.x (major API change), so it is not an automatic compatible fix. No dependencies changed in this pass.

The other 20 entries are in the `@cline/sdk@0.0.92` dependency tree: critical `simple-git@3.36.0` / `@simple-git/argv-parser@1.1.1`; high `undici@5.29.0` and `@fastify/busboy@2.1.1` through the Dify provider; and high `node-forge@1.4.0` through the SAP provider. Parent package findings account for the remaining entries; they are not 20 additional independent issues. The audit marks several parents fixable, but the installed leaf versions/paths show that proposed resolutions require provider/SDK subtree upgrades or major changes; no compatible leaf fix was verified. Existing targeted same-major `@opentelemetry/core` and `@ai-sdk/otel` overrides remain applied.

Production-only audit exactly matches the full audit, so none of these findings are development-only. `exceljs` is used by the production official-export XLSX importer, so its parser/dependency path is reachable for accepted imports; the uuid advisory specifically concerns v3/v5/v6 buffer calls and this review did not prove whether ExcelJS invokes those vulnerable call shapes. The SDK is used for the restricted comparison Agent, but MandiNet does not construct ClineCore workspace/Git operations; simple-git is present transitively, not evidence of reachable command execution. SAP and Dify providers are not in the application allowlist/configuration; their packages remain installed in the SDK tree. The audit reports advisories, not exploitability. Public deployment remains paused until these paths receive a reviewed fix/migration and relevant runtime exposure assessment.
