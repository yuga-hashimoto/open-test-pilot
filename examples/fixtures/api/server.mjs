import { createServer } from 'node:http';

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'x-fixture': 'api' });
    response.end(JSON.stringify({ ok: true, service: 'fixture-api' }));
    return;
  }
  if (url.pathname === '/users' && request.method === 'POST') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      if (typeof parsed.email !== 'string') {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'email is required' }));
        return;
      }
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 1, email: parsed.email }));
    });
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

server.listen(Number(process.env.PORT ?? 4174), '127.0.0.1');
