// Busca de profissionais, perfil, horários e triagem.
import { requireUser } from '../guards.js';
import { HttpError } from '../http.js';
import { json } from '../db.js';
import { nowSP } from '../time.js';
import { quote } from '../pricing.js';
import { freeSlots } from '../slots.js';
import { deriveNeeds, rank } from '../matching.js';
import { AREAS, BAIRROS, BAIRRO_NAMES, TOPICS, AUDIENCES, PRICING, TRIAGE } from '../../public/js/shared/data.js';

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function catalogRoutes(r, { db, config, svc }) {
  // Dados de referência para a interface: áreas, bairros, temas, preços e textos da triagem.
  r.get('/api/meta', () => ({ areas: AREAS, bairros: BAIRROS, bairroNames: BAIRRO_NAMES, topics: TOPICS, audiences: AUDIENCES, pricing: PRICING, triage: TRIAGE, demoMode: config.demoMode }));

  // Resumo de um profissional para listas e mapa, com próximo horário e vaga social disponível.
  function summary(p, user, now) {
    const days = svc.slotsFor(p, { now });
    const free = freeSlots(days);
    const socialFree = free.some((s) => s.social);
    return {
      id: p.id, name: p.name, title: p.title, area: p.area, approach_short: p.approach_short, topics: p.topics,
      audience: p.audience, modalities: p.modalities, bairro: p.bairro, map: p.map, color: p.color,
      price: p.price, social_price: p.social_price, social_free: socialFree,
      eff_price: socialFree ? Math.min(p.price, p.social_price) : p.price,
      rating: p.rating, rating_count: p.rating_count, is_new: p.is_new, years: p.years,
      distance: svc.distance(user, p), next_slot: free[0]?.start || null, free_count: free.length,
    };
  }

  // Lista com filtros (?area, ?q, ?modality, ?max em reais, ?social=1) e ordenação (?sort=rel|nota|preco|perto).
  r.get('/api/pros', (req) => {
    const q = req.query;
    const now = nowSP();
    let list = svc.listPros().map((p) => summary(p, req.user, now));
    if (q.area) list = list.filter((p) => p.area === q.area);
    if (q.q) {
      const t = norm(q.q);
      list = list.filter((p) => norm([p.name, p.title, p.approach_short, ...p.topics, ...p.audience].join(' ')).includes(t));
    }
    if (q.modality === 'online' || q.modality === 'presencial') list = list.filter((p) => p.modalities.includes(q.modality));
    if (q.max) list = list.filter((p) => p.eff_price <= Number(q.max) * 100);
    if (q.social === '1') list = list.filter((p) => p.social_free);
    const sorters = {
      // Relevância: nota ponderada pelo número de avaliações (o logaritmo evita que o volume domine).
      rel: (a, b) => b.rating * Math.log(b.rating_count + 3) - a.rating * Math.log(a.rating_count + 3),
      nota: (a, b) => b.rating - a.rating || b.rating_count - a.rating_count,
      preco: (a, b) => a.eff_price - b.eff_price,
      perto: (a, b) => a.distance - b.distance,
    };
    list.sort(sorters[q.sort] || sorters.rel);
    return { pros: list };
  });

  // Perfil completo com as últimas avaliações comentadas e a distribuição das notas.
  // Profissional não verificado só aparece para ele mesmo e para a administração.
  r.get('/api/pros/:id', (req) => {
    const p = svc.getPro(Number(req.params.id));
    const own = req.user && req.user.id === p?.id;
    const isAdmin = req.user?.role === 'admin';
    if (!p || (p.status !== 'verified' && !own && !isAdmin)) throw new HttpError(404, 'Profissional não encontrado.');
    const reviews = db.all(`SELECT id, rating, tags, text, author_label, modality, created_at FROM reviews
                            WHERE pro_id = ? AND (text <> '' OR tags <> '[]') ORDER BY created_at DESC LIMIT 20`, p.id)
      .map((r) => ({ ...r, tags: json(r.tags) }));
    const dist = [5, 4, 3, 2, 1].map((n) => db.get('SELECT COUNT(*) n FROM reviews WHERE pro_id = ? AND rating = ?', p.id, n).n);
    return { pro: { ...summary(p, req.user, nowSP()), reg: p.reg, approach: p.approach, bio: p.bio, supervisor: p.supervisor, status: p.status }, reviews, distribution: dist };
  });

  // Horários dos próximos 14 dias, com o valor que este usuário pagaria.
  r.get('/api/pros/:id/slots', (req) => {
    const p = svc.getPro(Number(req.params.id));
    if (!p || p.status !== 'verified') throw new HttpError(404, 'Profissional não encontrado.');
    const plus = req.user?.plan === 'plus';
    const days = svc.slotsFor(p).map((d) => ({
      ...d,
      items: d.items.map((s) => ({ ...s, quote: quote({ pro: p, social: s.social, plus }) })),
    }));
    return { days, regular: quote({ pro: p, plus }), social: p.social_price ? quote({ pro: p, social: true, plus }) : null };
  });

  // Triagem: guarda as respostas (para pacientes) e devolve as indicações do motor.
  r.post('/api/triage', requireUser, (req) => {
    const answers = req.body.answers || {};
    const needs = deriveNeeds(answers);
    const now = nowSP();
    const pros = svc.listPros();
    const freeSlotsByPro = new Map(pros.map((p) => [p.id, freeSlots(svc.slotsFor(p, { now }))]));
    // Mede o tempo do motor (meta do PIPE: menos de 300 ms).
    const t0 = performance.now();
    const { results, relaxed } = rank(pros, needs, { bairro: req.user.bairro, freeSlotsByPro });
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    if (req.user.role === 'patient') {
      db.run('INSERT INTO triages(user_id, answers, needs) VALUES (?, ?, ?)', req.user.id, JSON.stringify(answers), JSON.stringify({ ...needs, budget: Number.isFinite(needs.budget) ? needs.budget : null }));
    }
    const byId = new Map(pros.map((p) => [p.id, p]));
    return {
      needs: { ...needs, budget: Number.isFinite(needs.budget) ? needs.budget : null },
      relaxed, elapsed_ms: ms,
      results: results.slice(0, 5).map((x) => ({ ...x, pro: summary(byId.get(x.pro_id), req.user, now) })),
    };
  });
}
