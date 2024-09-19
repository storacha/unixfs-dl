const MaxRangeSize = 1024 * 1024 * 100

/**
 * @param {string|URL} url
 * @param {import('./index').Options} [options]
 */
export const fetch = async (url, options) => {
  const TransformStream = options?.TransformStream ?? globalThis.TransformStream
  const maxRangeSize = options?.maxRangeSize ?? MaxRangeSize

  const headRes = await globalThis.fetch(url, { method: 'HEAD' })
  if (!headRes.ok) {
    throw new Error(`failed HEAD request: ${url}`)
  }

  const size = parseInt(headRes.headers.get('Content-Length'))
  // missing content length header? just fetch it
  if (isNaN(size)) {
    return globalThis.fetch(url)
  }

  const ranges = []
  let offset = 0
  while (offset < size) {
    ranges.push([offset, Math.min(offset + maxRangeSize - 1, size - 1)])
    offset += maxRangeSize
  }

  // if zero size, then just fetch it (get the headers)
  if (size === 0) {
    return globalThis.fetch(url)
  }

  // if a directory index, or not unixfs then just fetch it
  const etag = headRes.headers.get('etag')
  if (etag && (etag.startsWith('"DirIndex') || !etag.startsWith('"bafy') || !etag.startsWith('"Qm'))) {
    return globalThis.fetch(url)
  }

  // if a single range, just fetch it so that the response can be cached
  if (ranges.length === 1) {
    return globalThis.fetch(url, { signal: options?.signal })
  }

  const initRange = `bytes=${ranges[0][0]}-${ranges[0][1]}`
  // console.log(`${initRange} of: ${url}`)
  const initRes = await globalThis.fetch(url, { headers: { range: initRange } })
  if (!initRes.ok) {
    throw new Error(`failed to request: ${initRange} of: ${url}`)
  }

  const headers = new Headers(initRes.headers)
  headers.set('Content-Length', size.toString())
  headers.delete('Content-Range')

  const { readable, writable } = new TransformStream()
  ;(async () => {
    await initRes.body.pipeTo(writable, { preventClose: ranges.length > 1 })
    let i = 0
    for (const [first, last] of ranges.slice(1)) {
      const range = `bytes=${first}-${last}`
      // console.log(`${range} of: ${url}`)
      const res = await globalThis.fetch(url, { headers: { range } })
      if (!res.ok) {
        throw new Error(`failed to request: ${range} of: ${url}`)
      }
      const isLast = i === ranges.length - 2
      await res.body.pipeTo(writable, { preventClose: !isLast })
      i++
    }
  })()

  return new Response(readable, { headers })
}
