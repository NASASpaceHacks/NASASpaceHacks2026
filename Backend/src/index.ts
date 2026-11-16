// Hab server entry: Hono HTTP API + ws surface link (/link) + event log + site-pack static serving.
// Env: PORT (8787), MARSWALK_SITEPACKS_DIR, SITEPACK (gale-v1; mock pack if missing), MARSWALK_PATH_SEARCH, MARSWALK_COST_MODEL, MARSWALK_ENGINE, MARSWALK_VAR_DIR.
import { createHabServer } from './server';

const port = Number(process.env.PORT ?? 8787);
// MARSWALK_ENGINE=golden-plan|fallback forces the golden fixture (demo safety net; default auto).
const engine = process.env.MARSWALK_ENGINE as 'auto' | 'golden-plan' | 'fallback' | undefined;
// MARSWALK_VAR_DIR: runtime state (signing key, event log). The e2e suite points it at a fresh dir.
const varDir = process.env.MARSWALK_VAR_DIR || undefined;
// MARSWALK_SITEPACKS_DIR: where SitePacks/<id>/manifest.json are discovered (default: repo SitePacks).
const sitePacksDir = process.env.MARSWALK_SITEPACKS_DIR || undefined;
const hab = await createHabServer({ port, engine, varDir, sitePacksDir });

let stopping = false;
const stop = async (sig: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[hab] ${sig}: shutting down`);
  await hab.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
