'use strict';

/* ============================================================
   Калькулятор букмекерских вилок
   Формулы:
     S  = Σ (1 / Kᵢ)               — сумма обратных коэф-тов
     Вилка есть, если S < 1
     Доходность, % = (1 / S − 1) · 100
     Сумма на исход i (при общей сумме T):
        Cᵢ = T · (1/Kᵢ) / S  → выплата Kᵢ·Cᵢ = T/S одинакова
     Фиксированный исход j (без общей суммы):
        P = Kⱼ·Cⱼ  →  Cᵢ = P / Kᵢ,  оборот = P·S
     Прибыль исхода i = Kᵢ·Cᵢ − ΣC
   ============================================================ */

const els = {
  rows: document.getElementById('rows'),
  add: document.getElementById('addOutcome'),
  reset: document.getElementById('reset'),
  total: document.getElementById('total'),
  multiple: document.getElementById('multiple'),
  badge: document.getElementById('arbBadge'),
  profitLine: document.getElementById('profitLine'),
  profitSub: document.getElementById('profitSub'),
  theme: document.getElementById('themeToggle'),
  gta: document.getElementById('gtaToggle'),
};

const MIN_ODDS = 1.01;   // минимальный коэффициент
const MAX_OUTCOMES = 12;

/* state: [{ k: '2.1', amt: '950', fixed: false, auto: false }] */
let outcomes = [
  { k: '', amt: '', fixed: false },
  { k: '', amt: '', fixed: false },
];

/* ---------- утилиты ---------- */

const nfInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nfDec = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseNum(v) {
  if (typeof v !== 'string') return NaN;
  const s = v.replace(/\s/g, '').replace(/,/g, '.');
  if (s === '' || s === '.') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function roundBy(x, m) {
  if (!m) return Math.round(x * 100) / 100;
  let r = Math.round(x / m) * m;
  if (r === 0) r = m; // минимальная ставка кратности
  return r;
}

function money(n) {
  const s = nfInt.format(Math.abs(Math.round(n)));
  return (n < 0 ? '−' : '') + s + ' ₽';
}

function pctStr(n) {
  return (n < 0 ? '−' : '') + Math.abs(n).toFixed(2).replace('.', ',') + ' %';
}

/* ---------- рендер строк ---------- */

function renderRows() {
  els.rows.innerHTML = '';
  outcomes.forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'row';

    row.innerHTML = `
      <div class="cell c-name"><span>Исход ${i + 1}</span></div>
      <div class="cell c-k"><label>Коэф-т</label>
        <input type="text" class="k" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
      <div class="cell c-amt"><label>Сумма</label>
        <input type="text" class="amt" inputmode="decimal" autocomplete="off" placeholder="0"></div>
      <div class="cell c-profit"><label>Прибыль</label><output>—</output></div>
      <div class="cell c-fix"><label>Фикс</label>
        <label class="switch"><input type="checkbox" class="fix"><span class="track"></span></label></div>
      <div class="cell c-del"><button class="del" aria-label="Удалить исход">✕</button></div>`;

    const kIn = row.querySelector('.k');
    const amtIn = row.querySelector('.amt');
    const fixIn = row.querySelector('.fix');
    const delBtn = row.querySelector('.del');

    row.querySelector('.c-k').insertAdjacentHTML('beforeend', '<div class="k-hint"></div>');

    kIn.value = o.k;
    amtIn.value = o.amt;
    fixIn.checked = o.fixed;
    delBtn.disabled = outcomes.length <= 2;

    kIn.addEventListener('input', () => { o.k = kIn.value; recalc(); });
    amtIn.addEventListener('input', () => { o.amt = amtIn.value; recalc(); });
    fixIn.addEventListener('change', () => { o.fixed = fixIn.checked; recalc(); });
    delBtn.addEventListener('click', () => {
      outcomes.splice(i, 1);
      renderRows();
      recalc();
    });

    els.rows.appendChild(row);
  });
}

/* ---------- основной расчёт ---------- */

