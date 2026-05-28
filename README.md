# Fleet Rental Bot

Electron + TypeScript bot for renewing Star Atlas SRSLY fleet rentals.

## Current project shape

This project follows the same broad pattern as `gm-market-bot` and `sa-crew-bid-bot`:

- TypeScript core bot in `src/bot.ts`
- Electron shell in `electron/`
- Profile-specific app settings persisted under Electron `userData`
- Runtime state/logs written to `ANALYSIS_DIR` (`analysis/` by default, profile-prefixed for named profiles)

## Configuration

- SRSLY program: `SRSLY1fq9TJqCk1gNSE7VZL2bztvTn9wm4VR8u8jMKT`
- Hot wallet secret is configured in Setup.
- Managed / asset owner wallet and managed player profile are configured in Setup.
- Rental rules contain:
  - fleet account
  - fleet rental contract
  - duration in days, max `24`
  - max acceptable rent price per day
- Bot should renew configured fleets when rental end is reached and current contract price is <= max price.
- Rental rule fleet names, fleet accounts, and rental contract accounts are chain-derived/display-only after a fleet or contract is entered.

## Profiles

Use profiles to run multiple local instances without hardcoding a faction into settings.

```bash
npm run start -- --profile PROFILE_NAME
npm run start:electron -- --profile PROFILE_NAME
```

The active profile is shown in Settings and drives the app/window name, for example `Fleet Rental Bot - PROFILE_NAME`.

For production faction instances, use one app folder per profile:

- `fleet-rental-bot-MUD`
- `fleet-rental-bot-ONI`
- `fleet-rental-bot-USTUR`

The in-app updater updates only the app folder it is running from. For named profiles it refuses to update from a shared `fleet-rental-bot` folder so updating USTUR cannot also replace MUD. Each faction folder should be launched and updated separately.

## Safety defaults

`DRY_RUN` defaults to `true`.

Normal RPC transaction submission is the default. Helius Sender can be enabled in Setup when faster submission is needed; it adds the configured SOL tip and compute-unit priority fee to each submitted rental transaction.

Aggressive mode derives a fixed priority-fee ladder from `HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS`. Normal Helius Sender submissions use `TRANSACTION_PRIORITY_FEE_MICROLAMPORTS`.

Sender tip validation follows Helius minimums: `0.0002` SOL for default dual routing, or `0.000005` SOL when SWQOS-only routing is enabled.

Aggressive mode prepares rental instructions shortly before the send window, refreshes a recent blockhash cache while armed/running, and reuses short-lived priority-fee estimates during the race window so 100ms send intervals do not block on full transaction rebuilds or repeated fee-estimate HTTP calls. The bot always builds the `accept_rental` instruction for aggressive attempts and lets chain timing decide whether the old rental state has cleared.

## Commands

```bash
npm install
npm run typecheck
npm run build
npm run start
```
