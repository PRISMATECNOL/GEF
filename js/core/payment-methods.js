/**
 * GEF | FORMAS DE PAGAMENTO POR MOEDA/PAÍS DA LOJA
 * Loja em Angola (moeda Kz) usa automaticamente as formas de pagamento angolanas.
 * Os códigos gravados são os do sistema (DINHEIRO, POS_CARTAO, TRANSFERENCIA já existiam);
 * os novos (MULTICAIXA_EXPRESS, REFERENCIA_MULTICAIXA, CARTEIRA_MOVEL) exigem a migração v9.
 */
import { i18n } from './i18n.js';

export const ANGOLA_METHODS = [
  { id: 'DINHEIRO', label: 'Numerário (Kz)' },
  { id: 'MULTICAIXA_EXPRESS', label: 'Multicaixa Express' },
  { id: 'POS_CARTAO', label: 'TPA/POS' },
  { id: 'TRANSFERENCIA', label: 'Transferência bancária (IBAN)' },
  { id: 'REFERENCIA_MULTICAIXA', label: 'Referência Multicaixa' },
  { id: 'CARTEIRA_MOVEL', label: 'Carteira móvel' }
];

export const DEFAULT_METHODS = [
  { id: 'DINHEIRO', label: 'Dinheiro' },
  { id: 'M-PESA', label: 'M-Pesa' },
  { id: 'E-MOLA', label: 'e-Mola' },
  { id: 'POS_CARTAO', label: 'Cartão POS' },
  { id: 'TRANSFERENCIA', label: 'Transferência' }
];

const FIADO = { id: 'CREDITO_FIADO', label: 'Crédito Fiado' };
const ALL_LABELS = Object.fromEntries([...ANGOLA_METHODS, ...DEFAULT_METHODS, FIADO, { id: 'FIADO', label: 'Fiado' }].map((m) => [m.id, m.label]));

export const isAngola = (currency = i18n.getCurrency()) => currency === 'Kz';

/** Formas de pagamento da loja actual. withCredit = inclui «Crédito Fiado» (venda a crédito, não é meio de pagamento). */
export function getPaymentMethods({ withCredit = true, currency } = {}) {
  const base = isAngola(currency) ? ANGOLA_METHODS : DEFAULT_METHODS;
  return withCredit ? [...base, FIADO] : [...base];
}

/** Rótulo de um código; em lojas de Angola «Dinheiro» aparece como «Numerário (Kz)». */
export function paymentMethodLabel(id, currency) {
  if (id === 'DINHEIRO' && isAngola(currency)) return 'Numerário (Kz)';
  if (id === 'POS_CARTAO' && isAngola(currency)) return 'TPA/POS';
  if (id === 'TRANSFERENCIA' && isAngola(currency)) return 'Transferência bancária (IBAN)';
  return ALL_LABELS[id] || id;
}
