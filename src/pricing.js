// Cálculo do valor de uma sessão (em centavos) e da divisão entre plataforma e profissional.
import { PRICING } from '../public/js/shared/data.js';

/**
 * O profissional sempre recebe 88% do valor de tabela (ou da vaga social).
 * O desconto do Me Salva+ sai da parte da plataforma.
 */
export function quote({ pro, social = false, plus = false }) {
  const base = social ? pro.social_price : pro.price;
  // Exemplo: sessão de R$ 100 com Me Salva+ → paciente paga R$ 90, profissional recebe R$ 88 e a plataforma fica com R$ 2.
  const discount = plus ? Math.round(base * PRICING.plusDiscount) : 0;
  const amount = base - discount;
  const pro_amount = Math.round(base * (1 - PRICING.commission));
  const fee = amount - pro_amount;
  return { base, discount, amount, fee, pro_amount };
}
