'use strict';

/* ============================================================
   Калькулятор: вилки / фрибеты (Фришка) / страховки / финрез
   Раздел «Фришка» — вилки + отыгрыш фрибета:
     чистый выигрыш фрибета W = K_f·C_f − C_f (ставка не возвращается)
     страховка исхода j: Cⱼ = W / Kⱼ
     прибыль = W·(1 − Σ 1/Kⱼ) → конверсия от номинала:
     (K_f − 1)·(1 − Σ 1/Kⱼ) · 100 %
     Рекомендация по K фрибета: 3–6 (оптимум 4–5), конверсия до (K−1)/K.
   Раздел «Страховка» — исход 1 (фикс) + перестраховки:
     прибыльᵢ = Kᵢ·Cᵢ − ΣC, подсказки по суммам страховок
   Раздел «Фин рез» — дневник результатов в localStorage.
   Общие формулы вилки:
     S = Σ 1/Kᵢ < 1;  Cᵢ = T·(1/Kᵢ)/S;  доходность = (1/S − 1)·100
   ============================================================ */

const MIN_ODDS = 1.01;
const MAX_OUTCOMES = 12;
/* минимальный отыгрыш фрибета, который реально ловится и имеет смысл брать */
const MIN_CONV = 45;

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

/* Рекомендация по коэффициенту фрибета.
   Статистика конверсии фрибетов (ставка без возврата):
     K 2.0 ≈ 50 %, 3.0 ≈ 67 %, 4.0 ≈ 75 %, 5.0 ≈ 80 %, 6.0 ≈ 83 %.
   Теоретический потолок конверсии = (K − 1) / K.
   Реалистичный минимум, который имеет смысл брать, — 45 % от номинала:
   ниже уже невыгодно с учётом риска и времени.
   Сладкая зона — K 3–6, оптимум 4–5: ниже 3 теряете деньги,
   выше 6 растёт дисперсия и риск лимитов в БК. */
function freeKAdvice(kf) {
  if (Number.isNaN(kf) || kf < MIN_ODDS) {
    return { text: 'K 3–6 · отыгрыш от 45 %', cls: '' };
  }
  const ceiling = (kf - 1) / kf * 100;
  const c = Math.max(0, ceiling).toFixed(0) + ' %';

  if (ceiling < MIN_CONV) return { text: `до ${c} · ниже 45 %`, cls: ' bad' };
  if (kf < 3) return { text: `до ${c} · лучше 3–6`, cls: ' warn' };
  if (kf <= 6) return { text: `до ${c} · мин. 45 %`, cls: ' ok' };
  return { text: `до ${c} · риск лимитов`, cls: ' warn' };
}

/* Процент конверсии фрибета: (K_f − 1)·(1 − Σ 1/Kⱼ) */
function freeConversion(kf, sumHedgeInv) {
  if (Number.isNaN(kf) || kf <= 1) return NaN;
  return (kf - 1) * (1 - sumHedgeInv) * 100;
}

/* ============================================================
   Даты и деньги для «Фин рез» (локальное время, не UTC)
   ============================================================ */

