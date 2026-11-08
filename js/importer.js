// Parsers for bank statement files: CSV, OFX/QFX and QIF. Pure — unit tested.
// Each returns [{ date: 'YYYY-MM-DD', amount: cents (negative = money out), description, notes? }].
import { parseAmount } from './money.js';

const pad2 = (n) => String(n).padStart(2, '0');

/** Parse a date in many bank formats. `order` is 'dmy' or 'mdy' for ambiguous slashes. */
export function parseBankDate(s, order = 'dmy') {
  const t = String(s || '').trim().replace(/^"|"$/g, '');
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(m[1], m[2], m[3]);
  m = t.match(/^(\d{4})(\d{2})(\d{2})/); // OFX 20261108120000
  if (m) return valid(m[1], m[2], m[3]);
  m = t.match(/^(\d{1,2})[-/.'](\d{1,2})[-/.'](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = `20${y}`;
    let [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    if (Number(mo) > 12 && Number(d) <= 12) [d, mo] = [mo, d];
    return valid(y, mo, d);
  }
  return null;
}

function valid(y, mo, d) {
  const Y = Number(y); const M = Number(mo); const D = Number(d);
  if (!(M >= 1 && M <= 12 && D >= 1 && D <= 31 && Y > 1900)) return null;
  return `${Y}-${pad2(M)}-${pad2(D)}`;
}

function money(s) {
  const raw = String(s ?? '').trim().replace(/^"|"$/g, '');
  if (!raw) return null;
  const neg = /^\(.*\)$/.test(raw) || /^[-−]/.test(raw) || /-$/.test(raw);
  const p = parseAmount(raw.replace(/[()−-]/g, '').replace(/[^\d.,]/g, ''), { allowZero: true });
  if (!p.ok) return null;
  return neg ? -p.cents : p.cents;
}

// ---------- CSV ----------
export function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const H = {
  date: /^(date|booking date|transaction date|posted date|data|datum|value date|completed date|started date)$/i,
  desc: /^(description|details|payee|name|merchant|memo|narrative|reference|transaction details|përshkrimi|beschreibung|counterparty)$/i,
  amount: /^(amount|value|sum|shuma|betrag|amount \(.*\)|transaction amount)$/i,
  debit: /^(debit|withdrawal|withdrawals|money out|paid out|out)$/i,
  credit: /^(credit|deposit|deposits|money in|paid in|in)$/i,
  notes: /^(notes|note|category|type)$/i,
};

/** Guess the columns of a CSV header. */
export function csvColumns(header) {
  const find = (re) => header.findIndex((h) => re.test(h.trim()));
  return { date: find(H.date), desc: find(H.desc), amount: find(H.amount), debit: find(H.debit), credit: find(H.credit), notes: find(H.notes) };
}

export function parseCsv(text, { order = 'dmy' } = {}) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('The file has no transactions.');
  const sep = [',', ';', '\t'].map((s) => [s, lines[0].split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const header = splitCsvLine(lines[0], sep);
  const c = csvColumns(header);
  if (c.date < 0 || (c.amount < 0 && c.debit < 0 && c.credit < 0)) {
    throw new Error('Couldn’t find the Date and Amount columns. The first row must be a header like: Date, Description, Amount.');
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line, sep);
    const date = parseBankDate(f[c.date], order);
    if (!date) continue;
    let amount = c.amount >= 0 ? money(f[c.amount]) : null;
    if (amount == null) {
      const out = c.debit >= 0 ? money(f[c.debit]) : null;
      const inn = c.credit >= 0 ? money(f[c.credit]) : null;
      if (out) amount = -Math.abs(out);
      else if (inn) amount = Math.abs(inn);
    }
    if (!amount) continue;
    rows.push({ date, amount, description: (c.desc >= 0 ? f[c.desc] : '') || (amount < 0 ? 'Expense' : 'Income'), notes: c.notes >= 0 ? f[c.notes] || undefined : undefined });
  }
  return rows;
}

// ---------- OFX / QFX ----------
export function parseOfx(text) {
  const rows = [];
  const blocks = String(text).split(/<STMTTRN>/i).slice(1);
  const tag = (b, name) => {
    const m = b.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  for (const b of blocks) {
    const date = parseBankDate(tag(b, 'DTPOSTED'));
    const amount = money(tag(b, 'TRNAMT'));
    if (!date || !amount) continue;
    const name = tag(b, 'NAME') || tag(b, 'PAYEE');
    const memo = tag(b, 'MEMO');
    rows.push({ date, amount, description: decode(name || memo || (amount < 0 ? 'Expense' : 'Income')), notes: name && memo ? decode(memo) : undefined });
  }
  if (!rows.length) throw new Error('No transactions found in this OFX file.');
  return rows;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"');

// ---------- QIF ----------
export function parseQif(text, { order = 'mdy' } = {}) {
  const rows = [];
  let cur = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('!')) continue;
    const k = line[0];
    const v = line.slice(1).trim();
    if (k === '^') {
      if (cur.date && cur.amount) rows.push({ date: cur.date, amount: cur.amount, description: cur.payee || cur.memo || (cur.amount < 0 ? 'Expense' : 'Income'), notes: cur.payee && cur.memo ? cur.memo : undefined });
      cur = {};
    } else if (k === 'D') cur.date = parseBankDate(v.replace(/'/g, '/'), order);
    else if (k === 'T' || k === 'U') cur.amount = money(v);
    else if (k === 'P') cur.payee = v;
    else if (k === 'M') cur.memo = v;
  }
  if (!rows.length) throw new Error('No transactions found in this QIF file.');
  return rows;
}

/** Pick the parser from the file name / content. */
export function parseStatement(name, text, opts = {}) {
  const n = String(name).toLowerCase();
  if (n.endsWith('.ofx') || n.endsWith('.qfx') || /<OFX>/i.test(text)) return parseOfx(text);
  if (n.endsWith('.qif') || /^!Type:/im.test(text)) return parseQif(text, opts);
  return parseCsv(text, opts);
}

/** Rows already in the account (same date, amount and description) are skipped. */
export function dedupe(rows, existing) {
  const key = (date, amount, desc) => `${date}|${amount}|${String(desc || '').trim().toLowerCase()}`;
  const have = new Set(existing.map((t) => key(t.date, t.amount, t.description)));
  const out = [];
  for (const r of rows) {
    const k = key(r.date, r.amount, r.description);
    if (have.has(k)) continue;
    have.add(k);
    out.push(r);
  }
  return out;
}
