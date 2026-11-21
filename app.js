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
  profitRub: document.getElementById('profitRub'),
  profitRubSub: document.getElementById('profitRubSub'),
  profitPct: document.getElementById('profitPct'),
  theme: document.getElementById('themeToggle'),
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

function setBadge(state, text) {
  els.badge.dataset.state = state;
  els.badge.textContent = text;
}

function setHero(rub, pctVal, invested) {
  if (rub === null) {
    els.profitRub.textContent = '—';
    els.profitRub.classList.remove('is-pos', 'is-neg');
    els.profitRubSub.textContent = invested > 0 ? `оборот ${money(invested)}` : 'введите суммы';
  } else {
    els.profitRub.textContent = (rub >= 0 ? '+' : '') + money(rub);
    els.profitRub.classList.toggle('is-pos', rub > 0);
    els.profitRub.classList.toggle('is-neg', rub < 0);
    els.profitRubSub.textContent = `оборот ${money(invested)}`;
  }

  if (pctVal === null) {
    els.profitPct.textContent = '—';
    els.profitPct.classList.remove('is-pos', 'is-neg');
  } else {
    els.profitPct.textContent = (pctVal >= 0 ? '+' : '') + pctStr(pctVal);
    els.profitPct.classList.toggle('is-pos', pctVal > 0);
    els.profitPct.classList.toggle('is-neg', pctVal < 0);
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

/* ---------- тема ---------- */

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  els.theme.textContent = t === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('vilk-theme', t); } catch (e) {}
}

els.theme.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

applyTheme(document.documentElement.dataset.theme || 'dark');

/* ---------- старт ---------- */
renderRows();
recalc();
