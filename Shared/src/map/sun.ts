/**
 * Sun direction helpers (pure). Azimuth is clockwise from north, elevation above the horizon.
 * Returned vectors are in the map's local (east, north, up) frame, matching the site pack
 * `normals` raster (nx = east, ny = north; see Shared/src/contracts/sitepack.ts surfaceNormals).
 */
export function sunVector(azDeg: number, elevDeg: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const el = (elevDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
}

/** Lambertian shade (0..1) of a surface normal under a sun direction. CPU twin of the GPU hillshade. */
export function lambert(nx: number, ny: number, azDeg: number, elevDeg: number): number {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const [sx, sy, sz] = sunVector(azDeg, elevDeg);
  return Math.max(0, Math.min(1, nx * sx + ny * sy + nz * sz));
}
