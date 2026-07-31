# Dependency security status

Last reviewed for Fleet Rental Bot 0.2.35 on 2026-07-31.

## Patched in the release lockfile

The release lockfile must stay outside the vulnerable ranges for:

- `undici` before 7.28.0 (including GHSA-vmh5-mc38-953g and related advisories)
- `ws` 7.x before 7.5.11 and 8.x before 8.21.0 (GHSA-96hv-2xvq-fx4p and related advisories)

`test/dependency-security.test.js` enforces these minimum versions so a future lockfile refresh cannot silently reintroduce them.

## Upstream-blocked residual advisories

### bigint-buffer — GHSA-3gc7-fjrx-p6mg

`bigint-buffer` 1.1.5 is transitive through `@solana/spl-token` and has no patched npm release. Fleet reaches it through Solana fixed-layout account decoding. The published issue is an application crash in `toBigIntLE`; it is an availability concern, not a disclosed confidentiality or transaction-integrity issue. Track the Solana dependency chain for a replacement or patched release.

### bn.js — GHSA-378v-28hj-76wf

Fleet's direct `bn.js` is patched. Legacy 4.11.6 copies remain under `@staratlas/sage` via Metaplex's `web3-utils` dependencies. The vulnerable operation is `maskn(0)`, which can cause an infinite loop. Do not force a cross-tree override until Star Atlas compatibility has been tested or upstream refreshes this dependency.

### uuid — GHSA-w5hq-g745-h8pq

A legacy `uuid` 8.x copy remains under `@solana/web3.js` through `jayson`. The advisory applies to UUID v3/v5/v6 calls that write into caller-provided buffers. Fleet does not expose those APIs to input and Jayson uses UUIDs internally for JSON-RPC. Upgrade with the Solana/Jayson dependency chain rather than forcing an incompatible major override.

## Update policy

- Do not use `npm audit fix --force`. Current audit suggestions include breaking downgrades of Star Atlas and Solana packages.
- Prefer compatible lockfile refreshes, then run the full build, test suite, release validation, and a clean-install dependency check.
- Treat a change to any Solana or Star Atlas direct dependency as a protocol-sensitive migration requiring transaction-building and account-decoding regression tests.
