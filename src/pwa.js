// App instalável (PWA, v1.2): monta o service worker que o navegador baixa em /sw.js.
//
// O arquivo public/sw.js é um modelo com duas marcas: __VERSION__ e __SHELL__. A cada pedido, o servidor troca
// as marcas pela versão do app (package.json) somada a um resumo (hash) de todos os arquivos de public/ e pela
// lista de arquivos da estrutura do app. Assim, qualquer mudança em CSS, JS, HTML ou ícones muda os bytes do
// service worker, e o navegador instala a versão nova sozinho: não há número de versão para lembrar de trocar.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Arquivos que não entram no cache da estrutura: o próprio service worker e as telas de abertura do iPhone
// (o iPhone baixa só a do seu tamanho, na hora de instalar; guardar as 9 em todo aparelho seria desperdício).
const SKIP = [/^sw\.js$/, /^icons\/splash-/];

// Content Security Policy do service worker. É igual à das páginas, mas deixa o service worker buscar as
// fontes do Google para guardá-las no cache (connect-src), o que permite abrir o app com as fontes certas sem rede.
export const SW_CSP = [
  "default-src 'self'", "script-src 'self'",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
].join('; ');

// Lista todos os arquivos de uma pasta (com subpastas), como caminhos relativos com '/'.
function walk(dir, root = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

// Cria o gerador do service worker para a pasta public/. O resultado fica guardado e só é recalculado quando
// algum arquivo muda (tamanho ou data de modificação), o que torna barato atender /sw.js a cada navegação.
export function createServiceWorker({ publicDir, appVersion }) {
  let memo = { sig: null, body: null, version: null, shell: null };

  function build() {
    const files = walk(publicDir);
    const stats = files.map((f) => { const s = statSync(join(publicDir, f)); return `${f}:${s.size}:${s.mtimeMs}`; });
    const sig = stats.join('|');
    if (memo.sig === sig) return memo;
    const hash = createHash('sha256');
    for (const f of files) hash.update(f).update('\0').update(readFileSync(join(publicDir, f)));
    const version = `${appVersion}-${hash.digest('hex').slice(0, 10)}`;
    const shell = files.filter((f) => !SKIP.some((re) => re.test(f)) && f !== 'index.html').map((f) => '/' + f);
    const body = readFileSync(join(publicDir, 'sw.js'), 'utf8')
      .replace("'__VERSION__'", JSON.stringify(version))
      .replace('__SHELL__', JSON.stringify(shell));
    memo = { sig, body, version, shell };
    return memo;
  }

  return { build };
}
