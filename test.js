import { fetch } from './index.js'

export const test = {
  'should fetch a big file': async (/** @type {import('entail').assert} */ assert) => {
    const root = 'bafybeigugdohnjpclc3ezehkwg4d3kkw243rdgext5czmww26hfpynlorq'
    const path = '/HRHSweetJeremy%202024.mov'
    const res = await fetch(`https://w3s.link/ipfs/${root}${path}`)
    assert.equal(res.ok, true)

    let total = 0
    try {
      for await (const chunk of res.body) {
        total += chunk.length
      }
      console.log(`received ${total} bytes`)
    } catch (err) {
      console.error(err)
    }
  }
}
