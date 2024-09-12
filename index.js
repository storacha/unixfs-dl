import { parse as parseLink } from 'multiformats/link'
import { code as rawCode } from 'multiformats/codecs/raw'
import { code as pbCode, decode as decodePB } from '@ipld/dag-pb'
import { UnixFS } from 'ipfs-unixfs'

const MaxRangeSize = 1024 * 1024 * 100

/**
 * @param {string|URL} url
 * @param {object} [options]
 * @param {TransformStream} [options.TransformStream]
 * @param {number} [options.maxRangeSize]
 */
export const fetch = async (url, options) => {
  const TransformStream = options?.TransformStream ?? globalThis.TransformStream
  const maxRangeSize = options?.maxRangeSize ?? MaxRangeSize

  const blockURL = new URL(url)
  blockURL.searchParams.set('format', 'raw')

  const rootRes = await globalThis.fetch(blockURL)
  if (!rootRes.ok) {
    throw new Error(`failed to request root block: ${blockURL}`)
  }

  const etag = rootRes.headers.get('etag')
  let root
  try {
    root = parseLink(etag.slice(1, -5)) // "bafy.raw"
  } catch (err) {
    throw new Error(`failed parse root CID from Etag: ${etag}`, { cause: err })
  }

  // if raw then just return the data
  if (root.code === rawCode) {
    return rootRes
  }
  if (root.code !== pbCode) {
    throw new Error(`not dag-pb: ${root}`)
  }

  const rootBytes = new Uint8Array(await rootRes.arrayBuffer())
  const entry = UnixFS.unmarshal(decodePB(rootBytes).Data)
  if (entry.type !== 'file') {
    throw new Error(`not a unixfs file: ${root}`)
  }

  const size = entry.blockSizes.reduce((t, s) => t + Number(s), 0)
  const ranges = []
  let offset = 0
  while (offset < size) {
    ranges.push([offset, Math.min(offset + maxRangeSize - 1, size - 1)])
    offset += maxRangeSize
  }

  const initRange = `bytes=${ranges[0][0]}-${ranges[0][1]}`
  const initRes = await globalThis.fetch(url, { headers: { range: initRange } })
  if (!initRes.ok) {
    throw new Error(`failed to request: ${initRange} of: ${url}`)
  }

  const headers = new Headers(initRes.headers)
  headers.set('Content-Length', size.toString())
  headers.set('Cache-Control', 'public, max-age=29030400, immutable')
  headers.set('Etag', `"${root}"`)
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
      await res.body.pipeTo(writable, { preventClose: i !== ranges.length - 1 })
      i++
    }
  })()

  return new Response(readable, { headers })
}
