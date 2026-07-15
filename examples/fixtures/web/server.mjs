import { createServer } from 'node:http';

const html = `<!doctype html><html><body>
<h1>OpenTestPilot</h1>
<form><label>メールアドレス<input id="email" type="email"></label><button type="button">ログイン</button></form>
<div data-testid="dashboard" hidden>Dashboard</div>
<script>document.querySelector('button').addEventListener('click',()=>document.querySelector('[data-testid="dashboard"]').hidden=false);</script>
</body></html>`;

createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}).listen(4173, '127.0.0.1', () => console.log('fixture listening on http://127.0.0.1:4173'));
