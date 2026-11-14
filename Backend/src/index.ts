// Hab server entry: Hono HTTP API + ws surface link (/link) + event log + site-pack static serving.
// Env: PORT (8787), SITEPACK (gale-v1; mock pack if missing), MARSWALK_PATH_SEARCH, MARSWALK_COST_MODEL, MARSWALK_ENGINE.
import { createHabServer } from './server';

const port = Number(process.env.PORT ?? 8787);
// MARSWALK_ENGINE=golden-plan|fallback forces the golden fixture (demo safety net; default auto).
const engine = process.env.MARSWALK_ENGINE as 'auto' | 'golden-plan' | 'fallback' | undefined;
const hab = await createHabServer({ port, engine });

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
