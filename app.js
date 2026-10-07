// Weightloss Ledger: screen and GitHub sync. The logic lives in core.js.
(function () {
  'use strict';
  const C = window.Core;
  const $ = id => document.getElementById(id);
  const PATHS = { food: 'data/food.csv', weight: 'data/weight.csv', days: 'data/days.csv',
    targets: 'targets.md', reference: 'data/reference.json' };
  const QUICK = ['200 g 2% milk', '1 scoop protein powder', '170 g nonfat vanilla Greek yogurt', '1 bag broccoli',
    '1/8 cup shredded cheddar', '1 tbsp ranch dressing', '1 cup baby carrots', '3 eggs', '3 small corn tortillas'];

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };
  const state = { files: {}, day: 'today', busy: false, banner: null };
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
        { name: 'Vanilla protein powder', aliases: ['protein powder'], grams: 30, calories: 120, protein_g: 24, carbs_g: 3, fat_g: 1, units: { scoop: 30 }, default: 'scoop' },
        { name: 'Nonfat vanilla Greek yogurt', aliases: ['greek yogurt', 'yogurt'], grams: 170, calories: 100, protein_g: 17, carbs_g: 15, fat_g: 0, units: { cup: 225 }, default: 'cup' },
        { name: 'Frozen broccoli', aliases: ['broccoli'], grams: 340, calories: 100, protein_g: 9, carbs_g: 18, fat_g: 1, units: { bag: 340, cup: 90 }, default: 'bag' },
        { name: 'Shredded cheddar cheese', aliases: ['cheddar', 'shredded cheddar'], grams: 28, calories: 110, protein_g: 7, carbs_g: 0.5, fat_g: 9, units: { cup: 112, tbsp: 7 }, default: 'tbsp' },
        { name: 'Ranch dressing', aliases: ['ranch'], grams: 15, calories: 73, protein_g: 0, carbs_g: 1, fat_g: 8, units: { tbsp: 15 }, default: 'tbsp' },
        { name: 'Baby carrots', aliases: ['carrots'], grams: 100, calories: 35, protein_g: 0.6, carbs_g: 8, fat_g: 0.1, units: { cup: 128 }, default: 'cup' },
        { name: 'Egg', aliases: ['eggs'], grams: 50, calories: 72, protein_g: 6, carbs_g: 0.4, fat_g: 5, units: { each: 50 }, default: 'each' },
        { name: 'Small corn tortilla', aliases: ['corn tortilla'], grams: 24, calories: 52, protein_g: 1, carbs_g: 11, fat_g: 1, units: { each: 24 }, default: 'each' }]),
    };
    let n = 0;
    return {
      async read(path) { return { text: files[path], sha: String(n) }; },
      async write(path, text) { files[path] = text; return String(++n); },
    };
  }

  // ---- Data ----

  async function load(path) {
    const f = await backend.read(path);
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
  const targetDate = () => (state.day === 'today' ? today() : C.addDays(today(), -1));

  // ---- Rendering ----

  const fmt = n => Math.round(n).toLocaleString('en-US');
  const clock = t => { const [h, m] = t.split(':'); return `${(+h % 12) || 12}:${m} ${+h < 12 ? 'AM' : 'PM'}`; };
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

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

  function renderEntries() {
    const date = targetDate(), rows = csv(PATHS.food).filter(r => r.date === date);
    $('entries-title').textContent = (state.day === 'today' ? "Today's" : "Yesterday's") + ' entries';
    if (!rows.length) { $('entries').innerHTML = '<p class="muted" style="margin:0">Nothing logged yet.</p>'; return; }
    const groups = {};
    rows.forEach(r => { (groups[r.entry_id] = groups[r.entry_id] || []).push(r); });
    $('entries').innerHTML = Object.keys(groups).sort().map(id => {
      const g = groups[id], cal = g.reduce((s, r) => s + C.num(r.calories), 0);
      return `<div class="entry-head"><span>${esc(clock(g[0].time))} · ${fmt(cal)} cal</span>` +
        `<button class="ghost" data-delete="${esc(id)}">Delete</button></div><ul>` + g.map(r =>
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
    return items;
  }

  function renderWeight() {
    const rows = csv(PATHS.weight), goal = targets()['goal weight'];
    if (!rows.length) { $('weight-line').textContent = 'No weigh-ins yet.'; $('chart').innerHTML = ''; return; }
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    const change = prev ? ` (${(last.weight_lb - prev.weight_lb >= 0 ? '+' : '') + (last.weight_lb - prev.weight_lb).toFixed(1)})` : '';
    $('weight-line').innerHTML = `<b>${esc(last.weight_lb)} lb</b> on ${C.prettyDate(last.date)}${change}` +
      (goal ? ` · ${(last.weight_lb - goal).toFixed(1)} lb to goal` : '');

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
    const x = d => L + dayNo(d) / 59 * (W - L - R), y = w => T + (top - w) / (top - bottom) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Weight, last 60 days">`;
    for (let v = Math.ceil(bottom / 10) * 10; v <= top; v += 10) {
      svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    for (let d = end; d >= start; d = C.addDays(d, -14)) {
      svg += `<text x="${x(d)}" y="${H - 6}" text-anchor="${d === end ? 'end' : 'middle'}">${C.prettyDate(d).replace(/^\w+, /, '')}</text>`;
    }
    if (goal) svg += `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--green)" stroke-width="2" stroke-dasharray="6 4"/>`;
    svg += `<path d="${avg.map((p, i) => (i ? 'L' : 'M') + x(p.d).toFixed(1) + ',' + y(p.w).toFixed(1)).join(' ')}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    svg += pts.map(p => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="3" fill="var(--muted)"/>`).join('');
    $('chart').innerHTML = svg + '</svg><p class="muted" style="margin:4px 0 0">Dots are weigh-ins, the line is the 7-day average' + (goal ? `, green is the goal (${goal})` : '') + '.</p>';
  }

  // The first food of the day waits on closing out yesterday (see CLAUDE.md in the ledger repo).
  function renderBanner() {
    const y = C.addDays(today(), -1);
    const closed = csv(PATHS.days).some(r => r.date === y);
    const startedToday = csv(PATHS.food).some(r => r.date === today());
    if (closed || y < '2026-10-01') { state.banner = null; $('banner').classList.add('hidden'); return; }
    const rows = csv(PATHS.food).filter(r => r.date === y);
    state.banner = y;
    $('banner').classList.remove('hidden');
    if (rows.length) {
      const lastId = rows.map(r => r.entry_id).sort().pop(), last = rows.filter(r => r.entry_id === lastId);
      const cal = rows.reduce((s, r) => s + C.num(r.calories), 0);
      $('banner-title').textContent = startedToday ? 'Yesterday is still open' : 'Before you log today';
      $('banner-text').textContent = `The last thing logged yesterday was at ${clock(last[0].time)}: ${last.map(r => r.item).join(', ')}. ` +
        `Yesterday is at ${fmt(cal)} calories. Did you eat anything after that?`;
      $('banner-none').classList.remove('hidden');
    } else {
      $('banner-title').textContent = 'Yesterday has nothing logged';
      $('banner-text').textContent = 'Log what you remember, in order: morning, midday, afternoon, dinner, after dinner, drinks. Rough is fine. A missed day resets the streak.';
      $('banner-none').classList.add('hidden');
    }
  }

  function render() {
    renderBanner(); renderSummary(); renderEntries(); renderPreview(); renderWeight();
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
    const date = targetDate(), time = $('time').value || C.chicagoNow().time;
    return run('Logged', async () => {
      await mutate(PATHS.food, text => {
        const { rows } = C.parseCSV(text);
        const entry_id = C.nextEntryId(rows, date);
        items.forEach(i => rows.push({ date, time, entry_id, item: i.item, quantity: i.quantity, unit: i.unit,
          calories: i.calories, protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g, source: i.source, note: i.note }));
        return C.toCSV(C.FOOD_FIELDS, C.sortFood(rows));
      }, `food: ${date} ${time} (app)`);
      $('food').value = '';
      if (state.day === 'today') $('time').value = C.chicagoNow().time;
    });
  }

  function deleteEntry(id) {
    if (!confirm('Delete this entry?')) return;
    return run('Deleted', () => mutate(PATHS.food, text => {
      const { rows } = C.parseCSV(text);
      return C.toCSV(C.FOOD_FIELDS, rows.filter(r => r.entry_id !== id));
    }, `fix: delete entry ${id} (app)`));
  }

  function logWeight() {
    const pounds = parseFloat($('weight').value);
    if (!(pounds > 50 && pounds < 700)) { toast('Enter a weight in pounds', true); return; }
    const date = today();
    return run('Weight logged', async () => {
      await mutate(PATHS.weight, text => {
        const rows = C.parseCSV(text).rows.filter(r => r.date !== date);
        rows.push({ date, weight_lb: String(Math.round(pounds * 10) / 10), note: '' });
        rows.sort((a, b) => a.date.localeCompare(b.date));
        return C.toCSV(C.WEIGHT_FIELDS, rows);
      }, `weight: ${date} (app)`);
      $('weight').value = '';
    });
  }

  function closeYesterday() {
    const date = state.banner;
    if (!date) return;
    return run('Yesterday closed', async () => {
      await mutate(PATHS.days, text => {
        const rows = C.parseCSV(text).rows.filter(r => r.date !== date);
        rows.push({ date, status: 'complete', note: 'closed in app' });
        rows.sort((a, b) => a.date.localeCompare(b.date));
        return C.toCSV(C.DAYS_FIELDS, rows);
      }, `close: ${date} (app)`);
      $('banner-hint').classList.add('hidden'); $('banner-done').classList.add('hidden');
      $('banner-add').classList.remove('hidden');
      setDay('today');
    });
  }

  // ---- Start-up ----

  function showSettings(show) {
    $('settings').classList.toggle('hidden', !show);
    $('set-repo').value = store.get('wl_repo') || 'Guitarnerd/weightloss-ledger';
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

  $('chips').innerHTML = QUICK.map(q => `<button type="button">${esc(q)}</button>`).join('');
  $('chips').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    const box = $('food');
    box.value = (box.value.trim() ? box.value.trim().replace(/,$/, '') + ', ' : '') + e.target.textContent;
    renderPreview();
  });
  $('food').addEventListener('input', renderPreview);
  $('log-food').addEventListener('click', logFood);
  $('log-weight').addEventListener('click', logWeight);
  $('entries').addEventListener('click', e => { if (e.target.dataset.delete) deleteEntry(e.target.dataset.delete); });
  $('day-seg').addEventListener('click', e => { if (e.target.dataset.day) setDay(e.target.dataset.day); });
  $('refresh').addEventListener('click', () => run('Up to date', refreshAll));
  $('open-settings').addEventListener('click', () => showSettings($('settings').classList.contains('hidden')));
  $('save-settings').addEventListener('click', () => {
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
  $('banner-none').addEventListener('click', closeYesterday);
  $('banner-done').addEventListener('click', closeYesterday);
  $('banner-add').addEventListener('click', () => {
    setDay('yesterday');
    $('banner-hint').classList.remove('hidden'); $('banner-done').classList.remove('hidden');
    $('banner-none').classList.add('hidden'); $('banner-add').classList.add('hidden');
    $('food').focus();
  });
  document.addEventListener('visibilitychange', () => {
    // coming back to the app later: pick up anything logged elsewhere, and roll over at midnight
    if (!document.hidden && backend && !state.busy && state.files[PATHS.food]) run('', refreshAll);
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  start();
})();
