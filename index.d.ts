export interface Options {
  maxRangeSize?: number
  TransformStream?: typeof TransformStream
  signal?: AbortSignal
}

export declare function fetch (url: string|URL, options?: Options): Promise<Response>
