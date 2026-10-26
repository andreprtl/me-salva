// Mini-framework HTTP sem dependências: rotas, JSON, cookies e arquivos estáticos.
// Faz o papel do Express para o projeto rodar só com o Node, sem `npm install`.
import { createReadStream, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';

// Erro com status HTTP. As rotas lançam HttpError e app.js transforma em resposta JSON { error }.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
// Lança um HttpError numa linha só.
export const fail = (status, message) => { throw new HttpError(status, message); };

// Roteador simples: registra rotas como '/api/pros/:id' e encontra a que casa com cada requisição.
// Cada rota pode ter vários handlers em sequência (por exemplo, uma guarda de acesso e depois a lógica).
export function createRouter() {
  const routes = [];
  const add = (method) => (path, ...handlers) => {
    const keys = [];
    // Converte ':id' num grupo de captura e guarda o nome do parâmetro.
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'),
    // Devolve { handlers, params }; 'method' se o caminho existe com outro método (405); ou null (404).
    match(method, path) {
      let pathExists = false;
      for (const r of routes) {
        const m = r.re.exec(path);
        if (!m) continue;
        pathExists = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handlers: r.handlers, params };
      }
      return pathExists ? 'method' : null;
    },
  };
}

// Lê o corpo JSON da requisição com limite de tamanho (3 MB, por causa dos áudios do chat).
export function readJson(req, limit = 3 * 1024 * 1024) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return Promise.resolve({});
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'O conteúdo enviado é grande demais.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolveBody({});
      if (!String(req.headers['content-type'] || '').includes('application/json')) {
        return reject(new HttpError(415, 'Envie os dados em JSON.'));
      }
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

// Responde em JSON sem cache (os dados mudam a cada ação).
export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

// Transforma o cabeçalho Cookie em objeto { nome: valor }.
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Tipos de conteúdo dos arquivos servidos da pasta public/.
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

// Serve um arquivo de public/. Devolve false se ele não existir, para app.js responder com o index.html.
export function serveStatic(root, pathname, res) {
  const base = resolve(root);
  let file = resolve(base, '.' + decodeURIComponent(pathname));
  // Bloqueia caminhos como '/../src/db.js', que tentariam sair da pasta pública.
  if (file !== base && !file.startsWith(base + sep)) return false;
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch { return false; }
  const ext = extname(file);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
  });
  createReadStream(file).pipe(res);
  return true;
}
