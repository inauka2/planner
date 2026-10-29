// Money helpers. All amounts are stored as integer minor units ("cents")
// in their ORIGINAL currency. Different currencies are never added together without
// going through toAllCents() with an explicit exchange rate.
//
// "rates" = how many ALL one unit is worth: { EUR: 97, USD: 90 }.
// A plain number is accepted as the EUR rate (older data and tests).

export const CURRENCIES = ['ALL', 'EUR', 'USD'];
export const FOREIGN = ['EUR', 'USD'];
export const CURRENCY_NAMES = { ALL: 'Lek', EUR: 'Euro', USD: 'Dollar' };
export const MAX_CENTS = 1e13; // 100 billion units — far beyond any personal amount

export const isCurrency = (c) => CURRENCIES.includes(c);
const pad2 = (n) => String(n).padStart(2, '0');

const BAD_FORMAT = 'Use numbers only, e.g. 1500 or 12.50';

/**
 * Parse a user-typed amount into integer cents.
 * Accepts "1500", "12.50", "12,50", "1,250.50", "1.250,50", "1 250".
 * Rejects ambiguous input such as "12.500" (thousands or decimals?).
 */
export function parseAmount(input, { allowNegative = false, allowZero = false } = {}) {
  let s = String(input ?? '')
    .trim()
    .replace(/[\s ']/g, '')
    .replace(/^(€|\$|eur|usd|all|lek)/i, '')
    .replace(/(€|\$|eur|usd|all|lek)$/i, '');
  if (!s) return { ok: false, error: 'Enter an amount' };

  let neg = false;
  if (s[0] === '-' || s[0] === '−') {
    neg = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return { ok: false, error: BAD_FORMAT };

  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  let intPart = s;
  let frac = '';

  if (commas && dots) {
    // Mixed separators: the last one is the decimal separator.
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    const i = s.lastIndexOf(dec);
    if (s.indexOf(dec) !== i) return { ok: false, error: BAD_FORMAT };
    const groups = s.slice(0, i).split(thou);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) {
      return { ok: false, error: BAD_FORMAT };
    }
    intPart = groups.join('');
    frac = s.slice(i + 1);
  } else if (commas + dots === 1) {
    const i = s.search(/[.,]/);
    intPart = s.slice(0, i);
    frac = s.slice(i + 1);
    if (frac.length > 2) {
      return { ok: false, error: 'Use at most 2 decimals (for thousands just type 12500)' };
    }
  } else if (commas + dots > 1) {
    // Same separator repeated: thousands separators, e.g. 1,250,000
    const groups = s.split(commas ? ',' : '.');
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) {
      return { ok: false, error: BAD_FORMAT };
    }
    intPart = groups.join('');
  }

  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(frac)) return { ok: false, error: BAD_FORMAT };

  const cents = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { ok: false, error: 'Amount is too large' };
  if (cents === 0 && !allowZero) return { ok: false, error: 'Amount must be more than 0' };
  if (neg && cents && !allowNegative) return { ok: false, error: 'Amount must be positive' };
  return { ok: true, cents: neg && cents ? -cents : cents };
}

/** Parse an exchange rate "1 EUR = x ALL". */
export function parseRate(input) {
  const s = String(input ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return { ok: false, error: 'Enter a rate like 97.5' };
  const rate = Number(s);
  if (!(rate > 0) || rate >= 100000) return { ok: false, error: 'Rate must be between 0 and 100000' };
  return { ok: true, rate };
}

function rateOf(rates, currency) {
  return typeof rates === 'number' ? (currency === 'EUR' ? rates : undefined) : rates?.[currency];
}

/** Convert cents in `currency` to ALL cents using the rate for that currency. */
export function toAllCents(cents, currency, rates) {
  if (currency === 'ALL') return cents;
  if (!FOREIGN.includes(currency)) throw new Error(`Unknown currency ${currency}`);
  const r = rateOf(rates, currency);
  if (!(r > 0)) throw new Error(`A valid ${currency} exchange rate is required`);
  return Math.round(cents * r);
}

/** Convert between any two supported currencies (via ALL). */
export function convertCents(cents, from, to, rates) {
  if (from === to) return cents;
  const all = toAllCents(cents, from, rates);
  if (to === 'ALL') return all;
  const r = rateOf(rates, to);
  if (!(r > 0)) throw new Error(`A valid ${to} exchange rate is required`);
  return Math.round(all / r);
}

/** Sum a {ALL, EUR, USD} pair into an ALL equivalent. */
export function combinedAll(pair, rates) {
  let total = pair.ALL || 0;
  for (const c of FOREIGN) if (pair[c]) total += toAllCents(pair[c], c, rates);
  return total;
}

export function formatMoney(cents, currency, { plus = false } = {}) {
  const abs = Math.abs(cents || 0);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = cents < 0 ? '−' : plus && cents > 0 ? '+' : '';
  if (currency === 'EUR') return `${sign}€${w}.${pad2(frac)}`;
  if (currency === 'USD') return `${sign}$${w}.${pad2(frac)}`;
  return `${sign}${w}${frac ? '.' + pad2(frac) : ''} ALL`;
}

/** Cents → string suitable for an <input> value. */
export function centsToInput(cents) {
  if (cents == null) return '';
  const abs = Math.abs(cents);
  const frac = abs % 100;
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)}${frac ? '.' + pad2(frac) : ''}`;
}

export function formatRate(rate) {
  return String(Number(Number(rate).toFixed(4)));
}
