import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import crypto from 'node:crypto'
import { fetch } from '../index.js'

/**
 * @param {string} filepath
 * @param {string} [contentType]
 */
const startServer = async (filepath, contentType) => {
  const stats = await fs.promises.stat(filepath)
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', contentType ?? 'application/octet-stream')

    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', stats.size)
      return res.end()
    }

    if (!req.headers.range) {
      res.setHeader('X-No-Range', 'true')
      return pipeline(fs.createReadStream(filepath), res)
    }

    const [start, end] = req.headers.range.split('bytes=')[1].split('-').map(s => parseInt(s))
    res.setHeader('Content-Length', end - start + 1)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`)

    pipeline(fs.createReadStream(filepath, { start, end }), res)
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

const createFile = async size => {
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
  const digest = hash.digest('hex')
  console.log(`file hash: ${digest}`)
  return { path: filepath, hash: digest }
}

/**
 * @param {import('entail').Assert} assert
 * @param {URL} url
 * @param {string} digest Hex encoded sha-256 hash
 */
const verifiedFetch = async (assert, url, digest) => {
  let total = 0
  const intervalID = setInterval(() => console.log(`received ${total.toLocaleString()} bytes`), 10000)
  try {
    const hash = crypto.createHash('sha256')
    const res = await fetch(url)
    assert.equal(res.ok, true)
    for await (const chunk of res.body) {
      hash.update(chunk)
      total += chunk.length
    }
    console.log(`received ${total.toLocaleString()} bytes`)
    assert.equal(hash.digest('hex'), digest)
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
    const server = await startServer(file.path)
    try {
      await verifiedFetch(assert, server.url, file.hash)
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
  'should preserve headers': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(1 * MB)
    const contentType = `application/test${Date.now()}`
    const server = await startServer(file.path, contentType)
    try {
      const res = await verifiedFetch(assert, server.url, file.hash)
      assert.equal(res.headers.get('Content-Type'), contentType)
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
  'should not send byte range request when size is less than max range': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(1 * MB)
    const server = await startServer(file.path)
    try {
      const res = await verifiedFetch(assert, server.url, file.hash)
      assert.equal(res.headers.get('x-no-range'), 'true')
    } finally {
      await server.close()
      console.log('removing', file.path)
      await fs.promises.rm(file.path)
    }
  },
  'should abort': async (/** @type {import('entail').assert} */ assert) => {
    const file = await createFile(1 * MB)
    const server = await startServer(file.path)
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
}