function recalc() {
  const m = Number(els.multiple.value); // 0 | 100 | 500 | 1000
  const totalRaw = parseNum(els.total.value);
  const T = (!Number.isNaN(totalRaw) && totalRaw > 0) ? totalRaw : 0;

  const ks = outcomes.map(o => parseNum(o.k));
  const valid = ks.every(k => !Number.isNaN(k) && k >= MIN_ODDS);

  /* подсказка минимального кэфа — считается даже при незаполненных полях */
  updateHints(ks);

  if (!valid) {
    outcomes.forEach(o => { o.auto = false; });
    setBadge('idle', 'Введите коэффициенты');
    setHero(null, null, 0);
    applyRows([]);
    return;
  }

  const inv = ks.map(k => 1 / k);
  const S = inv.reduce((a, b) => a + b, 0);
  const theoPct = (1 / S - 1) * 100; // теоретическая доходность вилки

  const hasAnchor = outcomes.some(o => o.fixed && parseNum(o.amt) > 0);

  if (T > 0) {
    /* --- распределяем общую сумму --- */
    let sumFixed = 0;
    outcomes.forEach(o => {
      if (o.fixed && parseNum(o.amt) > 0) { o.auto = false; sumFixed += parseNum(o.amt); }
      else o.auto = true;
    });

    const rest = T - sumFixed;
    const autoIdx = [];
    outcomes.forEach((o, i) => { if (o.auto) autoIdx.push(i); });

    if (autoIdx.length && rest > 0) {
      const invAuto = autoIdx.map(i => inv[i]);
      const sumInv = invAuto.reduce((a, b) => a + b, 0);
      const alloc = autoIdx.map((i, j) => roundBy(rest * invAuto[j] / sumInv, m));

      // подгоняем итог под rest: разницу округления добавляем самой большой ставке
      const diff = rest - alloc.reduce((a, b) => a + b, 0);
      if (autoIdx.length > 1) {
        let li = 0;
        alloc.forEach((v, j) => { if (v > alloc[li]) li = j; });
        alloc[li] = Math.max(0, alloc[li] + diff);
      }

      autoIdx.forEach((i, j) => { outcomes[i].amt = alloc[j] > 0 ? String(alloc[j]) : ''; });
    } else {
      autoIdx.forEach(i => { outcomes[i].amt = ''; });
    }
  } else if (hasAnchor) {
    /* --- нет общей суммы, но есть фикс: остальные считаем от него --- */
    const ai = outcomes.findIndex(o => o.fixed && parseNum(o.amt) > 0);
    const P = ks[ai] * parseNum(outcomes[ai].amt); // выплата якорного исхода
    outcomes.forEach((o, i) => {
      if (i === ai) { o.auto = false; return; }
      const val = roundBy(P * inv[i], m);
      o.amt = String(val);
      o.auto = true;
    });
  } else {
    /* --- полностью ручной ввод --- */
    outcomes.forEach(o => { o.auto = false; });
  }

  /* --- прибыль по исходам и сводка --- */
  const vals = outcomes.map(o => parseNum(o.amt));
  const invested = vals.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
  const profits = ks.map((k, i) => (Number.isNaN(vals[i]) ? 0 : k * vals[i]) - invested);

  setBadge(S < 1 ? 'ok' : 'bad',
    S < 1 ? 'Вилка найдена' : `Вилки нет · маржа ${pctStr((S - 1) * 100)}`);

  if (invested > 0) {
    const worst = Math.min(...profits); // гарантированная (худшая) прибыль
    setHero(worst, (worst / invested) * 100, invested);
  } else {
    setHero(null, theoPct, 0);
  }

  applyRows(profits, vals, invested);
}

/* ---------- вывод ---------- */

/* Минимальный коэффициент для вилки:
   для исхода i нужно 1/Kᵢ < 1 − Σ_{j≠i} (1/Kⱼ)
   →  Kᵢ_min = 1 / (1 − Σ_{j≠i} 1/Kⱼ) */
function updateHints(ks) {
  const rowEls = els.rows.children;
  outcomes.forEach((o, i) => {
    const hint = rowEls[i]?.querySelector('.k-hint');
    if (!hint) return;

    let others = 0;
    let hasOther = false;
    outcomes.forEach((o2, j) => {
      if (j === i) return;
      const k2 = ks[j];
      if (!Number.isNaN(k2) && k2 >= MIN_ODDS) { others += 1 / k2; hasOther = true; }
    });

    if (!hasOther) { hint.textContent = ''; hint.className = 'k-hint'; return; }

    if (others >= 1) {
      hint.textContent = 'вилка невозможна';
      hint.className = 'k-hint bad';
      return;
    }

    const minK = Math.max(1 / (1 - others), MIN_ODDS);
    const kCur = ks[i];
    const ok = !Number.isNaN(kCur) && kCur >= minK;
    hint.textContent = 'мин. K ≥ ' + minK.toFixed(2).replace('.', ',');
    hint.className = 'k-hint' + (ok ? ' ok' : '');
  });
}

