'use strict';

/* ============================================================
   Калькулятор: вилки / фрибеты (Фришка) / страховки
   Раздел «Фришка» — вилки + отыгрыш фрибета:
     чистый выигрыш фрибета W = K_f·C_f − C_f (ставка не возвращается)
     страховка исхода j: Cⱼ = W / Kⱼ → прибыль = W·(1 − Σ 1/Kⱼ)
     порог доходности: Σ 1/Kⱼ ≤ 1 − t
   Раздел «Страховка» — исход 1 (фикс) + перестраховки:
     прибыльᵢ = Kᵢ·Cᵢ − ΣC, подсказки по суммам страховок
   Общие формулы вилки:
     S = Σ 1/Kᵢ < 1;  Cᵢ = T·(1/Kᵢ)/S;  доходность = (1/S − 1)·100
   ============================================================ */

const MIN_ODDS = 1.01;
const MAX_OUTCOMES = 12;

const nfInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

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
  if (r === 0) r = m;
  return r;
}

function money(n) {
  const s = nfInt.format(Math.abs(Math.round(n)));
  return (n < 0 ? '−' : '') + s + ' ₽';
}

function pctStr(n) {
  return (n < 0 ? '−' : '') + Math.abs(n).toFixed(2).replace('.', ',') + ' %';
}

/* ============================================================
   Один калькулятор (раздел)
   ============================================================ */

