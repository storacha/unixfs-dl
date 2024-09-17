# unixfs-dl

Download a UnixFS file by making multiple byte range requests to an IPFS gateway.

## Usage

```js
import * as Downloader from '@storacha/unixfs-dl'

const res = await Downloader.fetch('https://w3s.link/ipfs/bafybeigugdohnjpclc3ezehkwg4d3kkw243rdgext5czmww26hfpynlorq/HRHSweetJeremy%202024.mov')

await res.pipeTo(...)
```

## Contributing

Feel free to join in. All welcome. [Open an issue](https://github.com/storacha/unixfs-dl/issues)!

## License

Dual-licensed under [MIT + Apache 2.0](https://github.com/storacha/unixfs-dl/blob/main/LICENSE.md)
