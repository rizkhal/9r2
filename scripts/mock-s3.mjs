// Minimal S3-compatible server used by scripts/e2e.sh. Ignores signatures.
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 9900)
const store = new Map()

createServer((req, res) => {
  const key = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/[^/]+\//, ''))
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    if (req.method === 'PUT') {
      store.set(key, { body, type: req.headers['content-type'] ?? 'application/octet-stream' })
      res.writeHead(200, { etag: `"${body.length}"` }).end()
      return
    }
    if (req.method === 'DELETE') {
      store.delete(key)
      res.writeHead(204).end()
      return
    }
    const object = store.get(key)
    if (!object) {
      res.writeHead(404).end()
      return
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range) {
      const start = range[1] === '' ? object.body.length - Number(range[2]) : Number(range[1])
      const end = range[2] === '' ? object.body.length - 1 : Number(range[2])
      const slice = object.body.subarray(start, end + 1)
      res.writeHead(206, {
        'content-type': object.type,
        'content-range': `bytes ${start}-${end}/${object.body.length}`,
        'content-length': String(slice.length),
        etag: `"${object.body.length}"`,
      })
      res.end(slice)
      return
    }
    res.writeHead(200, {
      'content-type': object.type,
      'content-length': String(object.body.length),
      etag: `"${object.body.length}"`,
    })
    res.end(object.body)
  })
}).listen(port, () => console.log(`mock s3 on ${port}`))
