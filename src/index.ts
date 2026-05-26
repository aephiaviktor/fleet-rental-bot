import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { FleetRentalBot, buildBotConfig, FleetRentalBotInputConfig } from './bot';


const AEPHIA_TOKEN_VALIDATE_URL = 'https://api.aephia.com/token/validate';

function getAephiaApiKey(config: Record<string, unknown>) {
  return String(config?.AEPHIA_API_KEY || '').trim();
}

async function validateAephiaApiKeyOrThrow(config: Record<string, unknown>) {
  const token = getAephiaApiKey(config);
  if (!token) {
    throw new Error('Aephia API key missing. Add/refresh your Aephia token in settings before starting the bot.');
  }

  let response: Response;
  try {
    response = await fetch(AEPHIA_TOKEN_VALIDATE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('Aephia token service/network unavailable. Temporary service problem; token was not marked invalid.');
  }

  if (response.status === 204) return;
  if (response.status === 401) {
    throw new Error('Aephia token auth failed. Refresh/reclaim your Aephia token in settings.');
  }
  if (response.status === 405) {
    throw new Error('Aephia token validation method rejected. Bot must use GET /token/validate.');
  }
  if (response.status >= 500) {
    throw new Error('Aephia token service unavailable. Temporary service problem; token was not marked invalid.');
  }
  throw new Error(`Unexpected Aephia token validation response: HTTP ${response.status}`);
}

function getProfileName() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--profile' || arg === '--instance') return String(args[i + 1] ?? '').trim();
    if (arg.startsWith('--profile=')) return arg.slice('--profile='.length).trim();
    if (arg.startsWith('--instance=')) return arg.slice('--instance='.length).trim();
  }
  return '';
}

function sanitizeProfileName(value: string) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function loadGlobalSettings(): Promise<Record<string, unknown>> {
  const profileName = sanitizeProfileName(getProfileName());
  const settingsPath = profileName
    ? join(homedir(), '.config', 'fleet-rental-bot', 'profiles', profileName, 'settings.json')
    : join(homedir(), '.config', 'fleet-rental-bot', 'settings.json');
  const raw = await readFile(settingsPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function main() {
  const settings = await loadGlobalSettings();
  await validateAephiaApiKeyOrThrow(settings);
  const config = buildBotConfig({
    ...settings,
    INSTANCE_NAME: sanitizeProfileName(getProfileName()) || String(settings.INSTANCE_NAME ?? ''),
    rentalRules: Array.isArray(settings.RENTAL_RULE_ROWS) ? settings.RENTAL_RULE_ROWS : [],
  } as FleetRentalBotInputConfig);
  const bot = new FleetRentalBot(config);
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
