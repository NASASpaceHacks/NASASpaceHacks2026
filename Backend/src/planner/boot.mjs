// Worker bootstrap. Under `tsx` the TypeScript loader is inherited through execArgv; under plain
// Node or vitest it is not, so register tsx's ESM loader on demand and retry.
const entry = new URL('./worker.ts', import.meta.url).href;
try {
  await import(entry);
} catch (e) {
  const code = e && typeof e === 'object' ? e.code : undefined;
  if (code !== 'ERR_UNKNOWN_FILE_EXTENSION' && code !== 'ERR_MODULE_NOT_FOUND') throw e;
  const { register } = await import('tsx/esm/api');
  register();
  await import(entry + '?tsx');
}
