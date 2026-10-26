// Validação das entradas recebidas pela API.
// Cada função devolve o valor limpo ou lança HttpError 400 com uma mensagem pronta para aparecer
// na tela. O parâmetro label é o nome do campo dentro da frase (ex.: 'o nome').
import { HttpError } from './http.js';

// Atalho para erro 400 (dados inválidos).
export const bad = (msg) => new HttpError(400, msg);

// Texto obrigatório (ou opcional), sem espaços nas pontas, com tamanho mínimo e máximo.
export function str(v, label, { min = 1, max = 200, optional = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && optional) return '';
  if (s.length < min) throw bad(`Preencha ${label}.`);
  if (s.length > max) throw bad(`${label[0].toUpperCase() + label.slice(1)} pode ter no máximo ${max} caracteres.`);
  return s;
}
// Número inteiro dentro de um intervalo.
export function int(v, label, { min = 0, max = 1e9 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.round(n) !== n) throw bad(`Informe um número inteiro em ${label}.`);
  if (n < min || n > max) throw bad(`${label[0].toUpperCase() + label.slice(1)} deve ficar entre ${min} e ${max}.`);
  return n;
}
// Valor que precisa estar numa lista fechada de opções.
export function oneOf(v, list, label) {
  if (!list.includes(v)) throw bad(`Escolha uma opção válida em ${label}.`);
  return v;
}
// Lista de opções (sem repetição) em que todas pertencem à lista permitida.
export function listOf(v, allowed, label, { min = 0 } = {}) {
  const arr = Array.isArray(v) ? [...new Set(v)] : [];
  if (arr.some((x) => !allowed.includes(x))) throw bad(`Há uma opção inválida em ${label}.`);
  if (arr.length < min) throw bad(`Escolha ao menos ${min} ${min === 1 ? 'opção' : 'opções'} em ${label}.`);
  return arr;
}
// E-mail em minúsculas no formato nome@dominio.ext.
export function email(v) {
  const s = str(v, 'o e-mail', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Informe um e-mail válido, como nome@exemplo.com.');
  return s;
}
// Senha entre 8 e 128 caracteres (não é aparada: espaços contam).
export function password(v) {
  const s = typeof v === 'string' ? v : '';
  if (s.length < 8) throw bad('A senha precisa ter pelo menos 8 caracteres.');
  if (s.length > 128) throw bad('A senha pode ter no máximo 128 caracteres.');
  return s;
}
// Horário no formato 'AAAA-MM-DDTHH:MM'.
export const stamp = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw bad('Horário inválido.');
  return v;
};
