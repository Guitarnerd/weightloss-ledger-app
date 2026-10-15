// Weightloss Ledger: screen and GitHub sync. The logic lives in core.js.
(function () {
  'use strict';
  const C = window.Core;
  const $ = id => document.getElementById(id);
  const PATHS = { food: 'data/food.csv', weight: 'data/weight.csv', days: 'data/days.csv',
    targets: 'targets.md', reference: 'data/reference.json',
    plans: 'data/plans.csv', events: 'data/events.csv', orders: 'data/orders.csv' };
  // Added with the morning check-in: if the ledger doesn't have them yet, start them empty.
  const OPTIONAL = { [PATHS.plans]: C.PLAN_FIELDS, [PATHS.events]: C.EVENT_FIELDS, [PATHS.orders]: C.ORDER_FIELDS };
  const QUICK = ['200 g 2% milk', '1 scoop protein powder', '170 g nonfat vanilla Greek yogurt', '1 bag broccoli',
    '1/8 cup shredded cheddar', '1 tbsp ranch dressing', '1 cup baby carrots', '3 eggs', '3 small corn tortillas'];
  const PLACEHOLDER = {
    breakfast: 'e.g. 200 g 2% milk, 1 scoop protein powder', lunch: 'e.g. turkey sandwich, 1 apple',
    afternoon: 'e.g. 170 g Greek yogurt', dinner: 'e.g. 6 oz chicken, 1 cup rice, 1 bag broccoli',
    evening: 'e.g. 170 g Greek yogurt, 1 scoop protein powder',
  };
  const FAVORITES = "Favorites I'm choosing (2 or 3). One plate.";

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };
  const state = { files: {}, day: 'today', busy: false, logTag: '', planner: null, planDate: null, moreSlots: false };
  let backend = null;

  // ---- Backends: GitHub contents API (core.js), or in-memory demo data ----

  const github = C.github;

  function demo() {
    const today = C.chicagoNow().date, y = C.addDays(today, -1);
    const id = d => d.replace(/-/g, '');
    const files = {
      [PATHS.targets]: 'Calories: 1700\nProtein: 170 g\nCarbs: 128 g\nFat: 57 g\nGoal weight: 215 lb\n',
      [PATHS.food]: C.toCSV(C.FOOD_FIELDS, [
        { date: y, time: '12:10', entry_id: id(y) + '-01', item: '2% milk', quantity: 200, unit: 'g', calories: 100, protein_g: 7, carbs_g: 10, fat_g: 4, source: 'app', note: '' },
        { date: y, time: '18:40', entry_id: id(y) + '-02', item: 'Homemade chili', quantity: 1, unit: 'cup', calories: 280, protein_g: 20, carbs_g: 24, fat_g: 12, source: 'app', note: '' },
        { date: y, time: '18:40', entry_id: id(y) + '-02', item: 'Cornbread', quantity: 1, unit: 'piece', calories: 180, protein_g: 3, carbs_g: 28, fat_g: 6, source: 'app', note: '' }]),
      [PATHS.weight]: C.toCSV(C.WEIGHT_FIELDS, Array.from({ length: 40 }, (_, i) => (
        { date: C.addDays(today, i - 40), weight_lb: (262 - i * 0.08 + Math.sin(i * 1.7) * 1.4).toFixed(1), note: '' }))),
      [PATHS.days]: C.toCSV(C.DAYS_FIELDS, Array.from({ length: 5 }, (_, n) => ({ date: C.addDays(today, -2 - n), status: 'complete', note: '' }))
        .filter(r => r.date >= '2026-10-01').reverse()),
      [PATHS.reference]: JSON.stringify([
        { name: '2% milk', aliases: ['milk'], grams: 100, calories: 50, protein_g: 3.5, carbs_g: 5, fat_g: 2, units: { cup: 244 }, default: 'cup' },
        { name: 'Vanilla protein powder', aliases: ['protein powder'], grams: 40, calories: 160, protein_g: 25, carbs_g: 7, fat_g: 3, units: { scoop: 40 }, default: 'scoop' },
        { name: 'Nonfat vanilla Greek yogurt', aliases: ['greek yogurt', 'yogurt'], grams: 170, calories: 100, protein_g: 17, carbs_g: 15, fat_g: 0, units: { cup: 225 }, default: 'cup' },
        { name: 'Frozen broccoli', aliases: ['broccoli'], grams: 340, calories: 100, protein_g: 9, carbs_g: 18, fat_g: 1, units: { bag: 340, cup: 90 }, default: 'bag' },
        { name: 'Shredded cheddar cheese', aliases: ['cheddar', 'shredded cheddar'], grams: 28, calories: 110, protein_g: 7, carbs_g: 0.5, fat_g: 9, units: { cup: 112, tbsp: 7 }, default: 'tbsp' },
        { name: 'Ranch dressing', aliases: ['ranch'], grams: 15, calories: 73, protein_g: 0, carbs_g: 1, fat_g: 8, units: { tbsp: 15 }, default: 'tbsp' },
        { name: 'Baby carrots', aliases: ['carrots'], grams: 100, calories: 35, protein_g: 0.6, carbs_g: 8, fat_g: 0.1, units: { cup: 128 }, default: 'cup' },
        { name: 'Egg', aliases: ['eggs'], grams: 50, calories: 72, protein_g: 6, carbs_g: 0.4, fat_g: 5, units: { each: 50 }, default: 'each' },
        { name: 'Chicken breast', aliases: ['chicken'], grams: 100, calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, units: { oz: 28.35 }, default: 'oz' },
        { name: 'White rice', aliases: ['rice'], grams: 158, calories: 205, protein_g: 4, carbs_g: 45, fat_g: 0.4, units: { cup: 158 }, default: 'cup' },
        { name: 'Small corn tortilla', aliases: ['corn tortilla'], grams: 24, calories: 52, protein_g: 1, carbs_g: 11, fat_g: 1, units: { each: 24 }, default: 'each' }]),
      [PATHS.plans]: C.toCSV(C.PLAN_FIELDS, []),
      [PATHS.events]: C.toCSV(C.EVENT_FIELDS, []),
      [PATHS.orders]: C.toCSV(C.ORDER_FIELDS, [
        { restaurant: 'Panera', item: 'Greek salad, half, no dressing', quantity: 1, unit: 'each', calories: 145, protein_g: 4, carbs_g: 10, fat_g: 10, note: '' },
        { restaurant: 'Panera', item: 'Chicken wild rice soup', quantity: 1, unit: 'cup', calories: 180, protein_g: 6, carbs_g: 18, fat_g: 10, note: '' }]),
    };
    let n = 0;
    return {
      async read(path) { return { text: files[path], sha: String(n) }; },
      async write(path, text) { files[path] = text; return String(++n); },
    };
  }

  // ---- Data ----

  async function load(path) {
    let f;
    try { f = await backend.read(path); }
    catch (e) {
      if (e.status !== 404 || !OPTIONAL[path]) throw e;
      f = { text: C.toCSV(OPTIONAL[path], []), sha: undefined }; // first write creates the file
    }
    state.files[path] = f;
    return f;
  }

  // Re-read the file, apply the change, write it back. Retries if someone else wrote in between
  // (a Claude Code session on the PC, for example).
  async function mutate(path, change, message) {
    for (let attempt = 0; ; attempt++) {
      const f = await load(path);
      const text = change(f.text);
      try {
        f.sha = await backend.write(path, text, f.sha, message);
        f.text = text;
        return;
      } catch (e) {
        if ((e.status !== 409 && e.status !== 422) || attempt >= 3) throw e;
      }
    }
  }

  const csv = path => C.parseCSV(state.files[path].text).rows;
  const targets = () => C.parseTargets(state.files[PATHS.targets].text);
  const reference = () => JSON.parse(state.files[PATHS.reference].text);
  const today = () => C.chicagoNow().date;
  const stamp = () => { const n = C.chicagoNow(); return n.date + ' ' + n.time; };
  const targetDate = () => (state.day === 'today' ? today() : C.addDays(today(), -1));
  const plansFor = date => csv(PATHS.plans).filter(p => p.date === date);
  const events = () => csv(PATHS.events);
  const checkedIn = date => events().some(e => e.date === date && e.kind === 'checkin');
  const yesterdayClosed = () => { const y = C.addDays(today(), -1); return y < '2026-10-01' || csv(PATHS.days).some(r => r.date === y); };
  const gumLabel = () => store.get('wl_gum') || 'Gum in';

  function addEvent(ev, message) {
    return mutate(PATHS.events, text => {
      const rows = C.parseCSV(text).rows;
      rows.push(Object.assign({ value: '', ref: '' }, ev));
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
      return C.toCSV(C.EVENT_FIELDS, rows);
    }, message);
  }

  // Writes food rows as one new entry and returns its entry_id.
  async function writeEntry(date, time, items, message) {
    let entryId = null;
    await mutate(PATHS.food, text => {
      const { rows } = C.parseCSV(text);
      entryId = C.nextEntryId(rows, date);
      items.forEach(i => rows.push({ date, time, entry_id: entryId, item: i.item, quantity: i.quantity, unit: i.unit,
        calories: i.calories, protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g, source: i.source, note: i.note }));
      return C.toCSV(C.FOOD_FIELDS, C.sortFood(rows));
    }, message);
    return entryId;
  }

  // ---- Rendering ----

  const fmt = n => Math.round(n).toLocaleString('en-US');
  const clock = t => { const [h, m] = t.split(':'); return `${(+h % 12) || 12}:${m} ${+h < 12 ? 'AM' : 'PM'}`; };
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const slotName = slot => (C.SLOTS.find(s => s[0] === slot) || [slot, slot])[1];
  const tagBadge = tag => (tag ? `<span class="badge ${esc(tag)}">${tag === 'work' ? 'Work meal' : 'Celebration'}</span>` : '');
  const orderOf = p => (p.note.startsWith('order: ') ? p.note.slice(7) : '');

  function toast(message, isError) {
    const t = $('toast');
    t.textContent = message;
    t.className = isError ? 'err' : '';
    t.style.display = 'block';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.style.display = 'none'; }, isError ? 6000 : 2500);
  }

  function renderSummary() {
    const s = C.streak(csv(PATHS.days), today());
    $('streak').textContent = `Logging streak: ${s.current} day${s.current === 1 ? '' : 's'}`;
    $('streak').className = 'streak' + (s.current ? '' : ' broken');
    $('streak-sub').textContent = `best ${s.best} · missed in last 30 days: ${s.missed}` + (s.pending ? ' · yesterday not closed yet' : '');
    const p = C.planStreak(csv(PATHS.plans), today());
    $('plan-streak').textContent = `Planned ahead: ${p.current} day${p.current === 1 ? '' : 's'} · best ${p.best}` +
      (p.today ? ' · today ✓' : '');

    const date = targetDate(), t = targets();
    const eaten = C.totals(csv(PATHS.food).filter(r => r.date === date));
    $('title').textContent = (state.day === 'today' ? 'Today' : 'Yesterday') + ' · ' + C.prettyDate(date);
    $('bars').innerHTML = C.MACROS.map(([name, key, unit]) => {
      const target = Math.round(t[name.toLowerCase()]), have = Math.round(eaten[key]), left = target - have;
      return `<div class="bar${left < 0 ? ' over' : ''}"><div class="top"><span>${name}</span>` +
        `<span class="left">${left >= 0 ? fmt(left) + unit + ' left' : fmt(-left) + unit + ' over'}</span></div>` +
        `<div class="track"><div class="fill" style="width:${Math.min(100, have / target * 100)}%"></div></div>` +
        `<div class="muted">${fmt(have)}${unit} eaten of ${fmt(target)}${unit}</div></div>`;
    }).join('');
  }

  // Meal-out tag for an entry: tagged directly, or eaten from a tagged plan.
  function entryTag(id) {
    const ev = events().filter(e => e.kind === 'tag' && e.ref === id).pop();
    if (ev) return ev.value;
    const p = csv(PATHS.plans).find(x => x.entry_id === id);
    return p ? p.tag : '';
  }

  function renderEntries() {
    const date = targetDate(), rows = csv(PATHS.food).filter(r => r.date === date);
    $('entries-title').textContent = (state.day === 'today' ? "Today's" : "Yesterday's") + ' entries';
    if (!rows.length) { $('entries').innerHTML = '<p class="muted" style="margin:0">Nothing logged yet.</p>'; return; }
    const groups = {}, gum = {};
    rows.forEach(r => { (groups[r.entry_id] = groups[r.entry_id] || []).push(r); });
    events().filter(e => e.kind === 'gum' && e.ref).forEach(e => { gum[e.ref] = e.time; });
    $('entries').innerHTML = Object.keys(groups).sort().map(id => {
      const g = groups[id], cal = g.reduce((s, r) => s + C.num(r.calories), 0);
      const end = gum[id] ? `<span class="gum-done">${esc(gumLabel())} ${esc(clock(gum[id]))}</span>`
        : `<button class="ghost" data-gum="${esc(id)}">${esc(gumLabel())}</button>`;
      return `<div class="entry-head"><span>${esc(clock(g[0].time))} · ${fmt(cal)} cal${tagBadge(entryTag(id))}</span>` +
        `<span class="acts">${end}<button class="ghost" data-delete="${esc(id)}">Delete</button></span></div><ul>` + g.map(r =>
        `<li><span>${esc(r.item)} <span class="muted">${esc(r.quantity)} ${esc(r.unit)}</span>` +
        (r.note.startsWith('unverified') ? '<span class="flag">estimate, not yet checked by Claude</span>' : '') +
        `</span><span class="cal">${fmt(r.calories)}</span></li>`).join('') + '</ul>';
    }).join('');
  }

  function renderPreview() {
    const items = $('food').value.trim() ? C.parseEntry($('food').value, reference()) : [];
    $('preview').innerHTML = items.map(i =>
      `<li><span>${esc(i.item)} <span class="muted">${esc(i.quantity)} ${esc(i.unit)}</span>` +
      (i.confident ? '' : `<span class="flag">${esc(i.why)}</span>`) +
      `</span><span class="cal">${fmt(i.calories)} cal</span></li>`).join('');
    const total = items.reduce((s, i) => s + i.calories, 0);
    $('log-food').disabled = !items.length || state.busy;
    $('log-food').textContent = items.length ? `Log ${fmt(total)} cal` : 'Log';
    $('save-goto').classList.toggle('hidden', !items.length);
    return items;
  }

  function renderGoto() {
    const orders = csv(PATHS.orders), names = C.orderNames(orders);
    $('goto-wrap').classList.toggle('hidden', !names.length);
    $('goto-chips').innerHTML = names.map(n => {
      const cal = C.orderItems(orders, n).reduce((s, i) => s + i.calories, 0);
      return `<button type="button" data-order="${esc(n)}">${esc(n)} · ${fmt(cal)}</button>`;
    }).join('');
    document.querySelectorAll('#log-tag button').forEach(b => b.classList.toggle('on', b.dataset.tag === state.logTag));
  }

  // The 7-day average is the headline; one morning's number is mostly water.
  function trendHtml() {
    const rows = csv(PATHS.weight), w = C.weightTrend(rows, today());
    if (w.avg === null) return '';
    const dir = w.change === null ? '' : Math.abs(w.change) < 0.05 ? ' · flat' :
      ` · ${w.change < 0 ? 'down' : 'up'} ${Math.abs(w.change).toFixed(1)} vs the week before`;
    const last = rows[rows.length - 1];
    return `<span class="avg">${w.avg.toFixed(1)} lb <small>7-day average${dir}</small></span>` +
      `<br><span class="muted">${last.date === today() ? 'Today' : C.prettyDate(last.date)}: ${esc(last.weight_lb)} lb</span>`;
  }

  function renderWeight() {
    const rows = csv(PATHS.weight), goal = targets()['goal weight'];
    if (!rows.length) { $('weight-line').textContent = 'No weigh-ins yet.'; $('chart').innerHTML = ''; return; }
    const w = C.weightTrend(rows, today());
    $('weight-line').innerHTML = trendHtml() + (goal && w.avg !== null ? `<span class="muted"> · ${(w.avg - goal).toFixed(1)} lb to goal</span>` : '');

    const end = today(), start = C.addDays(end, -59);
    const dayNo = iso => Math.round((Date.parse(iso) - Date.parse(start)) / 864e5);
    const pts = rows.filter(r => r.date >= start && r.date <= end).map(r => ({ d: r.date, w: +r.weight_lb }));
    if (!pts.length) { $('chart').innerHTML = ''; return; }
    const avg = pts.map(p => {
      const from = C.addDays(p.d, -7);
      const win = rows.filter(r => r.date > from && r.date <= p.d).map(r => +r.weight_lb);
      return { d: p.d, w: win.reduce((a, b) => a + b, 0) / win.length };
    });
    const W = 520, H = 250, L = 38, R = 8, T = 8, B = 24;
    const top = Math.ceil((Math.max(...pts.map(p => p.w)) + 1) / 5) * 5;
    const bottom = goal ? goal - 5 : Math.floor(Math.min(...pts.map(p => p.w)) - 1);
    const x = d => L + dayNo(d) / 59 * (W - L - R), y = v => T + (top - v) / (top - bottom) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Weight, last 60 days">`;
    for (let v = Math.ceil(bottom / 10) * 10; v <= top; v += 10) {
      svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    for (let d = end; d >= start; d = C.addDays(d, -14)) {
      svg += `<text x="${x(d)}" y="${H - 6}" text-anchor="${d === end ? 'end' : 'middle'}">${C.prettyDate(d).replace(/^\w+, /, '')}</text>`;
    }
    if (goal) svg += `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--green)" stroke-width="2" stroke-dasharray="6 4"/>`;
    svg += `<path d="${avg.map((p, i) => (i ? 'L' : 'M') + x(p.d).toFixed(1) + ',' + y(p.w).toFixed(1)).join(' ')}" fill="none" stroke="var(--blue)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    svg += pts.map(p => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="2.5" fill="var(--muted)" opacity=".7"/>`).join('');
    $('chart').innerHTML = svg + '</svg><p class="muted" style="margin:4px 0 0">The line is the 7-day average, dots are single weigh-ins' + (goal ? `, green is the goal (${goal})` : '') + '.</p>';
  }

  // ---- Planner: one editor, shown inside the check-in or in its own card ----

  function buildSlots() {
    $('slots').innerHTML = C.SLOTS.map(([slot, name]) => {
      const required = C.REQUIRED_SLOTS.includes(slot);
      return `<div class="slot${required ? '' : ' optional'}" data-slot="${slot}">` +
        `<div class="slot-head"><b>${name}${required ? '<span class="req">needed</span>' : ''}</b>` +
        `<div class="seg small"><button type="button" data-tag="" class="on">Regular</button><button type="button" data-tag="work">Work</button>` +
        `<button type="button" data-tag="celebration">Celebration</button></div></div>` +
        `<input class="plan-text" autocomplete="off" placeholder="${esc(PLACEHOLDER[slot])}">` +
        `<div class="chips hidden"></div><div class="hint hidden"></div></div>`;
    }).join('');
  }

  const slotEl = slot => document.querySelector(`#slots .slot[data-slot="${slot}"]`);

  function paintSlot(el) {
    const tag = el.dataset.tag || '', input = el.querySelector('.plan-text'), chips = el.querySelector('.chips');
    el.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.tag === tag));
    input.placeholder = tag === 'celebration' ? FAVORITES : PLACEHOLDER[el.dataset.slot];
    const names = tag === 'work' ? C.orderNames(csv(PATHS.orders)) : [];
    chips.classList.toggle('hidden', !names.length);
    chips.innerHTML = names.map(n => `<button type="button" data-pick="${esc(n)}" class="${el.dataset.order === n ? 'on' : ''}">${esc(n)}</button>`).join('');
    const hint = el.querySelector('.hint');
    hint.classList.toggle('hidden', tag !== 'celebration');
    hint.textContent = 'Pick your favorites ahead of time, one plate, and the meal has a clear end.';
  }

  function fillPlanner(date) {
    state.planDate = date;
    $('plan-date').value = date;
    const plans = plansFor(date);
    C.SLOTS.forEach(([slot]) => {
      const el = slotEl(slot), p = plans.find(x => x.slot === slot), input = el.querySelector('.plan-text');
      el.dataset.tag = p ? p.tag : '';
      el.dataset.order = p ? orderOf(p) : '';
      input.value = p ? p.plan : '';
      input.disabled = !!(p && p.status);
      if (p && p.status) input.value += p.status === 'eaten' ? '  (eaten)' : '  (ate something else)';
      paintSlot(el);
    });
    showSlots();
    renderCheckinNeeds();
  }

  function showSlots() {
    const anyOptional = C.SLOTS.some(([slot]) => !C.REQUIRED_SLOTS.includes(slot) && slotEl(slot).querySelector('.plan-text').value);
    const open = state.moreSlots || anyOptional;
    document.querySelectorAll('#slots .slot.optional').forEach(el => el.classList.toggle('hidden', !open));
    $('more-slots').classList.toggle('hidden', open);
  }

  function readPlanner() {
    return C.SLOTS.map(([slot]) => {
      const el = slotEl(slot), input = el.querySelector('.plan-text');
      return input.disabled ? null : { slot, plan: input.value, tag: el.dataset.tag || '', note: el.dataset.order ? 'order: ' + el.dataset.order : '' };
    }).filter(Boolean);
  }

  function plannerHasRequired() {
    return C.REQUIRED_SLOTS.every(slot => slotEl(slot).querySelector('.plan-text').value.trim());
  }

  // mode: 'checkin' (inside the check-in, for today), 'edit' (own card, any day), or null (closed)
  function setPlanner(mode, date) {
    state.planner = mode;
    const home = mode === 'checkin' ? $('ck-plan-body') : $('planner-home');
    if ($('planner').parentNode !== home) home.appendChild($('planner'));
    $('planner-card').classList.toggle('hidden', mode !== 'edit');
    $('plan-date-row').classList.toggle('hidden', mode !== 'edit');
    $('save-plan').classList.toggle('hidden', mode !== 'edit');
    if (mode) fillPlanner(date || today());
  }

  function savePlans(date) {
    const edits = readPlanner();
    return mutate(PATHS.plans, text => C.toCSV(C.PLAN_FIELDS, C.upsertPlans(C.parseCSV(text).rows, date, edits, stamp())),
      `plan: ${date} (app)`);
  }

  // ---- Morning check-in ----

  function renderCheckin() {
    const t = today(), y = C.addDays(t, -1);
    const closed = yesterdayClosed();
    const show = !checkedIn(t) || !closed;
    $('checkin').classList.toggle('hidden', !show);
    if (!show) { if (state.planner === 'checkin') setPlanner(null); return; }
    if (state.planner !== 'checkin' && state.planner !== 'edit') setPlanner('checkin', t);

    // 1. Close yesterday
    const yRows = csv(PATHS.food).filter(r => r.date === y);
    const yCal = yRows.reduce((s, r) => s + C.num(r.calories), 0);
    $('ck-close').classList.toggle('done', closed);
    $('ck-close-done').textContent = yRows.length ? `Closed · ${fmt(yCal)} cal logged` : 'Closed';
    if (!closed) {
      const groups = {};
      yRows.forEach(r => { (groups[r.entry_id] = groups[r.entry_id] || []).push(r); });
      const ids = Object.keys(groups).sort();
      if (ids.length) {
        const last = groups[ids[ids.length - 1]];
        $('ck-close-text').textContent = `Yesterday: ${fmt(yCal)} cal. The last thing logged was at ${clock(last[0].time)}. Did you eat anything after that?`;
      } else {
        $('ck-close-text').textContent = 'Yesterday has nothing logged. Add what you remember, in order: morning, midday, afternoon, dinner, after dinner, drinks. Rough is fine.';
      }
      $('ck-yesterday').innerHTML = ids.map(id => {
        const g = groups[id], cal = g.reduce((s, r) => s + C.num(r.calories), 0);
        return `<li><span>${esc(clock(g[0].time))} · ${esc(g.map(r => r.item).join(', '))}</span><span class="cal">${fmt(cal)}</span></li>`;
      }).join('');
      $('ck-close-btn').textContent = ids.length ? 'Nothing after that: close it' : 'Yesterday is complete';
    }

    // Optional debrief after a big day: one tap, no follow-up
    const answered = events().some(e => e.date === y && e.kind === 'debrief');
    const big = closed && !answered && yRows.length && C.bigDay(yRows, y, targets().calories);
    $('ck-debrief').classList.toggle('hidden', !big);
    if (big) {
      $('ck-debrief-text').textContent = `Yesterday came to ${fmt(yCal)} cal. If you want to note it, when did it turn?`;
      $('ck-debrief-chips').innerHTML = C.DEBRIEF.map(([v, label]) => `<button type="button" data-debrief="${esc(v)}">${esc(label)}</button>`).join('') +
        '<button type="button" class="ghost" data-debrief="skipped">Skip</button>';
    }

    // 2. Weigh in (skippable)
    const weighed = csv(PATHS.weight).some(r => r.date === t), skipped = store.get('wl_skipweigh') === t;
    $('ck-weigh').classList.toggle('done', weighed || skipped);
    $('ck-weigh-done').innerHTML = weighed ? trendHtml() : 'Skipped today';

    renderCheckinNeeds();
  }

  // 3. Plan today: dinner and the evening snack are needed to finish
  function renderCheckinNeeds() {
    if ($('checkin').classList.contains('hidden')) return;
    const inCheckin = state.planner === 'checkin', saved = plansFor(today());
    const planned = inCheckin ? plannerHasRequired()
      : C.REQUIRED_SLOTS.every(slot => saved.some(p => p.slot === slot && p.plan.trim()));
    $('ck-plan').classList.toggle('done', !inCheckin && planned);
    $('ck-plan-done').textContent = inCheckin ? '' : 'The planner is open below.';
    const closed = yesterdayClosed();
    const weighDone = $('ck-weigh').classList.contains('done');
    const done = [closed, weighDone, planned].filter(Boolean).length;
    $('ck-progress').textContent = `${done} of 3`;
    const need = [];
    if (!closed) need.push('close yesterday');
    if (!planned) need.push('plan dinner and the evening snack');
    $('ck-finish').disabled = state.busy || !closed || !planned;
    $('ck-need').textContent = need.length ? 'To finish: ' + need.join(' and ') + '.' : 'Weighing in is optional.';
  }

  function showWin() {
    const p = C.planStreak(csv(PATHS.plans), today());
    $('win-streak').textContent = `Planned ahead: ${p.current} day${p.current === 1 ? '' : 's'}` + (p.current > 1 && p.current === p.best ? ' · best yet' : '');
    const plans = plansFor(today()).filter(x => C.REQUIRED_SLOTS.includes(x.slot));
    $('win-sub').innerHTML = plans.map(x => `${esc(slotName(x.slot))}: ${esc(x.plan)}`).join('<br>');
    const win = $('win');
    win.querySelectorAll('.confetti').forEach(c => c.remove());
    const colors = ['--green', '--violet', '--blue', '--amber'];
    for (let i = 0; i < 26; i++) {
      const c = document.createElement('span');
      const angle = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 180;
      c.className = 'confetti';
      c.style.background = `var(${colors[i % colors.length]})`;
      c.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      c.style.setProperty('--dy', `${Math.sin(angle) * dist + 120}px`);
      c.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
      win.appendChild(c);
    }
    win.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([25, 60, 35]);
    clearTimeout(showWin.timer);
    showWin.timer = setTimeout(() => win.classList.add('hidden'), 3200);
  }

  // ---- Today's plan: planned vs. actual ----

  function renderPlanCard() {
    const plans = plansFor(today());
    $('plan-card').classList.toggle('hidden', !plans.length);
    const orders = csv(PATHS.orders);
    $('plan-list').innerHTML = plans.map(p => {
      const order = orderOf(p);
      const cal = order ? C.orderItems(orders, order).reduce((s, i) => s + i.calories, 0) : 0;
      const what = p.tag === 'celebration'
        ? `<div class="what favs">Favorites: ${esc(p.plan)}<br><span class="muted">One plate, then done.</span></div>`
        : `<div class="what">${esc(p.plan)}${order ? ` <span class="muted">· go-to, ${fmt(cal)} cal</span>` : ''}</div>`;
      let acts;
      if (p.status === 'eaten') {
        const row = csv(PATHS.food).find(r => r.entry_id === p.entry_id);
        acts = `<span class="muted">Logged${row ? ' at ' + esc(clock(row.time)) : ''}</span>`;
      } else if (p.status === 'other') acts = '<span class="muted">Ate something else</span>';
      else acts = `<div class="row"><button class="go small" data-eat="${esc(p.slot)}">Ate this</button>` +
        `<button class="small" data-other="${esc(p.slot)}">Ate something else</button></div>`;
      return `<li class="plan-item"><div class="slotname">${esc(slotName(p.slot))}${tagBadge(p.tag)}</div>${what}${acts}</li>`;
    }).join('');
  }

  function render() {
    renderCheckin(); renderSummary(); renderPlanCard(); renderGoto(); renderEntries(); renderPreview(); renderWeight();
    $('foot').textContent = backend.isDemo ? 'Demo data. Nothing is saved.' : 'Synced with ' + store.get('wl_repo');
  }

  // ---- Actions ----

  async function run(label, work) {
    if (state.busy) return;
    state.busy = true;
    document.body.style.cursor = 'progress';
    try { await work(); if (label) toast(label); }
    catch (e) { toast(e.message || String(e), true); }
    finally { state.busy = false; document.body.style.cursor = ''; if (backend && state.files[PATHS.food]) render(); }
  }

  const refreshAll = () => Promise.all(Object.values(PATHS).map(load));

  function setDay(day) {
    state.day = day;
    document.querySelectorAll('#day-seg button').forEach(b => b.classList.toggle('on', b.dataset.day === day));
    $('time').value = day === 'today' ? C.chicagoNow().time : '21:00';
    render();
  }

  function logFood() {
    const items = renderPreview();
    if (!items.length) return;
    const date = targetDate(), time = $('time').value || C.chicagoNow().time, tag = state.logTag;
    return run('Logged', async () => {
      const id = await writeEntry(date, time, items, `food: ${date} ${time} (app)`);
      if (tag) await addEvent({ date, time, kind: 'tag', value: tag, ref: id }, `tag: ${id} ${tag} (app)`);
      $('food').value = '';
      state.logTag = '';
      if (state.day === 'today') $('time').value = C.chicagoNow().time;
    });
  }

  // One tap: a go-to order becomes an entry, marked as a work meal.
  function logOrder(name) {
    const items = C.orderItems(csv(PATHS.orders), name);
    if (!items.length) return;
    const date = targetDate(), time = $('time').value || C.chicagoNow().time;
    const cal = items.reduce((s, i) => s + i.calories, 0);
    return run(`Logged ${name} go-to · ${fmt(cal)} cal`, async () => {
      const id = await writeEntry(date, time, items, `food: ${date} ${time} ${name} go-to (app)`);
      await addEvent({ date, time, kind: 'tag', value: state.logTag || 'work', ref: id }, `tag: ${id} (app)`);
      state.logTag = '';
    });
  }

  function saveGoto() {
    const items = renderPreview();
    if (!items.length) return;
    const name = (prompt('Which restaurant is this your go-to order for?') || '').trim();
    if (!name) return;
    const orders = csv(PATHS.orders), existing = C.orderNames(orders).find(n => n.toLowerCase() === name.toLowerCase());
    if (existing && !confirm(`Replace your go-to order for ${existing}?`)) return;
    const restaurant = existing || name;
    return run(`Saved your ${restaurant} go-to`, () => mutate(PATHS.orders, text => {
      const rows = C.parseCSV(text).rows.filter(r => r.restaurant.toLowerCase() !== restaurant.toLowerCase());
      items.forEach(i => rows.push({ restaurant, item: i.item, quantity: i.quantity, unit: i.unit, calories: i.calories,
        protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g, note: i.note }));
      rows.sort((a, b) => a.restaurant.toLowerCase().localeCompare(b.restaurant.toLowerCase()));
      return C.toCSV(C.ORDER_FIELDS, rows);
    }, `order: ${restaurant} go-to (app)`));
  }

  function deleteEntry(id) {
    if (!confirm('Delete this entry?')) return;
    return run('Deleted', () => mutate(PATHS.food, text => {
      const { rows } = C.parseCSV(text);
      return C.toCSV(C.FOOD_FIELDS, rows.filter(r => r.entry_id !== id));
    }, `fix: delete entry ${id} (app)`));
  }

  function markGum(id) {
    const date = id.slice(0, 4) + '-' + id.slice(4, 6) + '-' + id.slice(6, 8);
    return run(`${gumLabel()} · meal done`, () =>
      addEvent({ date, time: C.chicagoNow().time, kind: 'gum', ref: id }, `gum: ${id} (app)`));
  }

  function logWeight(inputId) {
    const pounds = parseFloat($(inputId).value);
    if (!(pounds > 50 && pounds < 700)) { toast('Enter a weight in pounds', true); return; }
    const date = today();
    return run('Weight logged', async () => {
      await mutate(PATHS.weight, text => {
        const rows = C.parseCSV(text).rows.filter(r => r.date !== date);
        rows.push({ date, weight_lb: String(Math.round(pounds * 10) / 10), note: '' });
        rows.sort((a, b) => a.date.localeCompare(b.date));
        return C.toCSV(C.WEIGHT_FIELDS, rows);
      }, `weight: ${date} (app)`);
      $(inputId).value = '';
    });
  }

  function closeYesterday() {
    const date = C.addDays(today(), -1), note = $('ck-close-note').value.trim() || 'closed in app';
    return run('Yesterday closed', async () => {
      await mutate(PATHS.days, text => {
        const rows = C.parseCSV(text).rows.filter(r => r.date !== date);
        rows.push({ date, status: 'complete', note });
        rows.sort((a, b) => a.date.localeCompare(b.date));
        return C.toCSV(C.DAYS_FIELDS, rows);
      }, `close: ${date} (app)`);
      $('ck-close-note').value = '';
      $('ck-add-hint').classList.add('hidden');
      setDay('today');
    });
  }

  function finishCheckin() {
    const date = today();
    return run('', async () => {
      // the planner may be open on another day (Plan ahead); then today's plan is already saved
      if (state.planner === 'checkin') await savePlans(date);
      await addEvent({ date, time: C.chicagoNow().time, kind: 'checkin' }, `checkin: ${date} (app)`);
      setPlanner(null);
      showWin();
    });
  }

  function eatPlan(slot) {
    const date = today(), p = plansFor(date).find(x => x.slot === slot);
    if (!p) return;
    const order = orderOf(p);
    const items = order ? C.orderItems(csv(PATHS.orders), order) : C.parseEntry(p.plan, reference());
    if (!items.length) { toast('Nothing to log in that plan', true); return; }
    const time = C.chicagoNow().time, cal = items.reduce((s, i) => s + i.calories, 0);
    return run(`Logged ${slotName(slot).toLowerCase()} · ${fmt(cal)} cal`, async () => {
      const id = await writeEntry(date, time, items, `food: ${date} ${time} planned ${slot} (app)`);
      await mutate(PATHS.plans, text => {
        const rows = C.parseCSV(text).rows;
        rows.filter(x => x.date === date && x.slot === slot).forEach(x => { x.status = 'eaten'; x.entry_id = id; });
        return C.toCSV(C.PLAN_FIELDS, rows);
      }, `plan: ${date} ${slot} eaten (app)`);
    });
  }

  // No questions asked: mark it, then the log box is ready for what was actually eaten.
  function otherPlan(slot) {
    const date = today(), p = plansFor(date).find(x => x.slot === slot);
    return run('', async () => {
      await mutate(PATHS.plans, text => {
        const rows = C.parseCSV(text).rows;
        rows.filter(x => x.date === date && x.slot === slot).forEach(x => { x.status = 'other'; });
        return C.toCSV(C.PLAN_FIELDS, rows);
      }, `plan: ${date} ${slot} swapped (app)`);
      state.logTag = p ? p.tag : '';
      if (state.day !== 'today') setDay('today');
      $('time').value = C.chicagoNow().time;
      $('food').focus();
      $('food').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // ---- Start-up ----

  function showSettings(show) {
    $('settings').classList.toggle('hidden', !show);
    $('set-repo').value = store.get('wl_repo') || 'Guitarnerd/weightloss-ledger';
    $('set-gum').value = store.get('wl_gum') || '';
  }

  async function start() {
    const token = store.get('wl_token'), repo = store.get('wl_repo');
    const wantsDemo = /[?&]demo\b/.test(location.search);
    if (wantsDemo) { backend = demo(); backend.isDemo = true; }
    else if (token && repo) backend = github(repo, token);
    else { $('app').classList.add('hidden'); showSettings(true); return; }
    await run('', async () => {
      await refreshAll();
      $('app').classList.remove('hidden');
      showSettings(false);
      $('time').value = C.chicagoNow().time;
    });
    if (!state.files[PATHS.food]) showSettings(true);
  }

  buildSlots();
  $('planner-home').appendChild($('planner'));
  $('chips').innerHTML = QUICK.map(q => `<button type="button">${esc(q)}</button>`).join('');
  $('chips').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    const box = $('food');
    box.value = (box.value.trim() ? box.value.trim().replace(/,$/, '') + ', ' : '') + e.target.textContent;
    renderPreview();
  });
  $('food').addEventListener('input', renderPreview);
  $('log-food').addEventListener('click', logFood);
  $('save-goto').addEventListener('click', saveGoto);
  $('goto-chips').addEventListener('click', e => { if (e.target.dataset.order) logOrder(e.target.dataset.order); });
  $('log-tag').addEventListener('click', e => {
    if (e.target.dataset.tag === undefined) return;
    state.logTag = e.target.dataset.tag;
    renderGoto();
  });
  $('log-weight').addEventListener('click', () => logWeight('weight'));
  $('entries').addEventListener('click', e => {
    if (e.target.dataset.delete) deleteEntry(e.target.dataset.delete);
    if (e.target.dataset.gum) markGum(e.target.dataset.gum);
  });
  $('day-seg').addEventListener('click', e => { if (e.target.dataset.day) setDay(e.target.dataset.day); });
  $('refresh').addEventListener('click', () => run('Up to date', refreshAll));
  $('open-settings').addEventListener('click', () => showSettings($('settings').classList.contains('hidden')));
  $('save-settings').addEventListener('click', () => {
    const gum = $('set-gum').value.trim();
    if (gum) store.set('wl_gum', gum); else store.del('wl_gum');
    const repo = $('set-repo').value.trim(), token = $('set-token').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast('Repo should look like owner/name', true); return; }
    if (!token && !store.get('wl_token')) { toast('Paste a token first', true); return; }
    store.set('wl_repo', repo);
    if (token) store.set('wl_token', token);
    $('set-token').value = '';
    if (/[?&]demo\b/.test(location.search)) location.search = ''; else start();
  });
  $('demo').addEventListener('click', () => { location.search = '?demo'; });
  $('forget').addEventListener('click', () => { store.del('wl_token'); state.files = {}; backend = null; toast('Token removed from this device'); start(); });

  // Check-in
  $('ck-close-btn').addEventListener('click', closeYesterday);
  $('ck-add-y').addEventListener('click', () => {
    setDay('yesterday');
    $('ck-add-hint').classList.remove('hidden');
    $('food').focus();
    $('food').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('ck-debrief-chips').addEventListener('click', e => {
    const v = e.target.dataset.debrief;
    if (!v) return;
    const y = C.addDays(today(), -1);
    run(v === 'skipped' ? '' : 'Noted', () => addEvent({ date: y, time: C.chicagoNow().time, kind: 'debrief', value: v }, `debrief: ${y} (app)`));
  });
  $('ck-weight-btn').addEventListener('click', () => logWeight('ck-weight'));
  $('ck-weight-skip').addEventListener('click', () => { store.set('wl_skipweigh', today()); render(); });
  $('ck-finish').addEventListener('click', finishCheckin);
  $('win').addEventListener('click', () => $('win').classList.add('hidden'));

  // Planner
  $('slots').addEventListener('click', e => {
    const el = e.target.closest('.slot');
    if (!el) return;
    if (e.target.dataset.tag !== undefined) {
      el.dataset.tag = e.target.dataset.tag;
      if (el.dataset.tag !== 'work') el.dataset.order = '';
      paintSlot(el);
    } else if (e.target.dataset.pick) {
      const name = e.target.dataset.pick, input = el.querySelector('.plan-text');
      el.dataset.order = el.dataset.order === name ? '' : name;
      if (el.dataset.order) input.value = name + ' go-to';
      paintSlot(el);
      renderCheckinNeeds();
    }
  });
  $('slots').addEventListener('input', e => {
    const el = e.target.closest('.slot');
    if (el && el.dataset.order && e.target.value !== el.dataset.order + ' go-to') { el.dataset.order = ''; paintSlot(el); }
    renderCheckinNeeds();
  });
  $('more-slots').addEventListener('click', () => { state.moreSlots = true; showSlots(); });
  $('plan-date').addEventListener('change', () => { if ($('plan-date').value) fillPlanner($('plan-date').value); });
  $('save-plan').addEventListener('click', () => {
    const date = state.planDate;
    run(`Plan saved for ${C.prettyDate(date)}`, async () => { await savePlans(date); setPlanner(checkedIn(today()) ? null : 'checkin'); });
  });
  $('planner-close').addEventListener('click', () => { setPlanner(null); render(); });
  $('edit-plan').addEventListener('click', () => { setPlanner('edit', today()); $('planner-card').scrollIntoView({ behavior: 'smooth' }); });
  $('plan-ahead').addEventListener('click', () => { setPlanner('edit', C.addDays(today(), 1)); $('planner-card').scrollIntoView({ behavior: 'smooth' }); });
  $('plan-list').addEventListener('click', e => {
    if (e.target.dataset.eat) eatPlan(e.target.dataset.eat);
    if (e.target.dataset.other) otherPlan(e.target.dataset.other);
  });

  document.addEventListener('visibilitychange', () => {
    // coming back to the app later: pick up anything logged elsewhere, and roll over at midnight
    if (!document.hidden && backend && !state.busy && state.files[PATHS.food]) run('', refreshAll);
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  start();
})();
