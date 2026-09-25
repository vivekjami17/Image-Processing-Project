declare module 'heic-decode' {
  interface DecodedImage {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel. */
    data: Uint8ClampedArray;
  }
  export default function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<DecodedImage>;
}
