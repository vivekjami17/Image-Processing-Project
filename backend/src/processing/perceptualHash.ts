import { type RgbImage, toGray } from './decode.js';

/**
 * 64-bit difference hash (dHash). The image is shrunk to 9x8 grayscale and each bit
 * records whether a pixel is brighter than its right-hand neighbour. It survives
 * re-encoding, resizing and small colour/brightness changes, so near-duplicates end
 * up a small Hamming distance apart.
 *
 * Returned as a signed 64-bit BigInt so it round-trips through a Postgres BIGINT.
 */
export async function differenceHash(image: RgbImage): Promise<bigint> {
  const { data } = await toGray(image, { width: 9, height: 8, fit: 'fill' });
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x]!;
      const right = data[y * 9 + x + 1]!;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return BigInt.asIntN(64, hash);
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b);
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}
