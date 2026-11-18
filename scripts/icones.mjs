// Gera os ícones e as telas de abertura do app instalável (PWA) a partir do logo do Me Salva.
// Uso (só para quem for mudar o logo): `node scripts/icones.mjs`. Precisa do rsvg-convert
// (pacote librsvg2-bin no Linux ou `brew install librsvg` no Mac). O app em si não depende disto:
// os arquivos gerados ficam em public/icons/ e vão para o Git.
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));
const VERDE = '#1E4D40';
const CREME = '#FFF9F3';

// Logo completo (cabeça com engrenagens amparada por duas mãos), num quadro de 64 × 64.
// cor: cabeça e mãos; corte: traço das engrenagens, na cor do fundo.
const marca = (cor, corte) => `
<path d="M33 7c-8.5 0-14.5 6-14.5 13.8 0 4.4 1.8 7.4 3.5 9.5v6.2h13l.8-4h3.8c2 0 3-1.1 3-3v-3.4l2.6-1.1-2.7-4.6C42.5 12.8 38.6 7 33 7z" fill="${cor}"/>
<g fill="none" stroke="${corte}" stroke-width="2"><circle cx="29" cy="18" r="3.4" stroke-dasharray="2.2 1.4"/><circle cx="36.5" cy="24" r="2.8" stroke-dasharray="1.8 1.3"/></g>
<g fill="none" stroke="${cor}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 26c1 9 5.5 16 12.5 20.5l4 3.5v8.5"/><path d="M14 32c1.4 5.5 4.6 9.6 9.2 12.3"/><path d="M56 26c-1 9-5.5 16-12.5 20.5l-4 3.5v8.5"/><path d="M50 32c-1.4 5.5-4.6 9.6-9.2 12.3"/></g>`;
// Versão simplificada, sem as engrenagens nem o traço interno das mãos (para o ícone pequeno da barra de status).
const marcaSimples = (cor) => `
<path d="M33 7c-8.5 0-14.5 6-14.5 13.8 0 4.4 1.8 7.4 3.5 9.5v6.2h13l.8-4h3.8c2 0 3-1.1 3-3v-3.4l2.6-1.1-2.7-4.6C42.5 12.8 38.6 7 33 7z" fill="${cor}"/>
<g fill="none" stroke="${cor}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 26c1 9 5.5 16 12.5 20.5l4 3.5v8.5"/><path d="M56 26c-1 9-5.5 16-12.5 20.5l-4 3.5v8.5"/></g>`;

// Centro visual do logo no quadro de 64 (considerando o traço das mãos).
const CX = 32;
const CY = 33.4;
// Posiciona o logo com escala s, centrado num quadro de w × h.
const pos = (w, h, s) => `translate(${(w / 2 - CX * s).toFixed(2)} ${(h / 2 - CY * s).toFixed(2)}) scale(${s})`;

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// Ícone "any": quadrado de cantos arredondados (também usado como ícone SVG do manifesto).
const iconAny = svg(512, 512, `<rect width="512" height="512" rx="112" fill="${VERDE}"/><g transform="${pos(512, 512, 6.4)}">${marca(CREME, VERDE)}</g>`);
// Ícone "maskable": fundo até a borda e logo dentro da zona segura (círculo de 80% do lado).
const maskable = (n) => svg(n, n, `<rect width="${n}" height="${n}" fill="${VERDE}"/><g transform="${pos(n, n, 5.2 * n / 512)}">${marca(CREME, VERDE)}</g>`);
// iPhone: fundo até a borda (o sistema arredonda os cantos) e logo um pouco maior.
const apple = svg(180, 180, `<rect width="180" height="180" fill="${VERDE}"/><g transform="${pos(180, 180, 2.05)}">${marca(CREME, VERDE)}</g>`);
// Ícone pequeno da barra de status do Android: só a forma importa (branco sobre transparente).
const badge = svg(96, 96, `<g transform="${pos(96, 96, 1.35)}">${marcaSimples('#FFFFFF')}</g>`);
// Tela de abertura do iPhone: fundo creme e logo verde no centro.
const splash = (w, h) => svg(w, h, `<rect width="${w}" height="${h}" fill="${CREME}"/><g transform="${pos(w, h, w * 0.3 / 50)}">${marca(VERDE, CREME)}</g>`);

// Tamanhos de tela dos iPhones (em pixels, retrato): largura, altura, largura em pontos, altura em pontos, densidade.
export const SPLASH = [
  [1320, 2868, 440, 956, 3], [1290, 2796, 430, 932, 3], [1206, 2622, 402, 874, 3], [1179, 2556, 393, 852, 3],
  [1284, 2778, 428, 926, 3], [1170, 2532, 390, 844, 3], [1125, 2436, 375, 812, 3], [828, 1792, 414, 896, 2], [750, 1334, 375, 667, 2],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const tmp = mkdtempSync(join(tmpdir(), 'icones-'));
  const png = (name, source, w, h = w) => {
    const file = join(tmp, name + '.svg');
    writeFileSync(file, source);
    execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), '-o', join(OUT, name + '.png'), file]);
  };
  writeFileSync(join(OUT, 'icon.svg'), iconAny + '\n');
  png('icon-192', iconAny, 192);
  png('icon-512', iconAny, 512);
  png('maskable-192', maskable(192), 192);
  png('maskable-512', maskable(512), 512);
  png('apple-touch-icon', apple, 180);
  png('badge-96', badge, 96);
  for (const [w, h] of SPLASH) png(`splash-${w}x${h}`, splash(w, h), w, h);
  rmSync(tmp, { recursive: true, force: true });
  console.log('Ícones gerados em public/icons/.');
}