const FIN_KEY = 'vilk-fin';
const BANK_KEY = 'vilk-fin-bank';
const CHART_KEY = 'vilk-fin-chart';

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s) {
  const str = String(s || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return ymd(d) === str ? d : null;
}

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function signedMoney(n) {
  return (n > 0 ? '+' : '') + money(n);
}

function dayLabel(s, withWeekday) {
  const d = parseYmd(s);
  if (!d) return String(s);
  const opts = withWeekday
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat('ru-RU', opts).format(d).replace(/\./g, '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadFinance() {
  try {
    const raw = JSON.parse(localStorage.getItem(FIN_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(e => e && parseYmd(e.date) && Number.isFinite(e.amount) && e.amount !== 0)
      .map(e => ({
        id: String(e.id || newId()),
        date: e.date,
        amount: e.amount,
        created: Number(e.created) || 0,
      }));
  } catch (e) {
    return [];
  }
}

function loadBank() {
  try {
    const v = parseFloat(localStorage.getItem(BANK_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (e) {
    return 0;
  }
}

function loadChartMode() {
  try {
    return localStorage.getItem(CHART_KEY) === 'daily' ? 'daily' : 'cum';
  } catch (e) {
    return 'cum';
  }
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
    totalField: q('.js-total-field'),
    controls: q('.controls'),
    multiple: q('.js-multiple'),
    threshold: q('.js-threshold'),
    thresholdField: q('.js-threshold-field'),
    badge: q('.badge'),
    metricLabel: q('.metric-label'),
    profitLine: q('.js-profit'),
    profitSub: q('.js-profit-sub'),
    breakdown: q('.breakdown'),
  };
  const showFree = mode === 'free'; // в «Фришке» есть тумблер Фри
  const quickWrap = root.querySelector('.quick-free');
  const quickBtns = [...root.querySelectorAll('.quick-free .quick-btn')];

  const defaultRow = (opts) => {
    const o = (opts && typeof opts === 'object') ? opts : { fixed: !!opts };
    return { k: '', amt: '', fixed: !!o.fixed, free: !!o.free };
  };
  /* во «Фришке» исход 1 по умолчанию — фрибет (и автоматически фикс),
     в «Страховке» исход 1 просто фиксирован */
  const initialRows = () => mode === 'free'
    ? [defaultRow({ fixed: true, free: true }), defaultRow()]
    : [defaultRow(mode === 'insurance'), defaultRow()];
  let outcomes = initialRows();

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
        <div class="cell c-k"><label for="${mode}-k-${i}">Коэф-т</label>
          <input id="${mode}-k-${i}" type="text" class="k" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
        <div class="cell c-amt"><label for="${mode}-amt-${i}">Сумма</label>
          <input id="${mode}-amt-${i}" type="text" class="amt" inputmode="decimal" autocomplete="off" placeholder="0"></div>
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
        const wasFree = o.free;
        outcomes.splice(i, 1);
        /* фрибет не должен потеряться: переносим его на первый исход */
        if (wasFree && showFree && outcomes.length) {
          outcomes[0].free = true;
          outcomes[0].fixed = true;
        }
        renderRows();
        recalc();
      });

      els.rows.appendChild(row);
    });
  }

  /* ---------- основной расчёт ---------- */

  function recalc() {
    const m = Number(els.multiple.value); // 0 | 100 | 500 | 1000
    const ks = outcomes.map(o => parseNum(o.k));
    const free = isFreeMode();
    const fi = freeIdx();

    /* в режиме фрибета «общая сумма» не участвует и скрыта */
    const totalRaw = parseNum(els.total.value);
    const T = (!free && !Number.isNaN(totalRaw) && totalRaw > 0) ? totalRaw : 0;

    /* в режиме фрибета «общая сумма» и порог вилки не имеют смысла — скрываем */
    if (els.totalField) els.totalField.hidden = free;
    if (els.thresholdField) els.thresholdField.hidden = free;
    if (quickWrap) quickWrap.hidden = !free;
    if (els.controls && showFree) els.controls.classList.toggle('free-mode', free);
    if (els.metricLabel) els.metricLabel.textContent = free ? 'Прибыль фрибета' : 'Прибыль';
    if (els.add) els.add.disabled = outcomes.length >= MAX_OUTCOMES;

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
    let kf = NaN;   // коэффициент фрибета
    let cf = NaN;   // номинал фрибета
    let W = NaN;    // чистый выигрыш фрибета
    if (free) {
      kf = ks[fi];
      cf = parseNum(outcomes[fi].amt);
      if (!Number.isNaN(kf) && !Number.isNaN(cf) && cf > 0) W = kf * cf - cf;
    }
    let Sprime = 0; // Σ 1/K по перестраховкам
    if (free) {
      outcomes.forEach((o, j) => { if (j !== fi) Sprime += inv[j]; });
    }
    /* конверсия фрибета в % от номинала: (K_f − 1)·(1 − Σ 1/Kⱼ) */
    const convPct = free ? freeConversion(kf, Sprime) : NaN;

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
    } else if (!free && outcomes.some(o => !o.free && o.fixed && parseNum(o.amt) > 0)) {
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
    const real = profits.filter(p => !Number.isNaN(p));
    const worst = real.length ? Math.min(...real) : NaN;
    /* фактическая конверсия с учётом округления ставок */
    const actualConv = (invested > 0 && !Number.isNaN(worst) && cf > 0)
      ? worst / cf * 100
      : convPct;

    if (free) {
      const c = Number.isFinite(actualConv) ? Math.max(0, actualConv).toFixed(0) + ' %' : '';
      if (Sprime >= 1) {
        setBadge('bad', 'Отыгрыш в минус');
      } else if (kf > 6) {
        setBadge('weak', `K ${kf.toFixed(2).replace('.', ',')} · риск лимитов`);
      } else if (actualConv >= MIN_CONV) {
        setBadge('ok', `Фрибет отыграется · ${c}`);
      } else if (kf < 3) {
        setBadge('weak', `Низкий K · ${c}`);
      } else {
        setBadge('weak', `Слабый отыгрыш · ${c}`);
      }
    } else {
      const tPct = Number(els.threshold.value);
      if (theoPct >= tPct) setBadge('ok', 'Вилка найдена');
      else if (theoPct > 0) setBadge('weak', `Слабая вилка · +${pctStr(theoPct)}`);
      else setBadge('bad', `Вилки нет · маржа ${pctStr((S - 1) * 100)}`);
    }

    if (free) {
      if (invested > 0 && !Number.isNaN(worst) && cf > 0) {
        setHero(worst, actualConv, `реальные ставки ${money(invested)} · фрибет ${money(cf)}`);
      } else if (Number.isFinite(convPct)) {
        setHero(null, convPct, 'конверсия от номинала фрибета');
      } else {
        setHero(null, null, 'введите K фрибета и страховок');
      }
      setBreakdown(null, null);
    } else if (invested > 0) {
      setHero(worst, worst / invested * 100, `оборот ${money(invested)}`);
      setBreakdown(mode === 'insurance' ? profits : null, invested);
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
    const freeMode = isFreeMode();
    const fiRow = freeIdx();
    outcomes.forEach((o, i) => {
      const row = rowEls[i];
      if (!row) return;
      const amtIn = row.querySelector('.amt');
      const out = row.querySelector('.c-profit output');
      const fixIn = row.querySelector('.fix');
      const freeIn = row.querySelector('.free');

      row.querySelector('.c-name span').textContent = `Исход ${i + 1}`;
      row.querySelector('.del').disabled = outcomes.length <= 2;

      const amtLabel = row.querySelector('.c-amt label');
      if (amtLabel) amtLabel.textContent = (freeMode && i === fiRow) ? 'Номинал фрибета' : 'Сумма';

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

  /* Классическая вилка: чтобы доходность была ≥ t,
       1/Kᵢ ≤ 1/(1+t) − Σ_{j≠i} 1/Kⱼ
     Фрибет: вместо бесполезного «мин. K ≥ 1,01» показываем
       рекомендацию по K фрибета (3–6) и реальный отыгрыш
       (K_f − 1)·(1 − Σ 1/Kⱼ) в % от номинала.
   Сумма (когда у соседних исходов суммы известны):
         мин.  Cᵢ ≥ Σ Cⱼ / (Kᵢ − 1)
         опт.  вилка:   Cᵢ = min(Kⱼ·Cⱼ) / Kᵢ
               фрибет:  Cᵢ = W / Kᵢ                      */
  function updateHints(ks) {
    const m = Number(els.multiple.value);
    const t = Number(els.threshold.value) / 100;
    const free = isFreeMode();
    const fi = freeIdx();
    const cap = 1 / (1 + t); // порог классической вилки

    let W = NaN;
    let kf = NaN;
    let sumHedgeInv = 0;
    let allHedgeK = true;
    if (free) {
      kf = ks[fi];
      const cf = parseNum(outcomes[fi].amt);
      if (!Number.isNaN(kf) && !Number.isNaN(cf) && cf > 0) W = kf * cf - cf;
      outcomes.forEach((o, j) => {
        if (j === fi) return;
        const k2 = ks[j];
        if (!Number.isNaN(k2) && k2 >= MIN_ODDS) sumHedgeInv += 1 / k2;
        else allHedgeK = false;
      });
    }

    const rowEls = els.rows.children;

    outcomes.forEach((o, i) => {
      const kHint = rowEls[i]?.querySelector('.k-hint');
      const sHint = rowEls[i]?.querySelector('.s-hint');
      if (!kHint) return;

      const isFreeRow = free && i === fi;

      /* --- подсказка по коэффициенту --- */
      if (isFreeRow) {
        /* K фрибета влияет на размер выплаты и на потолок конверсии */
        const adv = freeKAdvice(kf);
        kHint.textContent = adv.text;
        kHint.className = 'k-hint' + adv.cls;
      } else if (free) {
        /* кэф перестраховки: показываем реальный отыгрыш, а не 1,01 */
        if (Number.isNaN(kf) || kf <= 1) {
          kHint.textContent = 'нужен K фрибета';
          kHint.className = 'k-hint';
        } else if (!allHedgeK) {
          /* кэф ещё не введён — честный противоположный для пары исходов */
          if (outcomes.length === 2) {
            const kOpp = kf / (kf - 1);
            kHint.textContent = 'противоположный ~' + kOpp.toFixed(2).replace('.', ',');
          } else {
            kHint.textContent = 'K противоположного исхода';
          }
          kHint.className = 'k-hint';
        } else if (sumHedgeInv >= 1) {
          kHint.textContent = 'отыгрыш в минус';
          kHint.className = 'k-hint bad';
        } else {
          const conv = freeConversion(kf, sumHedgeInv);
          const c = Math.max(0, conv).toFixed(0) + ' %';
          const good = conv >= MIN_CONV;
          kHint.textContent = good ? `отыгрыш ~${c}` : `отыгрыш ~${c} · ниже 45 %`;
          kHint.className = 'k-hint' + (good ? ' ok' : ' bad');
        }
      } else {
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
      let kI = ks[i];
      let kEstimated = false;
      /* в режиме фрибета кэф перестраховки ещё не введён —
         считаем подсказку от честного противоположного кэфа */
      if (free && !isFreeRow && (Number.isNaN(kI) || kI <= 1) &&
          outcomes.length === 2 && !Number.isNaN(kf) && kf > 1) {
        kI = kf / (kf - 1);
        kEstimated = true;
      }
      if (Number.isNaN(kI) || kI <= 1) {
        sHint.textContent = '';
        sHint.className = 's-hint';
        return;
      }

      if (isFreeRow) {
        if (Number.isNaN(W)) {
          sHint.textContent = 'введите номинал фрибета';
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
        if (Number.isNaN(W)) {
          sHint.textContent = 'введите номинал фрибета';
          sHint.className = 's-hint';
          return;
        }
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
      const approx = kEstimated ? '~' : '';
      if (Number.isNaN(optSum)) {
        text = `<span>мин. ${nfInt.format(minHint)} ₽</span>`;
      } else {
        let optHint = nearestM(optSum);
        if (Number.isFinite(maxSum) && optHint > maxSum) optHint = floorM(maxSum);
        if (optHint < minHint) optHint = minHint;
        text = minHint > 0
          ? `<span>мин. ${nfInt.format(minHint)} ₽</span> · <span>опт. ${approx}${nfInt.format(optHint)} ₽</span>`
          : `<span>опт. ${approx}${nfInt.format(optHint)} ₽</span>`;
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
    outcomes = initialRows();
    els.total.value = '';
    els.multiple.value = '100';
    els.threshold.value = '1';
    renderRows();
    recalc();
  });

  els.total.addEventListener('input', recalc);
  els.multiple.addEventListener('change', recalc);
  els.threshold.addEventListener('change', recalc);

  /* быстрые суммы номинала фрибета */
  quickBtns.forEach(btn => btn.addEventListener('click', () => {
    const fi = freeIdx();
    if (fi < 0) return;
    const val = btn.dataset.amt || '';
    outcomes[fi].amt = val;
    const row = els.rows.children[fi];
    const amtIn = row ? row.querySelector('.amt') : null;
    if (amtIn) { amtIn.value = val; amtIn.focus(); }
    recalc();
  }));

  renderRows();
  recalc();
}

/* ============================================================
   Раздел «Фин рез» — дневник результатов
   ============================================================ */

function createFinance(root) {
  const q = (sel) => root.querySelector(sel);
  const els = {
    badge: q('.badge'),
    today: q('.js-fin-today'),
    week: q('.js-fin-week'),
    month: q('.js-fin-month'),
    total: q('.js-fin-total'),
    best: q('.js-fin-best'),
    avg: q('.js-fin-avg'),
    count: q('.js-fin-count'),
    chart: q('.js-fin-chart'),
    date: q('.js-fin-date'),
    amount: q('.js-fin-amount'),
    plus: q('.js-sign-plus'),
    minus: q('.js-sign-minus'),
    add: q('.js-fin-add'),
    error: q('.js-fin-error'),
    note: q('.js-fin-note'),
    list: q('.js-fin-list'),
    clear: q('.js-fin-clear'),
    bank: q('.js-fin-bank'),
    bankNow: q('.js-fin-bank-now'),
    roi: q('.js-fin-roi'),
    exportBtn: q('.js-fin-export'),
    importBtn: q('.js-fin-import'),
    file: q('.js-fin-file'),
  };
  const quickBtns = [...root.querySelectorAll('.quick-btn')];

  let entries = loadFinance();
  let sign = 1;
  let lastToday = ymd(new Date());
  let startBank = loadBank();
  let chartMode = loadChartMode();
  let noteTimer = 0;

  const todayKey = () => ymd(new Date());
  const fromKey = (days) => ymd(addDays(startOfToday(), -(days - 1)));

  function save() {
    try { localStorage.setItem(FIN_KEY, JSON.stringify(entries)); } catch (e) {}
  }

  function setValue(el, n) {
    if (!el) return;
    el.textContent = signedMoney(n);
    el.classList.toggle('is-pos', n > 0);
    el.classList.toggle('is-neg', n < 0);
  }

  function totals() {
    const tk = todayKey();
    const from7 = fromKey(7);
    const from30 = fromKey(30);
    let today = 0, week = 0, month = 0, total = 0;
    entries.forEach(e => {
      total += e.amount;
      if (e.date === tk) today += e.amount;
      if (e.date >= from7 && e.date <= tk) week += e.amount;
      if (e.date >= from30 && e.date <= tk) month += e.amount;
    });
    return { today, week, month, total };
  }

  /* ---------- верхние карточки ---------- */

  function renderSummary() {
    const s = totals();
    setValue(els.today, s.today);
    setValue(els.week, s.week);
    setValue(els.month, s.month);
    setValue(els.total, s.total);

    const longDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date());
    if (els.badge) {
      els.badge.textContent = 'Сегодня · ' + longDate;
      els.badge.dataset.state = s.today > 0 ? 'ok' : (s.today < 0 ? 'bad' : 'idle');
    }

    /* лучший день и среднее за 30 дней */
    const byDay = new Map();
    entries.forEach(e => byDay.set(e.date, (byDay.get(e.date) || 0) + e.amount));

    let best = null;
    let bestDate = '';
    byDay.forEach((v, d) => {
      if (best === null || v > best) { best = v; bestDate = d; }
    });

    if (els.best) {
      if (best === null) {
        els.best.textContent = '—';
        els.best.classList.remove('is-pos', 'is-neg');
        els.best.title = '';
      } else {
        setValue(els.best, best);
        els.best.title = dayLabel(bestDate, true);
      }
    }
    if (els.avg) setValue(els.avg, s.month / 30);
    if (els.count) els.count.textContent = String(entries.length);

    /* банкролл и ROI от стартового банка */
    if (els.bankNow) {
      if (startBank > 0) {
        setValue(els.bankNow, startBank + s.total);
      } else {
        els.bankNow.textContent = '—';
        els.bankNow.classList.remove('is-pos', 'is-neg');
      }
    }
    if (els.roi) {
      if (startBank > 0) {
        const roi = s.total / startBank * 100;
        els.roi.textContent = (roi > 0 ? '+' : '') + pctStr(roi);
        els.roi.classList.toggle('is-pos', roi > 0);
        els.roi.classList.toggle('is-neg', roi < 0);
      } else {
        els.roi.textContent = '—';
        els.roi.classList.remove('is-pos', 'is-neg');
      }
    }
  }

  /* ---------- график за 30 дней ---------- */

  function renderChart() {
    if (!els.chart) return;

    const days = 30;
    const start = addDays(startOfToday(), -(days - 1));
    const startKey = ymd(start);
    const tk = todayKey();
    const inWindow = entries.filter(e => e.date >= startKey && e.date <= tk);

    if (!inWindow.length) {
      els.chart.hidden = true;
      els.chart.classList.remove('is-neg');
      els.chart.innerHTML = '';
      return;
    }

    const daily = new Map();
    inWindow.forEach(e => daily.set(e.date, (daily.get(e.date) || 0) + e.amount));
    const before = entries
      .filter(e => e.date < startKey)
      .reduce((a, e) => a + e.amount, 0);

    const dailyVals = [];
    for (let i = 0; i < days; i++) {
      dailyVals.push(daily.get(ymd(addDays(start, i))) || 0);
    }

    const cum = [];
    let acc = before;
    dailyVals.forEach(v => { acc += v; cum.push(acc); });

    const W = 600, H = 140, P = 8;
    const x = (i) => P + i * (W - 2 * P) / (days - 1);
    let body = '';

    if (chartMode === 'daily') {
      /* столбики дневных результатов */
      const lo = Math.min(0, ...dailyVals);
      const hi = Math.max(0, ...dailyVals);
      const span = (hi - lo) || 1;
      const y = (v) => P + (hi - v) / span * (H - 2 * P);
      const zeroY = y(0);
      const slot = (W - 2 * P) / days;
      const bw = Math.max(3, Math.min(26, slot - 3));
      const bars = dailyVals.map((v, i) => {
        if (v === 0) return '';
        const bx = P + i * slot + (slot - bw) / 2;
        const by = Math.min(y(v), zeroY);
        const bh = Math.max(1.5, Math.abs(y(v) - zeroY));
        return `<rect class="bar ${v > 0 ? 'pos' : 'neg'}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"></rect>`;
      }).join('');
      body = `<line class="zero" x1="${P}" y1="${zeroY.toFixed(1)}" x2="${W - P}" y2="${zeroY.toFixed(1)}"></line>${bars}`;
    } else {
      /* накопительная кривая */
      const lo = Math.min(...cum);
      const hi = Math.max(...cum);
      const span = (hi - lo) || 1;
      const y = (v) => P + (hi - v) / span * (H - 2 * P);
      const zeroIn = lo <= 0 && 0 <= hi;
      const baseY = zeroIn ? y(0) : (lo > 0 ? H - P : P);

      const pts = cum.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
      const line = 'M ' + pts.join(' L ');
      const area = `M ${x(0).toFixed(1)} ${baseY.toFixed(1)} L ` +
        pts.join(' L ') +
        ` L ${x(days - 1).toFixed(1)} ${baseY.toFixed(1)} Z`;
      const zeroLine = zeroIn
        ? `<line class="zero" x1="${P}" y1="${y(0).toFixed(1)}" x2="${W - P}" y2="${y(0).toFixed(1)}"></line>`
        : '';
      body = `${zeroLine}` +
        `<path class="area" d="${area}"></path>` +
        `<path class="line" d="${line}"></path>` +
        `<circle class="dot" cx="${x(days - 1).toFixed(1)}" cy="${y(cum[days - 1]).toFixed(1)}" r="3.5"></circle>`;
    }

    const total = chartMode === 'daily'
      ? dailyVals.reduce((a, b) => a + b, 0)
      : cum[days - 1];
    const cls = total > 0 ? 'is-pos' : (total < 0 ? 'is-neg' : '');

    els.chart.hidden = false;
    els.chart.classList.toggle('is-neg', total < 0);
    els.chart.innerHTML = `
      <div class="fin-chart-head">
        <div class="fin-chart-modes">
          <button type="button" class="mode${chartMode === 'cum' ? ' active' : ''}" data-mode="cum">Накопительно</button>
          <button type="button" class="mode${chartMode === 'daily' ? ' active' : ''}" data-mode="daily">По дням</button>
        </div>
        <span class="fin-chart-total ${cls}">${signedMoney(total)}</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Результат за последние 30 дней">${body}</svg>
      <div class="fin-chart-foot">
        <span>${escapeHtml(dayLabel(startKey))}</span>
        <span>сегодня</span>
      </div>`;
  }

  /* ---------- история по дням ---------- */

  function renderList() {
    if (!els.list) return;

    if (!entries.length) {
      els.list.innerHTML = '<p class="fin-empty">Пока нет записей — добавьте первый результат.</p>';
      return;
    }

    const sorted = [...entries].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.created || 0) - (a.created || 0);
    });

    const groups = [];
    sorted.forEach(e => {
      const g = groups[groups.length - 1];
      if (g && g.date === e.date) g.items.push(e);
      else groups.push({ date: e.date, items: [e] });
    });

    const tk = todayKey();
    els.list.innerHTML = groups.map(g => {
      const daySum = g.items.reduce((a, e) => a + e.amount, 0);
      const sumCls = daySum > 0 ? 'is-pos' : (daySum < 0 ? 'is-neg' : '');
      const label = (g.date === tk ? 'Сегодня · ' : '') + dayLabel(g.date, true);
      const rows = g.items.map(e => `
        <div class="fin-row">
          <span class="fin-row-amount ${e.amount > 0 ? 'is-pos' : 'is-neg'}">${signedMoney(e.amount)}</span>
          <button type="button" class="del js-fin-del" data-id="${escapeHtml(e.id)}" aria-label="Удалить запись">✕</button>
        </div>`).join('');
      return `<div class="fin-day">
        <div class="fin-day-head"><span>${escapeHtml(label)}</span><span class="${sumCls}">${signedMoney(daySum)}</span></div>
        ${rows}
      </div>`;
    }).join('');
  }

  function renderAll() {
    lastToday = todayKey();
    renderSummary();
    renderChart();
    renderList();
  }

  /* ---------- форма ---------- */

  function showError(msg) {
    if (els.note) els.note.hidden = true;
    if (!els.error) return;
    els.error.textContent = msg;
    els.error.hidden = false;
  }

  function hideError() {
    if (!els.error) return;
    els.error.hidden = true;
    els.error.textContent = '';
  }

  function showNote(msg) {
    if (els.error) els.error.hidden = true;
    if (!els.note) return;
    els.note.textContent = msg;
    els.note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => { if (els.note) els.note.hidden = true; }, 4000);
  }

  function setSign(s) {
    sign = s;
    if (els.plus) {
      els.plus.classList.toggle('active', s > 0);
      els.plus.setAttribute('aria-pressed', String(s > 0));
    }
    if (els.minus) {
      els.minus.classList.toggle('active', s < 0);
      els.minus.setAttribute('aria-pressed', String(s < 0));
    }
  }

  function syncDateBounds() {
    if (!els.date) return;
    const tk = todayKey();
    els.date.max = tk;
    if (!els.date.value || els.date.value > tk) els.date.value = tk;
  }

  function addEntry() {
    const date = els.date ? els.date.value : '';
    const amount = parseNum(els.amount ? els.amount.value : '');
    const tk = todayKey();

    if (!parseYmd(date)) return showError('Укажите дату результата');
    if (date > tk) return showError('Дата не может быть в будущем');
    if (!Number.isFinite(amount) || amount <= 0) return showError('Введите сумму больше нуля');

    entries.push({
      id: newId(),
      date,
      amount: sign * amount,
      created: Date.now(),
    });
    save();
    if (els.amount) els.amount.value = '';
    hideError();
    renderAll();
    if (els.amount) els.amount.focus();
  }

  if (els.plus) els.plus.addEventListener('click', () => setSign(1));
  if (els.minus) els.minus.addEventListener('click', () => setSign(-1));
  if (els.add) els.add.addEventListener('click', addEntry);
  if (els.amount) {
    els.amount.addEventListener('input', hideError);
    els.amount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addEntry(); }
    });
  }
  if (els.date) els.date.addEventListener('change', hideError);

  /* быстрые суммы — подставляют значение в поле */
  quickBtns.forEach(btn => btn.addEventListener('click', () => {
    if (!els.amount) return;
    els.amount.value = btn.dataset.amt || '';
    hideError();
    els.amount.focus();
  }));

  /* стартовый банкролл */
  if (els.bank) {
    if (startBank > 0) els.bank.value = String(startBank);
    els.bank.addEventListener('input', () => {
      const v = parseNum(els.bank.value);
      startBank = Number.isFinite(v) && v > 0 ? v : 0;
      try { localStorage.setItem(BANK_KEY, startBank > 0 ? String(startBank) : ''); } catch (err) {}
      renderSummary();
    });
  }

  /* экспорт дневника в JSON */
  if (els.exportBtn) {
    els.exportBtn.addEventListener('click', () => {
      if (!entries.length) return showNote('Пока нечего экспортировать — добавьте записи');
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finrez-${todayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showNote(`Файл сохранён: finrez-${todayKey()}.json`);
    });
  }

  /* импорт из JSON (объединение с текущими записями) */
  if (els.importBtn && els.file) {
    els.importBtn.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', async () => {
      const file = els.file.files && els.file.files[0];
      els.file.value = '';
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        if (!Array.isArray(raw)) throw new Error('not an array');
        const incoming = raw
          .filter(e => e && parseYmd(e.date) && Number.isFinite(e.amount) && e.amount !== 0)
          .map(e => ({
            id: String(e.id || newId()),
            date: e.date,
            amount: e.amount,
            created: Number(e.created) || 0,
          }));
        const byId = new Map(entries.map(e => [e.id, e]));
        let added = 0;
        incoming.forEach(e => {
          if (!byId.has(e.id)) { byId.set(e.id, e); added++; }
        });
        entries = [...byId.values()];
        save();
        renderAll();
        showNote(added ? `Импортировано записей: ${added}` : 'Новых записей нет — всё уже есть');
      } catch (err) {
        showError('Не удалось прочитать файл — нужен JSON из «Экспорт»');
      }
    });
  }

  /* переключение режима графика */
  if (els.chart) {
    els.chart.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode');
      if (!btn) return;
      chartMode = btn.dataset.mode === 'daily' ? 'daily' : 'cum';
      try { localStorage.setItem(CHART_KEY, chartMode); } catch (err) {}
      renderChart();
    });
  }

  if (els.list) {
    els.list.addEventListener('click', (e) => {
      const btn = e.target.closest('.js-fin-del');
      if (!btn) return;
      const id = btn.dataset.id;
      entries = entries.filter(x => String(x.id) !== id);
      save();
      renderAll();
    });
  }

  if (els.clear) {
    els.clear.addEventListener('click', () => {
      if (!entries.length) return;
      if (!window.confirm('Удалить все записи из истории результатов?')) return;
      entries = [];
      save();
      renderAll();
    });
  }

  /* синхронизация между вкладками и обновление «сегодня» после сна */
  window.addEventListener('storage', (e) => {
    if (e.key === FIN_KEY) {
      entries = loadFinance();
      renderAll();
    } else if (e.key === BANK_KEY) {
      startBank = loadBank();
      if (els.bank) els.bank.value = startBank > 0 ? String(startBank) : '';
      renderSummary();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    syncDateBounds();
    renderAll();
  });

  /* если страница открыта через полночь — обновляем «сегодня» */
  window.setInterval(() => {
    if (todayKey() !== lastToday) {
      syncDateBounds();
      renderAll();
    }
  }, 60000);

  setSign(1);
  syncDateBounds();
  renderAll();

  return {
    refresh() {
      syncDateBounds();
      renderAll();
    },
  };
}

