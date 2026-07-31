'use strict';

function parseRpcProviderUrl(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return { rpcBaseUrl: '', apiKey: '' };
  const url = new URL(raw);
  const apiKey = url.searchParams.get('api-key') || '';
  url.searchParams.delete('api-key');
  const remainingQuery = url.searchParams.toString();
  const pathname = url.pathname === '/' ? '' : url.pathname;
  return {
    rpcBaseUrl: `${url.origin}${pathname}${remainingQuery ? `?${remainingQuery}` : ''}`,
    apiKey,
  };
}

function buildProviderUrl(provider) {
  const base = String(provider?.rpcBaseUrl || '').trim();
  const apiKey = String(provider?.apiKey || '').trim();
  if (!base) return '';
  if (!apiKey) return base;
  const url = new URL(base);
  url.searchParams.set('api-key', apiKey);
  return url.toString();
}

function applyProviderSettings(state, config) {
  for (const [providerId, configKey] of [['main', 'RPC_URL'], ['fallback', 'RPC_URL_FALLBACK']]) {
    const next = parseRpcProviderUrl(config?.[configKey]);
    const current = state.providers[providerId];
    const changed = current.rpcBaseUrl !== next.rpcBaseUrl || current.apiKey !== next.apiKey;
    current.rpcBaseUrl = next.rpcBaseUrl;
    current.apiKey = next.apiKey;
    if (changed) {
      current.failures = 0;
      current.cooldownUntilMs = null;
    }
  }
  return state;
}

function buildRpcLimiterV2Status(state, statePath, now = Date.now()) {
  const providerStatus = {};
  for (const providerId of ['main', 'fallback']) {
    const provider = state.providers?.[providerId] || {};
    providerStatus[providerId] = {
      currentRpcUrl: buildProviderUrl(provider),
      configured: Boolean(provider.rpcBaseUrl),
      failures: provider.failures || 0,
      cooldownUntilMs: provider.cooldownUntilMs ?? null,
      inCooldown: Boolean(provider.cooldownUntilMs && provider.cooldownUntilMs > now),
    };
  }
  const aggressiveExclusive = state.exclusive?.label === 'fleet:aggressive' && state.exclusive.untilMs > now;
  const fallbackAvailable = providerStatus.fallback.configured && !providerStatus.fallback.inCooldown;
  const mainAvailable = providerStatus.main.configured && !providerStatus.main.inCooldown;
  const currentRpcUrl = fallbackAvailable
    ? providerStatus.fallback.currentRpcUrl
    : mainAvailable
      ? providerStatus.main.currentRpcUrl
      : providerStatus.fallback.currentRpcUrl || providerStatus.main.currentRpcUrl;

  return {
    version: state.version,
    path: statePath,
    enabled: Boolean(state.enabled),
    providers: providerStatus,
    currentRpcUrl,
    routingMode: aggressiveExclusive ? 'main-preferred' : 'round-robin',
    providersRoundRobinCounter: state.providersRoundRobinCounter || 0,
    buckets: state.buckets || {},
    exclusive: state.exclusive || null,
    updatedBy: state.updatedBy || '',
    updatedAt: state.updatedAt || '',
    revision: state.revision ?? 0,
  };
}

module.exports = {
  applyProviderSettings,
  buildProviderUrl,
  buildRpcLimiterV2Status,
  parseRpcProviderUrl,
};
