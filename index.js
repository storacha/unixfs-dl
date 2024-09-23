const MaxRangeSize = 1024 * 1024 * 100

/**
 * @param {string|URL} url
 * @param {import('./index').Options} [options]
 */
export const fetch = async (url, options) => {
  const IdentityTransformStream = options?.IdentityTransformStream ?? globalThis.TransformStream
  const maxRangeSize = options?.maxRangeSize ?? MaxRangeSize
  const signal = options?.signal
  const headers = new Headers(options?.headers)
  headers.delete('Range')

  const headRes = await globalThis.fetch(url, { method: 'HEAD', headers, signal })
  if (!headRes.ok) {
    // if response is "Not Modified", the request had an "If-None-Match" header
    // and there's nothing more we need to fetch.
    if (headRes.status === 304) {
      return headRes
    }
    throw new Error(`failed HEAD request: ${url}`)
  }

  const size = parseInt(headRes.headers.get('Content-Length'))
  // missing content length header? just fetch it
  if (isNaN(size)) {
    return globalThis.fetch(url, { headers, signal })
  }

  // if fits in a single range, just fetch it so the response can be cached
  if (size <= maxRangeSize) {
    return globalThis.fetch(url, { headers, signal })
  }

  const ranges = []
  let offset = 0
  while (offset < size) {
    ranges.push([offset, Math.min(offset + maxRangeSize - 1, size - 1)])
    offset += maxRangeSize
  }

  // if a directory index, or not unixfs then just fetch it
  const etag = headRes.headers.get('etag')
  if (etag && (etag.startsWith('"DirIndex') || !etag.startsWith('"bafy') || !etag.startsWith('"Qm'))) {
    return globalThis.fetch(url, { headers, signal })
  }

  const initHeaders = new Headers(headers)
  initHeaders.set('Range', `bytes=${ranges[0][0]}-${ranges[0][1]}`)
  const initRes = await globalThis.fetch(url, { headers: initHeaders, signal })
  if (!initRes.ok) {
    throw new Error(`failed to request: ${initHeaders.get('Range')} of: ${url}`)
  }

  // if not supports byte ranges, just return the response
  if (!initRes.headers.has('Content-Range')) {
    return initRes
  }

  const resHeaders = new Headers(initRes.headers)
  resHeaders.set('Content-Length', size.toString())
  resHeaders.delete('Content-Range')

  const { readable, writable } = new IdentityTransformStream()
  ;(async () => {
    try {
      await initRes.body.pipeTo(writable, { preventClose: ranges.length > 1 })
      let i = 0
      for (const [first, last] of ranges.slice(1)) {
        const rangeHeaders = new Headers(headers)
        rangeHeaders.set('Range', `bytes=${first}-${last}`)
        const rangeRes = await globalThis.fetch(url, { headers: rangeHeaders, signal })
        if (!rangeRes.ok) {
          throw new Error(`failed to request: ${rangeHeaders.get('Range')} of: ${url}`)
        }
        const isLast = i === ranges.length - 2
        await rangeRes.body.pipeTo(writable, { preventClose: !isLast })
        i++
      }
    } catch (err) {
      await writable.abort(err)
    }
  })()

  return new Response(readable, { headers: resHeaders })
}
