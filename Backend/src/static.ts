import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

/** Static file serving with single-range HTTP Range support (RFC 9110 §14), needed for COG streaming. */

const TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.geojson': 'application/geo+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export const contentTypeFor = (p: string) => TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream';

export type RangeResult = { start: number; end: number } | 'unsatisfiable' | null;

/** Parse a single `bytes=` range. null → serve the whole entity (absent, multi-range, or other unit). */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, s, e] = m;
  if (s === '' && e === '') return null;
  if (s === '') {
    const n = Number(e);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(s);
  const end = e === '' ? size - 1 : Math.min(Number(e), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

function baseHeaders(contentType: string, etag: string): Record<string, string> {
  return { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'no-cache' };
}

/** Resolve `rel` inside `root`; null if it escapes the root. */
export function safeJoin(root: string, rel: string): string | null {
  const absRoot = resolve(root);
  const p = resolve(absRoot, '.' + sep + rel);
  return p === absRoot || p.startsWith(absRoot + sep) ? p : null;
}

export async function serveFile(req: Request, absPath: string): Promise<Response> {
  let st;
  try {
    st = await stat(absPath);
  } catch {
    return new Response('not found', { status: 404 });
  }
  if (!st.isFile()) return new Response('not found', { status: 404 });
  const size = st.size;
  const etag = `W/"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const h = baseHeaders(contentTypeFor(absPath), etag);
  const range = parseRange(req.headers.get('range'), size);
  const head = req.method === 'HEAD';
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...h, 'Content-Range': `bytes */${size}` } });
  }
  if (range) {
    const len = range.end - range.start + 1;
    const headers = { ...h, 'Content-Length': String(len), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` };
    if (head) return new Response(null, { status: 206, headers });
    const body = Readable.toWeb(createReadStream(absPath, { start: range.start, end: range.end })) as ReadableStream;
    return new Response(body, { status: 206, headers });
  }
  const headers = { ...h, 'Content-Length': String(size) };
  if (head || size === 0) return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(createReadStream(absPath)) as ReadableStream, { status: 200, headers });
}

export function serveBytes(req: Request, bytes: Uint8Array, contentType: string, etag: string): Response {
  const size = bytes.byteLength;
  const h = baseHeaders(contentType, etag);
  const range = parseRange(req.headers.get('range'), size);
  const head = req.method === 'HEAD';
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...h, 'Content-Range': `bytes */${size}` } });
  }
  if (range) {
    const part = bytes.subarray(range.start, range.end + 1);
    const headers = { ...h, 'Content-Length': String(part.byteLength), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` };
    return new Response(head ? null : part, { status: 206, headers });
  }
  return new Response(head ? null : bytes, { status: 200, headers: { ...h, 'Content-Length': String(size) } });
}
