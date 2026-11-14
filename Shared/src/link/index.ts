// Surface link: CBOR codec, WebSocketLink, MemoryLink, Ed25519 package signatures, HTTP API types.
// Pure TS — runs in browsers, Web Workers and Node (docs/AGENTS.md "Surface link API").
export { encodeMsg, decodeMsg, msgKey, canonicalCbor, decodeCbor, LinkDecodeError } from './codec';
export {
  LinkCore,
  LINK_TIMING,
  NOMINAL_CONDITIONS,
  statusFromAge,
  type Link,
  type LinkStatus,
  type LinkConditions,
  type LinkTiming,
  type Transport,
} from './core';
export { connectWebSocketLink, linkUrl, type WsLinkOptions, type WebSocketLike, type WebSocketCtor } from './ws';
export { createMemoryLinkPair, type MemoryLink, type MemoryLinkPair, type MemoryLinkOptions } from './memory';
export {
  packageSigningBytes,
  signPackage,
  verifyPackage,
  generateSigningKey,
  publicKeyFor,
  toHex,
  fromHex,
  type SigningKey,
} from './sign';
export * from './api';
