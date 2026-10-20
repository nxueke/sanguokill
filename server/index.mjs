import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3000);
const server = createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: 'sanguokill-server', version: '0.1.0' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found' }));
});
server.listen(port, '0.0.0.0', () => console.log(`Sanguokill server listening on :${port}`));
