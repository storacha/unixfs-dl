export interface Options {
  maxRangeSize?: number
  TransformStream?: typeof TransformStream
}

export declare function fetch (url: string|URL, options?: Options): Promise<Response>
