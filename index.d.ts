export interface Options {
  /** The maximum size (in bytes) of a range request. */
  maxRangeSize?: number
  /**
   * Constructor for a transform stream that forwards all chunks of byte data
   * written to its writable side to its readable side, without any changes. If
   * not set, `globalThis.TransformStream` is used.
   */
  IdentityTransformStream?: typeof TransformStream
  /** A signal that can be used to abort the operation. */
  signal?: AbortSignal
}

/**
 * Fetch a large file from an IPFS gateway. The function first makes a HEAD
 * request to determine the size of the file and then subsequently makes
 * multiple byte-range requests (of the configured max byte size) to download
 * the file in full.
 * 
 * If the response to the HEAD request has no `Content-Length` header, the
 * resource is not a UnixFS file or the resource is smaller than the configured
 * max range then a regular non-byte-range request is sent to the provided URL.
 */
export declare function fetch (url: string|URL, options?: Options): Promise<Response>
