import { parse as parseLink } from 'multiformats/link'
import { code as rawCode } from 'multiformats/codecs/raw'
import { code as pbCode, decode as decodePB } from '@ipld/dag-pb'
import { UnixFS } from 'ipfs-unixfs'

const MaxRangeSize = 1024 * 1024 * 100

/** @param {string|URL} url */
export const fetch = async url => {
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
    ranges.push([offset, Math.min(offset + MaxRangeSize - 1, size - 1)])
    offset += MaxRangeSize
  }

  const body = ReadableStream.from((async function* () {
    for (const [first, last] of ranges) {
      const range = `bytes=${first}-${last}`
      console.log(`${range} of: ${url}`)
      const res = await globalThis.fetch(url, { headers: { range } })
      if (!res.ok) {
        throw new Error(`failed to request: ${range} of: ${url}`)
      }
      // console.log(res.headers)
      yield * res.body
    }
  })())

  return new Response(body)
}