function setBadge(state, text) {
  els.badge.dataset.state = state;
  els.badge.textContent = text;
}

function setHero(rub, pctVal, invested) {
  const el = els.profitLine;
  el.classList.remove('is-pos', 'is-neg');

  if (rub !== null) {
    el.innerHTML =
      `<span class="${rub >= 0 ? 'is-pos' : 'is-neg'}">${rub >= 0 ? '+' : ''}${money(rub)}</span>` +
      `<span class="sep"> · </span>` +
      `<span class="pct ${pctVal >= 0 ? 'is-pos' : 'is-neg'}">${pctVal >= 0 ? '+' : ''}${pctStr(pctVal)}</span>`;
    els.profitSub.textContent = `оборот ${money(invested)}`;
  } else if (pctVal !== null) {
    el.innerHTML = `<span class="pct ${pctVal >= 0 ? 'is-pos' : 'is-neg'}">${pctVal >= 0 ? '+' : ''}${pctStr(pctVal)}</span>`;
    els.profitSub.textContent = 'теоретическая доходность · введите суммы';
  } else {
    el.textContent = '—';
    els.profitSub.textContent = 'введите коэффициенты и суммы';
  }
}

function applyRows(profits, vals, invested) {
  const rowEls = els.rows.children;
  outcomes.forEach((o, i) => {
    const row = rowEls[i];
    if (!row) return;
    const amtIn = row.querySelector('.amt');
    const out = row.querySelector('.c-profit output');
    const name = row.querySelector('.c-name span');

    name.textContent = `Исход ${i + 1}`;
    row.querySelector('.del').disabled = outcomes.length <= 2;

    // авто-поля только для чтения
    if (o.auto) {
      if (amtIn.readOnly !== true) { amtIn.readOnly = true; amtIn.value = o.amt; }
      else if (amtIn.value !== o.amt) amtIn.value = o.amt;
    } else {
      amtIn.readOnly = false;
    }

    if (invested > 0 && !Number.isNaN(vals[i]) && vals[i] > 0) {
      const p = profits[i];
      out.textContent = (p >= 0 ? '+' : '') + money(p);
      out.classList.toggle('is-pos', p > 0);
      out.classList.toggle('is-neg', p < 0);
    } else {
      out.textContent = '—';
      out.classList.remove('is-pos', 'is-neg');
    }
  });
}

/* ---------- события ---------- */

els.add.addEventListener('click', () => {
  if (outcomes.length >= MAX_OUTCOMES) return;
  outcomes.push({ k: '', amt: '', fixed: false });
  renderRows();
  recalc();
});

els.total.addEventListener('input', recalc);
els.multiple.addEventListener('change', recalc);

els.reset.addEventListener('click', () => {
  outcomes = [
    { k: '', amt: '', fixed: false },
    { k: '', amt: '', fixed: false },
  ];
  els.total.value = '';
  els.multiple.value = '100';
  renderRows();
  recalc();
});

/* ---------- темы (тёмная / светлая / GTA VI) ---------- */

let baseTheme = 'dark'; // обычная тема, к которой возвращаемся из GTA-стиля

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  els.theme.textContent = t === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('vilk-theme', t); } catch (e) {}
}

els.theme.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'gta' ? baseTheme : (cur === 'dark' ? 'light' : 'dark');
  applyTheme(next);
});

els.gta.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  if (cur === 'gta') {
    applyTheme(baseTheme);
  } else {
    baseTheme = cur;
    applyTheme('gta');
  }
});

applyTheme(document.documentElement.dataset.theme || 'dark');
if (document.documentElement.dataset.theme !== 'gta') {
  baseTheme = document.documentElement.dataset.theme;
}

/* ---------- старт ---------- */
renderRows();
recalc();
