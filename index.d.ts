export interface Options {
  maxRangeSize?: number
  TransformStream?: TransformStream
}

export declare function fetch (url: string|URL, options?: Options): Promise<Response>
