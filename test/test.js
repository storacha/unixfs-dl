import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import crypto from 'node:crypto'
import { sha256 } from 'multiformats/hashes/sha2'
import * as Digest from 'multiformats/hashes/digest'
import * as Link from 'multiformats/link'
import * as raw from 'multiformats/codecs/raw'
import * as dagPB from '@ipld/dag-pb'
import { fetch, MaxRangeSize } from '../index.js'

/**
 * @typedef {{ path: string, hash: import('multiformats').Link }} File
 * @typedef {(digest: import('multiformats').Digest) => import('multiformats').Link} Linker
 */

/**
 * @param {File} file
 * @param {string} [contentType]
 */
const startServer = async (file, contentType) => {
  const stats = await fs.promises.stat(file.path)
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', contentType ?? 'application/octet-stream')
    res.setHeader('Etag', `"${file.hash}"`)

    if (req.method === 'HEAD') {
      if (req.headers['if-none-match'] === `"${file.hash}"`) {
        res.statusCode = 304
      }
      res.setHeader('Content-Length', stats.size)
      return res.end()
    }

    if (!req.headers.range) {
      res.setHeader('X-No-Range', 'true')
      return pipeline(fs.createReadStream(file.path), res)
    }

    const [start, end] = req.headers.range.split('bytes=')[1].split('-').map(s => parseInt(s))
    res.setHeader('Content-Length', end - start + 1)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`)

    pipeline(fs.createReadStream(file.path, { start, end }), res)
  })
  return {
    url: await new Promise(resolve => {
      server.listen(() => {
        const { port } = server.address()
        resolve(new URL(`http://127.0.0.1:${port}`))
      })
    }),
    close: () => {
      return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve(err))
      })
    }
  }
}

const MB = 1024 * 1024
const GB = 1024 * MB

/** @type {Linker} */
const dagPBLinker = { link: digest => Link.create(dagPB.code, digest) }
/** @type {Linker} */
const rawLinker = { link: digest => Link.create(raw.code, digest) }

/**
 * @param {number} size 
 * @param {Linker} linker
 */
const createFile = async (size, linker = dagPBLinker) => {
  const hash = crypto.createHash('sha256')
  const filename = `unixfs-dl-${Date.now()}`
  const filepath = path.join(os.tmpdir(), filename)
  console.log(`writing ${size.toLocaleString()} random bytes to: ${filepath}`)
  await pipeline(
    Readable.from(async function* () {
      while (size > 0) {
        const chunkSize = Math.min(size, 100 * MB)
        const bytes = crypto.randomBytes(chunkSize)
        hash.update(bytes)
        yield bytes
        size -= chunkSize
      }
    }()),
    fs.createWriteStream(filepath)
  )
  const digest = hash.digest()
  const link = linker.link(Digest.create(sha256.code, digest))
  console.log(`file hash: ${link}`)
  return { path: filepath, hash: link }
}

/**
 * @param {import('entail').Assert} assert
 * @param {URL} url
 * @param {File} file
 * @param {Linker} linker
 */
const verifiedFetch = async (assert, url, file, linker = dagPBLinker) => {
  let total = 0
  const intervalID = setInterval(() => console.log(`received ${total.toLocaleString()} bytes`), 1000)
  try {
    const hash = crypto.createHash('sha256')
    const res = await fetch(url)
    assert.equal(res.ok, true)
    for await (const chunk of res.body) {
      hash.update(chunk)
      total += chunk.length
    }
    console.log(`received ${total.toLocaleString()} bytes`)
    const digest = hash.digest()
    const link = linker.link(Digest.create(sha256.code, digest))
    assert.equal(link.toString(), file.hash.toString())
    return res
  } catch (err) {
    throw err
  } finally {
    clearInterval(intervalID)
  }
}

export const test = {
  'should fetch a big file': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(5 * GB)
    const server = await startServer(file)
    try {
      const res = await verifiedFetch(assert, server.url, file)
      assert.equal(res.headers.get('X-No-Range'), null)
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
  'should preserve headers': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(MaxRangeSize + 1)
    const contentType = `application/test${Date.now()}`
    const server = await startServer(file, contentType)
    try {
      const res = await verifiedFetch(assert, server.url, file)
      assert.equal(res.headers.get('Content-Type'), contentType)
      assert.equal(res.headers.get('X-No-Range'), null)
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
  'should not send byte range request when size is less than max range': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(MaxRangeSize - 1)
    const server = await startServer(file)
    try {
      const res = await verifiedFetch(assert, server.url, file)
      assert.equal(res.headers.get('x-no-range'), 'true')
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
  'should not send byte range request when non-unixfs': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(MaxRangeSize + 1, rawLinker)
    const server = await startServer(file)
    try {
      const res = await verifiedFetch(assert, server.url, file, rawLinker)
      assert.equal(res.headers.get('x-no-range'), 'true')
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
  'should abort': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(MaxRangeSize + 1)
    const server = await startServer(file)
    const controller = new AbortController()
    try {
      const res = await fetch(server.url, { maxRangeSize: 1024, signal: controller.signal })
      assert.equal(res.ok, true)
      const chunks = []
      for await (const chunk of res.body) {
        chunks.push(chunk)
        if (chunks.length === 5) controller.abort()
      }
      assert.fail('did not abort')
    } catch (err) {
      assert.equal(err.name, 'AbortError')
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
  'should support conditional request with If-None-Match': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(MaxRangeSize + 1)
    const server = await startServer(file)
    const controller = new AbortController()
    try {
      const res = await fetch(server.url, {
        maxRangeSize: 1024,
        signal: controller.signal,
        headers: {
          'If-None-Match': `"${file.hash}"`
        },
      })
      assert.equal(res.status, 304)
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
}