/* ---------- разделы (вкладки внизу) ---------- */

const tabs = [...document.querySelectorAll('.tabbar .tab')];
const views = {
  free: document.getElementById('view-free'),
  insurance: document.getElementById('view-insurance'),
  finance: document.getElementById('view-finance'),
};
let finance = null;

function applyTab(name) {
  if (!views[name]) name = 'free';
  tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  Object.entries(views).forEach(([key, view]) => { view.hidden = key !== name; });
  if (name === 'finance' && finance) finance.refresh();
  try { localStorage.setItem('vilk-tab', name); } catch (e) {}
}

tabs.forEach(b => b.addEventListener('click', () => applyTab(b.dataset.tab)));

createCalc(views.free, 'free');
createCalc(views.insurance, 'insurance');
finance = createFinance(views.finance);

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

/* ---------- iPhone: не даём клавиатуре спрятать поле ввода ---------- */
(function keepFieldVisible() {
  const isField = (el) => !!(el && el.matches && el.matches('input, select, textarea'));
  const narrow = window.matchMedia('(max-width: 600px)');
  let timer = 0;
  let focusedAt = 0;

  function ensureVisible() {
    const el = document.activeElement;
    if (!isField(el)) return;

    const vv = window.visualViewport;
    const tabbar = document.querySelector('.tabbar');
    const tabH = (narrow.matches && tabbar) ? tabbar.getBoundingClientRect().height + 10 : 0;

    const rect = el.getBoundingClientRect();
    const top = (vv ? vv.offsetTop : 0) + 12;
    const bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 12 - tabH;

    let delta = 0;
    if (rect.bottom > bottom) delta = rect.bottom - bottom;
    else if (rect.top < top) delta = rect.top - top;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  }

  function schedule(fromFocus) {
    if (fromFocus) focusedAt = Date.now();
    clearTimeout(timer);
    /* ждём, пока Safari дорисует клавиатуру и изменит visual viewport */
    timer = window.setTimeout(() => {
      if (Date.now() - focusedAt > 3000) return;
      ensureVisible();
    }, 280);
  }

  document.addEventListener('focusin', (e) => {
    if (isField(e.target)) schedule(true);
  }, true);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => schedule(false));
  }
})();
