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
  threshold: document.getElementById('threshold'),
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
    row.querySelector('.c-amt').insertAdjacentHTML('beforeend', '<div class="s-hint"></div>');

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

  const tPct = Number(els.threshold.value); // мин. доходность, %
  if (theoPct >= tPct) {
    setBadge('ok', 'Вилка найдена');
  } else if (theoPct > 0) {
    setBadge('weak', `Слабая вилка · +${pctStr(theoPct)}`);
  } else {
    setBadge('bad', `Вилки нет · маржа ${pctStr((S - 1) * 100)}`);
  }

  if (invested > 0) {
    const worst = Math.min(...profits); // гарантированная (худшая) прибыль
    setHero(worst, (worst / invested) * 100, invested);
  } else {
    setHero(null, theoPct, 0);
  }

  applyRows(profits, vals, invested);
}

/* ---------- вывод ---------- */

/* Подсказки под полями каждого исхода.
   К:  чтобы вилка давала доходность ≥ t:
       1/Kᵢ ≤ 1/(1+t) − Σ_{j≠i} 1/Kⱼ  →  Kᵢ_min = 1 / (1/(1+t) − Σ...)
   Сумма (когда у других исходов суммы уже известны):
       мин.  Cᵢ ≥ Σ_{j≠i} Cⱼ / (Kᵢ − 1)          — безубыточная
       опт.  Cᵢ ≈ min_{j≠i}(Kⱼ·Cⱼ) / Kᵢ          — выравнивает прибыль */
function updateHints(ks) {
  const t = Number(els.threshold.value) / 100; // порог доходности, доля
  const cap = 1 / (1 + t);                     // максимум суммы вероятностей остальных
  const rowEls = els.rows.children;

  outcomes.forEach((o, i) => {
    const kHint = rowEls[i]?.querySelector('.k-hint');
    const sHint = rowEls[i]?.querySelector('.s-hint');
    if (!kHint) return;

    /* --- подсказка по коэффициенту --- */
    let othersInv = 0;
    let hasOtherK = false;
    outcomes.forEach((o2, j) => {
      if (j === i) return;
      const k2 = ks[j];
      if (!Number.isNaN(k2) && k2 >= MIN_ODDS) { othersInv += 1 / k2; hasOtherK = true; }
    });

    if (!hasOtherK) {
      kHint.textContent = '';
      kHint.className = 'k-hint';
    } else if (othersInv >= cap - 1e-12) {
      kHint.textContent = 'вилка невозможна';
      kHint.className = 'k-hint bad';
    } else {
      const minK = Math.max(1 / (cap - othersInv), MIN_ODDS);
      const kCur = ks[i];
      const ok = !Number.isNaN(kCur) && kCur >= minK;
      kHint.textContent = 'мин. K ≥ ' + minK.toFixed(2).replace('.', ',');
      kHint.className = 'k-hint' + (ok ? ' ok' : '');
    }

    /* --- подсказка по сумме --- */
    if (!sHint) return;
    const kI = ks[i];
    if (Number.isNaN(kI) || kI <= 1) {
      sHint.textContent = '';
      sHint.className = 's-hint';
      return;
    }

    let sumOthers = 0;
    let minPayout = Infinity;
    let hasOtherAmt = false;
    outcomes.forEach((o2, j) => {
      if (j === i) return;
      const c2 = parseNum(o2.amt);
      if (Number.isNaN(c2) || c2 <= 0) return;
      hasOtherAmt = true;
      sumOthers += c2;
      const k2 = ks[j];
      if (!Number.isNaN(k2) && k2 >= MIN_ODDS) minPayout = Math.min(minPayout, k2 * c2);
    });

    if (!hasOtherAmt || !Number.isFinite(minPayout)) {
      sHint.textContent = '';
      sHint.className = 's-hint';
      return;
    }

    const minSum = sumOthers / (kI - 1);   // ниже — этот исход в минусе
    const optSum = minPayout / kI;         // выравнивает прибыль по исходам
    const maxSum = minPayout - sumOthers;  // выше — соседний исход в минусе

    if (maxSum < minSum - 1e-9) {
      sHint.textContent = 'вилка невозможна';
      sHint.className = 's-hint bad';
      return;
    }

    /* подсказки — в заданной кратности сумм */
    const m = Number(els.multiple.value);
    const ceilM = x => m ? Math.ceil(x / m) * m : Math.ceil(x);
    const nearestM = x => m ? Math.round(x / m) * m : Math.round(x);
    const floorM = x => m ? Math.floor(x / m) * m : Math.floor(x);

    const minHint = ceilM(minSum);
    if (minHint > maxSum + 1e-9) {
      sHint.textContent = 'вилка невозможна';
      sHint.className = 's-hint bad';
      return;
    }
    let optHint = nearestM(optSum);
    if (optHint > maxSum) optHint = floorM(maxSum);   // не задираем выше потолка соседей
    if (optHint < minHint) optHint = minHint;

    const cCur = parseNum(o.amt);
    const ok = !Number.isNaN(cCur) && cCur >= minSum - 1e-9 && cCur <= maxSum + 1e-9;
    sHint.innerHTML =
      `<span>мин. ${nfInt.format(minHint)} ₽</span> · <span>опт. ${nfInt.format(optHint)} ₽</span>`;
    sHint.className = 's-hint' + (ok ? ' ok' : '');
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
els.threshold.addEventListener('change', recalc);

els.reset.addEventListener('click', () => {
  outcomes = [
    { k: '', amt: '', fixed: false },
    { k: '', amt: '', fixed: false },
  ];
  els.total.value = '';
  els.multiple.value = '100';
  els.threshold.value = '1';
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