function createCalc(root, mode) {
  const q = (sel) => root.querySelector(sel);
  const els = {
    rows: q('.js-rows'),
    add: q('.js-add'),
    reset: q('.js-reset'),
    total: q('.js-total'),
    multiple: q('.js-multiple'),
    threshold: q('.js-threshold'),
    badge: q('.badge'),
    profitLine: q('.js-profit'),
    profitSub: q('.js-profit-sub'),
    breakdown: q('.breakdown'),
  };
  const showFree = mode === 'free'; // в «Фришке» есть тумблер Фри

  const defaultRow = (fixed) => ({ k: '', amt: '', fixed: !!fixed, free: false });
  let outcomes = [
    defaultRow(mode === 'insurance'), // в «Страховке» исход 1 фиксирован
    defaultRow(false),
  ];

  const freeIdx = () => outcomes.findIndex(o => o.free);
  const isFreeMode = () => showFree && freeIdx() >= 0;

  /* ---------- рендер строк ---------- */

  function renderRows() {
    els.rows.innerHTML = '';
    outcomes.forEach((o, i) => {
      const row = document.createElement('div');
      row.className = 'row' + (showFree ? '' : ' no-free');
      row.innerHTML = `
        <div class="cell c-name"><span>Исход ${i + 1}</span></div>
        <div class="cell c-k"><label>Коэф-т</label>
          <input type="text" class="k" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
        <div class="cell c-amt"><label>Сумма</label>
          <input type="text" class="amt" inputmode="decimal" autocomplete="off" placeholder="0"></div>
        <div class="cell c-profit"><label>Прибыль</label><output>—</output></div>
        <div class="cell c-flags">
          <div class="flag"><span>Фикс</span>
            <label class="switch sm"><input type="checkbox" class="fix"><span class="track"></span></label></div>
          <div class="flag flag-free"><span>Фри</span>
            <label class="switch sm"><input type="checkbox" class="free"><span class="track"></span></label></div>
        </div>
        <div class="cell c-del"><button class="del" aria-label="Удалить исход">✕</button></div>`;

      const kIn = row.querySelector('.k');
      const amtIn = row.querySelector('.amt');
      const fixIn = row.querySelector('.fix');
      const freeIn = row.querySelector('.free');
      const delBtn = row.querySelector('.del');

      kIn.value = o.k;
      amtIn.value = o.amt;
      fixIn.checked = o.fixed;
      if (showFree) freeIn.checked = o.free;
      delBtn.disabled = outcomes.length <= 2;

      row.querySelector('.c-k').insertAdjacentHTML('beforeend', '<div class="k-hint"></div>');
      row.querySelector('.c-amt').insertAdjacentHTML('beforeend', '<div class="s-hint"></div>');

      kIn.addEventListener('input', () => { o.k = kIn.value; recalc(); });
      amtIn.addEventListener('input', () => { if (!o.auto) { o.amt = amtIn.value; recalc(); } });
      fixIn.addEventListener('change', () => { o.fixed = fixIn.checked; recalc(); });
      if (showFree) {
        freeIn.addEventListener('change', () => {
          o.free = freeIn.checked;
          if (o.free) {
            o.fixed = true; // фришка автоматически фиксируется
            outcomes.forEach((o2, j) => { if (j !== i) o2.free = false; });
            renderRows();
          }
          recalc();
        });
      }
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
    const t = Number(els.threshold.value) / 100; // порог доходности, доля
    const totalRaw = parseNum(els.total.value);
    const T = (!Number.isNaN(totalRaw) && totalRaw > 0) ? totalRaw : 0;

    const ks = outcomes.map(o => parseNum(o.k));
    const free = isFreeMode();
    const fi = freeIdx();

    updateHints(ks);

    const valid = ks.every(k => !Number.isNaN(k) && k >= MIN_ODDS);
    if (!valid) {
      outcomes.forEach(o => { o.auto = false; });
      setBadge('idle', 'Введите коэффициенты');
      setHero(null, null, 'введите коэффициенты и суммы');
      setBreakdown(null, null);
      applyRows([], []);
      return;
    }

    const inv = ks.map(k => 1 / k);
    const S = inv.reduce((a, b) => a + b, 0);
    const theoPct = (1 / S - 1) * 100;

    /* --- параметры фрибета --- */
    let W = NaN; // чистый выигрыш фрибета
    if (free) {
      const kf = ks[fi];
      const cf = parseNum(outcomes[fi].amt);
      if (!Number.isNaN(kf) && !Number.isNaN(cf) && cf > 0) W = kf * cf - cf;
    }
    let Sprime = NaN; // Σ 1/K по перестраховкам
    if (free) {
      Sprime = 0;
      outcomes.forEach((o, j) => { if (j !== fi) Sprime += inv[j]; });
    }
    const theoFree = (1 - Sprime) * 100; // доходность отыгрыша, % от номинала фрибета

    /* --- распределение сумм --- */
    if (T > 0) {
      let sumFixed = 0;
      outcomes.forEach(o => {
        if (o.free) { o.auto = false; return; } // фрибет не тратит реальные деньги
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
        if (autoIdx.length > 1) {
          const diff = rest - alloc.reduce((a, b) => a + b, 0);
          let li = 0;
          alloc.forEach((v, j) => { if (v > alloc[li]) li = j; });
          alloc[li] = Math.max(0, alloc[li] + diff);
        }
        autoIdx.forEach((i, j) => { outcomes[i].amt = alloc[j] > 0 ? String(alloc[j]) : ''; });
      } else {
        autoIdx.forEach(i => { outcomes[i].amt = ''; });
      }
    } else if (free && !Number.isNaN(W)) {
      /* отыгрыш фрибета: каждая перестраховка покрывает чистый выигрыш W */
      outcomes.forEach((o, i) => {
        if (i === fi) { o.auto = false; return; }
        if (o.fixed && parseNum(o.amt) > 0) { o.auto = false; return; }
        const val = roundBy(W * inv[i], m);
        o.amt = String(val);
        o.auto = true;
      });
    } else if (outcomes.some(o => !o.free && o.fixed && parseNum(o.amt) > 0)) {
      /* фикс-якорь: остальные исходы считаем от него */
      const ai = outcomes.findIndex(o => !o.free && o.fixed && parseNum(o.amt) > 0);
      const P = ks[ai] * parseNum(outcomes[ai].amt);
      outcomes.forEach((o, i) => {
        if (i === ai) { o.auto = false; return; }
        const val = roundBy(P * inv[i], m);
        o.amt = String(val);
        o.auto = true;
      });
    } else {
      outcomes.forEach(o => { o.auto = false; });
    }

    /* --- прибыль по исходам --- */
    const vals = outcomes.map(o => parseNum(o.amt));
    const v = x => Number.isNaN(x) ? 0 : x;
    let invested = 0; // реальные деньги
    outcomes.forEach((o, i) => {
      if (free && i === fi) return; // ставка фрибета — не наши деньги
      invested += v(vals[i]);
    });

    const profits = outcomes.map((o, i) => {
      const stake = v(vals[i]);
      if (free && i === fi) {
        return Number.isNaN(W) ? NaN : W - invested;
      }
      return stake > 0 ? ks[i] * stake - invested : NaN;
    });

    /* --- сводка --- */
    if (free) {
      const tPct = t * 100;
      if (theoFree >= tPct) setBadge('ok', 'Фрибет отыграется');
      else if (theoFree > 0) setBadge('weak', `Слабый отыгрыш · +${pctStr(theoFree)}`);
      else setBadge('bad', 'Вилка невозможна');
    } else {
      const tPct = Number(els.threshold.value);
      if (theoPct >= tPct) setBadge('ok', 'Вилка найдена');
      else if (theoPct > 0) setBadge('weak', `Слабая вилка · +${pctStr(theoPct)}`);
      else setBadge('bad', `Вилки нет · маржа ${pctStr((S - 1) * 100)}`);
    }

    const baseLabel = free ? 'реальные ставки' : 'оборот';
    if (invested > 0) {
      const real = profits.filter(p => !Number.isNaN(p));
      const worst = real.length ? Math.min(...real) : NaN;
      setHero(worst, worst / invested * 100, `${baseLabel} ${money(invested)}`);
      setBreakdown(mode === 'insurance' ? profits : null, invested);
    } else if (free && !Number.isNaN(W)) {
      setHero(null, theoFree, 'от номинала фрибета · введите суммы страховок');
      setBreakdown(null, null);
    } else {
      setHero(null, theoPct, 'теоретическая доходность · введите суммы');
      setBreakdown(null, null);
    }

    applyRows(profits, vals, invested);
  }

  /* ---------- вывод ---------- */

  function setBadge(state, text) {
    els.badge.dataset.state = state;
    els.badge.textContent = text;
  }

  function setHero(rub, pctVal, sub) {
    const el = els.profitLine;
    el.classList.remove('is-pos', 'is-neg');

    if (rub !== null && !Number.isNaN(rub)) {
      el.innerHTML =
        `<span class="${rub >= 0 ? 'is-pos' : 'is-neg'}">${rub >= 0 ? '+' : ''}${money(rub)}</span>` +
        `<span class="sep"> · </span>` +
        `<span class="pct ${pctVal >= 0 ? 'is-pos' : 'is-neg'}">${pctVal >= 0 ? '+' : ''}${pctStr(pctVal)}</span>`;
      els.profitSub.textContent = sub;
    } else if (pctVal !== null && !Number.isNaN(pctVal)) {
      el.innerHTML = `<span class="pct ${pctVal >= 0 ? 'is-pos' : 'is-neg'}">${pctVal >= 0 ? '+' : ''}${pctStr(pctVal)}</span>`;
      els.profitSub.textContent = sub;
    } else {
      el.textContent = '—';
      els.profitSub.textContent = sub || 'введите коэффициенты и суммы';
    }
  }

  /* итоги по исходам в «Страховке»: если сыграет исход N */
  function setBreakdown(profits, invested) {
    if (!els.breakdown) return;
    if (!profits || !(invested > 0)) {
      els.breakdown.hidden = true;
      els.breakdown.innerHTML = '';
      return;
    }
    els.breakdown.hidden = false;
    els.breakdown.innerHTML = profits.map((p, i) => {
      const label = i === 0 ? 'Если сыграет Исход 1' : `Если сыграет Исход ${i + 1}`;
      const cls = Number.isNaN(p) ? '' : (p >= 0 ? ' is-pos' : ' is-neg');
      const val = Number.isNaN(p) ? '—' : (p >= 0 ? '+' : '') + money(p);
      return `<div class="bd-item"><span class="bd-label">${label}</span><span class="bd-value${cls}">${val}</span></div>`;
    }).join('');
  }

  function applyRows(profits, vals, invested) {
    const rowEls = els.rows.children;
    outcomes.forEach((o, i) => {
      const row = rowEls[i];
      if (!row) return;
      const amtIn = row.querySelector('.amt');
      const out = row.querySelector('.c-profit output');
      const fixIn = row.querySelector('.fix');
      const freeIn = row.querySelector('.free');

      row.querySelector('.c-name span').textContent = `Исход ${i + 1}`;
      row.querySelector('.del').disabled = outcomes.length <= 2;

      if (o.auto) {
        if (!amtIn.readOnly) { amtIn.readOnly = true; amtIn.value = o.amt; }
        else if (amtIn.value !== o.amt) amtIn.value = o.amt;
      } else {
        amtIn.readOnly = false;
      }

      if (fixIn.checked !== o.fixed) fixIn.checked = o.fixed;
      fixIn.disabled = o.free; // фришка всегда зафиксирована
      if (showFree) freeIn.disabled = false;

      const p = profits[i];
      if (invested > 0 && !Number.isNaN(vals[i]) && vals[i] > 0 && !Number.isNaN(p)) {
        out.textContent = (p >= 0 ? '+' : '') + money(p);
        out.classList.toggle('is-pos', p > 0);
        out.classList.toggle('is-neg', p < 0);
      } else {
        out.textContent = '—';
        out.classList.remove('is-pos', 'is-neg');
      }
    });
  }

  /* ---------- подсказки ---------- */

  /* К:  чтобы доходность была ≥ t:
         вилка:      1/Kᵢ ≤ 1/(1+t) − Σ_{j≠i} 1/Kⱼ
         фрибет:     Σ 1/Kⱼ (по перестраховкам) ≤ 1 − t
   Сумма (когда у соседних исходов суммы известны):
         мин.  Cᵢ ≥ Σ Cⱼ / (Kᵢ − 1)
         опт.  вилка:   Cᵢ = min(Kⱼ·Cⱼ) / Kᵢ
               фрибет:  Cᵢ = W / Kᵢ                      */
  function updateHints(ks) {
    const m = Number(els.multiple.value);
    const t = Number(els.threshold.value) / 100;
    const free = isFreeMode();
    const fi = freeIdx();
    const cap = free ? 1 - t : 1 / (1 + t);

    let W = NaN;
    if (free) {
      const kf = ks[fi];
      const cf = parseNum(outcomes[fi].amt);
      if (!Number.isNaN(kf) && !Number.isNaN(cf) && cf > 0) W = kf * cf - cf;
    }

    const rowEls = els.rows.children;

    outcomes.forEach((o, i) => {
      const kHint = rowEls[i]?.querySelector('.k-hint');
      const sHint = rowEls[i]?.querySelector('.s-hint');
      if (!kHint) return;

      const isFreeRow = free && i === fi;

      /* --- подсказка по коэффициенту --- */
      if (isFreeRow) {
        /* кэф фрибета влияет только на размер выплаты, не на доходность */
        kHint.textContent = '';
        kHint.className = 'k-hint';
      } else {
        let othersInv = 0;
        let hasOtherK = false;
        outcomes.forEach((o2, j) => {
          if (j === i || (free && j === fi)) return; // кэф фрибета не участвует
          const k2 = ks[j];
          if (!Number.isNaN(k2) && k2 >= MIN_ODDS) { othersInv += 1 / k2; hasOtherK = true; }
        });
        /* в отыгрыше фрибета подсказка работает и без других кэфов */
        if (free) hasOtherK = true;

        if (!hasOtherK) {
          kHint.textContent = '';
          kHint.className = 'k-hint';
        } else if (othersInv >= 1 - 1e-12) {
          kHint.textContent = 'вилка невозможна';
          kHint.className = 'k-hint bad';
        } else if (othersInv >= cap - 1e-12) {
          kHint.textContent = 'ниже порога';
          kHint.className = 'k-hint warn';
        } else {
          const minK = Math.max(1 / (cap - othersInv), MIN_ODDS);
          const kCur = ks[i];
          const ok = !Number.isNaN(kCur) && kCur >= minK;
          kHint.textContent = 'мин. K ≥ ' + minK.toFixed(2).replace('.', ',');
          kHint.className = 'k-hint' + (ok ? ' ok' : '');
        }
      }

      /* --- подсказка по сумме --- */
      if (!sHint) return;
      const kI = ks[i];
      if (Number.isNaN(kI) || kI <= 1) {
        sHint.textContent = '';
        sHint.className = 's-hint';
        return;
      }

      if (isFreeRow) {
        if (Number.isNaN(W)) {
          sHint.textContent = '';
          sHint.className = 's-hint';
        } else {
          sHint.innerHTML = `<span>чистый выигрыш ${nfInt.format(Math.round(W))} ₽</span>`;
          sHint.className = 's-hint';
        }
        return;
      }

      let sumOthers = 0;
      let minPayout = Infinity;
      let hasOtherAmt = false;
      outcomes.forEach((o2, j) => {
        if (j === i || (free && j === fi)) return; // фрибет — не трата
        const c2 = parseNum(o2.amt);
        if (Number.isNaN(c2) || c2 <= 0) return;
        hasOtherAmt = true;
        sumOthers += c2;
        const k2 = ks[j];
        if (!Number.isNaN(k2) && k2 >= MIN_ODDS) minPayout = Math.min(minPayout, k2 * c2);
      });

      let minSum, optSum, maxSum;
      if (free) {
        if (Number.isNaN(W)) { sHint.textContent = ''; sHint.className = 's-hint'; return; }
        /* отыгрыш фрибета: считаем от чистого выигрыша W */
        minSum = hasOtherAmt ? sumOthers / (kI - 1) : 0;
        optSum = W / kI;
        maxSum = W - sumOthers;
      } else {
        if (!hasOtherAmt || !Number.isFinite(minPayout)) {
          sHint.textContent = '';
          sHint.className = 's-hint';
          return;
        }
        minSum = sumOthers / (kI - 1);
        optSum = minPayout / kI;
        maxSum = minPayout - sumOthers;
      }

      if (maxSum < minSum - 1e-9) {
        sHint.textContent = 'вилка невозможна';
        sHint.className = 's-hint bad';
        return;
      }

      /* подсказки — в заданной кратности сумм */
      const ceilM = x => m ? Math.ceil(x / m) * m : Math.ceil(x);
      const nearestM = x => m ? Math.round(x / m) * m : Math.round(x);
      const floorM = x => m ? Math.floor(x / m) * m : Math.floor(x);

      const minHint = ceilM(minSum);
      if (Number.isFinite(maxSum) && minHint > maxSum + 1e-9) {
        sHint.textContent = 'вилка невозможна';
        sHint.className = 's-hint bad';
        return;
      }

      let text;
      if (Number.isNaN(optSum)) {
        text = `<span>мин. ${nfInt.format(minHint)} ₽</span>`;
      } else {
        let optHint = nearestM(optSum);
        if (Number.isFinite(maxSum) && optHint > maxSum) optHint = floorM(maxSum);
        if (optHint < minHint) optHint = minHint;
        text = minHint > 0
          ? `<span>мин. ${nfInt.format(minHint)} ₽</span> · <span>опт. ${nfInt.format(optHint)} ₽</span>`
          : `<span>опт. ${nfInt.format(optHint)} ₽</span>`;
      }

      const cCur = parseNum(o.amt);
      const ok = !Number.isNaN(cCur) && cCur >= minSum - 1e-9 &&
        (!Number.isFinite(maxSum) || cCur <= maxSum + 1e-9);
      sHint.innerHTML = text;
      sHint.className = 's-hint' + (ok ? ' ok' : '');
    });
  }

  /* ---------- события ---------- */

  els.add.addEventListener('click', () => {
    if (outcomes.length >= MAX_OUTCOMES) return;
    outcomes.push(defaultRow(false));
    renderRows();
    recalc();
  });

  els.reset.addEventListener('click', () => {
    outcomes = [defaultRow(mode === 'insurance'), defaultRow(false)];
    els.total.value = '';
    els.multiple.value = '100';
    els.threshold.value = '1';
    renderRows();
    recalc();
  });

  els.total.addEventListener('input', recalc);
  els.multiple.addEventListener('change', recalc);
  els.threshold.addEventListener('change', recalc);

  renderRows();
  recalc();
}

/* ---------- разделы (вкладки внизу) ---------- */

const tabs = [...document.querySelectorAll('.tabbar .tab')];
const views = {
  free: document.getElementById('view-free'),
  insurance: document.getElementById('view-insurance'),
};

function applyTab(name) {
  if (!views[name]) name = 'free';
  tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  Object.entries(views).forEach(([key, view]) => { view.hidden = key !== name; });
  try { localStorage.setItem('vilk-tab', name); } catch (e) {}
}

tabs.forEach(b => b.addEventListener('click', () => applyTab(b.dataset.tab)));

createCalc(views.free, 'free');
createCalc(views.insurance, 'insurance');

let savedTab = 'free';
try { savedTab = localStorage.getItem('vilk-tab') || 'free'; } catch (e) {}
applyTab(savedTab);

/* ---------- темы (тёмная / светлая / GTA VI) ---------- */

const themeBtn = document.getElementById('themeToggle');
const gtaBtn = document.getElementById('gtaToggle');
let baseTheme = 'dark';

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('vilk-theme', t); } catch (e) {}
}

themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  applyTheme(cur === 'gta' ? baseTheme : (cur === 'dark' ? 'light' : 'dark'));
});

gtaBtn.addEventListener('click', () => {
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
