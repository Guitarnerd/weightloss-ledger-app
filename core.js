// Pure logic for the Weightloss Ledger app: CSV, Chicago time, food text parsing, totals, streak.
// No DOM and no network here, so it can be tested with Node (see test.js).
(function (root) {
  'use strict';

  const FOOD_FIELDS = ['date', 'time', 'entry_id', 'item', 'quantity', 'unit', 'calories',
    'protein_g', 'carbs_g', 'fat_g', 'source', 'note'];
  const WEIGHT_FIELDS = ['date', 'weight_lb', 'note'];
  const DAYS_FIELDS = ['date', 'status', 'note'];
  const MACROS = [['Calories', 'calories', ''], ['Protein', 'protein_g', ' g'],
    ['Carbs', 'carbs_g', ' g'], ['Fat', 'fat_g', ' g']];
  const STREAK_START = '2026-10-01';

  // ---- CSV (same dialect as Python's csv module: minimal quoting, LF line ends) ----

  function parseCSV(text) {
    const records = [];
    let field = '', record = [], quoted = false, i = 0;
    text = text.replace(/\r\n/g, '\n');
    while (i < text.length) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (ch === '"') { quoted = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === ',') { record.push(field); field = ''; i++; continue; }
      if (ch === '\n') { record.push(field); records.push(record); record = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || record.length) { record.push(field); records.push(record); }
    const header = records.shift() || [];
    const rows = records.filter(r => r.length > 1 || r[0] !== '').map(r => {
      const o = {};
      header.forEach((h, k) => { o[h] = r[k] === undefined ? '' : r[k]; });
      return o;
    });
    return { header, rows };
  }

  function toCSV(header, rows) {
    const cell = v => {
      v = v === undefined || v === null ? '' : String(v);
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return [header.join(',')].concat(rows.map(r => header.map(h => cell(r[h])).join(','))).join('\n') + '\n';
  }

  // ---- Time: everything is America/Chicago ----

  function chicagoNow(d) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d || new Date());
    const p = {};
    parts.forEach(x => { p[x.type] = x.value; });
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function prettyDate(iso) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US',
      { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  // ---- Food text -> items ----

  const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, couple: 2 };
  const FRACTION_CHARS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
  const UNIT_ALIASES = {
    g: 'g', gram: 'g', grams: 'g', gm: 'g', kg: 'kg', oz: 'oz', ounce: 'oz', ounces: 'oz',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', ml: 'ml',
    cup: 'cup', cups: 'cup', c: 'cup', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
    tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', scoop: 'scoop', scoops: 'scoop', bag: 'bag', bags: 'bag',
    slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
    can: 'can', cans: 'can', bottle: 'bottle', bottles: 'bottle', serving: 'serving', servings: 'serving',
    stick: 'stick', sticks: 'stick', bowl: 'bowl', bowls: 'bowl', glass: 'glass', glasses: 'glass',
    handful: 'handful', handfuls: 'handful', knob: 'knob', pat: 'pat', pats: 'pat', splash: 'splash',
    sprinkle: 'sprinkle', sprinkling: 'sprinkle', container: 'container', cob: 'cob', cobs: 'cob',
    patty: 'patty', patties: 'patty', link: 'link', links: 'link', leaf: 'leaf', leaves: 'leaf',
    strip: 'strip', strips: 'strip', muffin: 'muffin', breast: 'breast', chip: 'chip', each: 'each',
    small: 'small', medium: 'medium', large: 'large',
  };
  const MASS = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 };
  const VOLUME_GUESS = { cup: 240, tbsp: 15, tsp: 5, ml: 1, glass: 240, bowl: 360, splash: 20 };
  const FILLER = /^(?:i\s+(?:just\s+)?(?:had|ate)|had|ate|another|about|approximately|roughly|probably|maybe|around|like|plus|and|also|then|with)\s+/;
  const STOP = new Set(['of', 'a', 'an', 'the', 'some', 'my', 'homemade', 'fresh', 'plain', 'more', 'extra']);

  function stem(word) {
    if (word.length > 3 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.length > 3 && word.endsWith('oes')) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
  }

  function tokens(name) {
    return name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim().split(/\s+/)
      .filter(w => w && !STOP.has(w)).map(stem);
  }

  function parseNumber(s) {
    s = s.trim();
    let m;
    if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
    if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
    if ((m = s.match(/^(\d*\.?\d+)\s*([½¼¾⅓⅔⅛])$/))) return +m[1] + FRACTION_CHARS[m[2]];
    if (FRACTION_CHARS[s]) return FRACTION_CHARS[s];
    if (/^\d*\.?\d+$/.test(s)) return +s;
    return NaN;
  }

  const NUM = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*\\.?\\d+\\s*[½¼¾⅓⅔⅛]|[½¼¾⅓⅔⅛]|\\d*\\.?\\d+)';
  const LEAD = new RegExp('^' + NUM + '(?!\\s*%)\\s*([a-z]+)?\\.?\\s*(.*)$');
  const TRAIL = new RegExp('^(.*?)[\\s,(]+' + NUM + '(?!\\s*%)\\s*([a-z]+)?\\.?\\)?$');

  // "2 scoops of protein powder" -> {quantity: 2, unit: 'scoop', name: 'protein powder'}
  function splitQuantity(segment) {
    let s = segment.toLowerCase().trim().replace(/^[-*•·]\s*/, '');
    while (FILLER.test(s)) s = s.replace(FILLER, '');
    let quantity = null, unit = null, name = s, m;

    const word = s.match(/^([a-z]+)\s+(.*)$/);
    if (word && NUMBER_WORDS[word[1]] !== undefined && !/^(a|an)$/.test(word[2].split(' ')[0])) {
      quantity = NUMBER_WORDS[word[1]];
      name = word[2].replace(/^(a|an)\s+/, '');
      if (/^(a|an)$/.test(word[1]) && NUMBER_WORDS[name.split(' ')[0]] !== undefined
          && !/^(half|quarter)$/.test(word[1])) {
        // "a half cup": the next word is the real number
        quantity = NUMBER_WORDS[name.split(' ')[0]];
        name = name.split(' ').slice(1).join(' ');
      }
    } else if (word && /^(half|quarter)$/.test(word[1])) {
      quantity = NUMBER_WORDS[word[1]];
      name = word[2].replace(/^(a|an)\s+/, '');
    } else if ((m = s.match(LEAD)) && !isNaN(parseNumber(m[1]))) {
      quantity = parseNumber(m[1]);
      name = ((m[2] || '') + ' ' + m[3]).trim();
    } else if ((m = s.match(TRAIL)) && !isNaN(parseNumber(m[2])) && m[1].trim()) {
      quantity = parseNumber(m[2]);
      name = ((m[3] || '') + ' ' + m[1]).trim();
    }

    const first = name.split(' ')[0].replace(/\.$/, '');
    if (quantity !== null && UNIT_ALIASES[first] && name.split(' ').length > 1) {
      unit = UNIT_ALIASES[first];
      name = name.split(' ').slice(1).join(' ');
    } else if (quantity !== null && /^fl$/.test(first) && /^oz/.test(name.split(' ')[1] || '')) {
      unit = 'floz';
      name = name.split(' ').slice(2).join(' ');
    }
    name = name.replace(/^of\s+/, '').replace(/[.;]+$/, '').trim();
    return { quantity, unit, name };
  }

  function splitSegments(text) {
    const numberStart = new RegExp('^(?:' + NUM + '(?!\\s*%)|(?:' + Object.keys(NUMBER_WORDS).join('|') + ')\\s)', 'i');
    const out = [];
    // A full stop ends an item when a new one clearly starts after it ("...spaghetti. A quarter cup...");
    // unit abbreviations like "tbsp. of ranch" and decimals like "1.5" are left alone.
    text = text.replace(/([a-z]{3,})\.\s+(?=[A-Z0-9½¼¾⅓⅔⅛])/g,
      (whole, word) => (/^(tbsp|tsp|tbs|lbs|pcs|approx)$/i.test(word) ? whole : word + '\n'));
    text.split(/[\n;]+|,(?!\d)/).forEach(part => {
      const pieces = part.split(/\s+(?:and|plus)\s+/i);
      let current = pieces[0];
      for (let i = 1; i < pieces.length; i++) {
        // only split on "and" when what follows starts with an amount ("mac and cheese" stays whole)
        if (numberStart.test(pieces[i].trim())) { out.push(current); current = pieces[i]; }
        else current += ' and ' + pieces[i];
      }
      out.push(current);
    });
    return out.map(s => s.trim()).filter(s => /[a-z]/i.test(s));
  }

  function bestMatch(name, reference) {
    const q = tokens(name);
    let best = null, bestScore = 0;
    if (!q.length) return { food: null, score: 0 };
    reference.forEach(food => {
      [food.name].concat(food.aliases || []).forEach(candidate => {
        const r = tokens(candidate);
        const shared = q.filter(t => r.includes(t)).length;
        const score = shared ? 2 * shared / (q.length + r.length) : 0;
        if (score > bestScore) { bestScore = score; best = food; }
      });
    });
    return { food: best, score: bestScore };
  }

  const round1 = n => Math.round(n * 10) / 10;

  // Turn one typed segment into a food.csv-shaped item, with an estimate and a confidence flag.
  function estimate(segment, reference) {
    let { quantity, unit, name } = splitQuantity(segment);
    let { food, score } = bestMatch(name, reference);
    if (/^(small|medium|large)$/.test(unit || '')) {
      // "4 small corn tortillas": the size word is part of the food's name, not a unit
      const sized = bestMatch(unit + ' ' + name, reference);
      if (sized.score >= 0.99 || sized.score > score) { ({ food, score } = sized); name = unit + ' ' + name; unit = null; }
    }
    const typed = segment.trim().replace(/\s+/g, ' ');
    const label = name ? name.charAt(0).toUpperCase() + name.slice(1) : typed;

    if (!food || score < 0.5) {
      const count = quantity !== null && (!unit || !MASS[unit]) ? Math.min(quantity, 4) : 1;
      return {
        item: label, quantity: quantity === null ? 1 : round1(quantity), unit: unit || 'serving',
        calories: Math.round(200 * count), protein_g: round1(8 * count), carbs_g: round1(20 * count),
        fat_g: round1(9 * count), source: 'guess', note: `unverified; typed: ${typed}`,
        confident: false, why: 'not in the food list: rough guess',
      };
    }

    let grams, sure = score >= 0.99, why = score >= 0.99 ? '' : `closest match for "${name}"`;
    const size = { small: 0.8, medium: 1, large: 1.25 };
    let q = quantity, u = unit;
    if (q === null) { q = 1; u = u || food.default; sure = false; why = why || 'no amount given: assumed 1 ' + food.default; }
    if (!u) u = food.units.each ? 'each' : food.default;
    if (MASS[u]) grams = q * MASS[u];
    else if (u === 'floz') grams = q * 30;
    else if (food.units[u]) grams = q * food.units[u];
    else if (size[u]) { grams = q * food.units[food.default] * size[u]; }
    else if (VOLUME_GUESS[u]) { grams = q * VOLUME_GUESS[u]; sure = false; why = `no ${u} weight for this food: generic conversion`; }
    else { grams = q * food.grams; sure = false; why = `don't know "${u}" for this food: counted as servings`; }

    const k = grams / food.grams;
    return {
      item: food.name, quantity: round1(q), unit: u === 'floz' ? 'fl oz' : u,
      calories: Math.round(food.calories * k), protein_g: round1(food.protein_g * k),
      carbs_g: round1(food.carbs_g * k), fat_g: round1(food.fat_g * k),
      source: 'app', note: sure ? '' : `unverified; typed: ${typed}`, confident: sure, why,
    };
  }

  function parseEntry(text, reference) {
    return splitSegments(text).map(s => estimate(s, reference));
  }

  // ---- Ledger maths ----

  const num = v => (v === '' || v === undefined || v === null ? 0 : +v);

  function totals(rows) {
    const t = {};
    MACROS.forEach(([, key]) => { t[key] = rows.reduce((s, r) => s + num(r[key]), 0); });
    return t;
  }

  function nextEntryId(rows, date) {
    const used = rows.filter(r => r.date === date).map(r => parseInt(r.entry_id.split('-')[1], 10) || 0);
    const next = Math.max(0, ...used) + 1;
    return date.replace(/-/g, '') + '-' + String(next).padStart(2, '0');
  }

  function sortFood(rows) {
    return rows.map((r, i) => [r, i]).sort((a, b) =>
      a[0].date.localeCompare(b[0].date) || a[0].entry_id.localeCompare(b[0].entry_id) || a[1] - b[1]).map(x => x[0]);
  }

  function parseTargets(markdown) {
    const out = {};
    markdown.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z ]+):\s*([\d.,]+)/);
      if (m) out[m[1].trim().toLowerCase()] = parseFloat(m[2].replace(/,/g, ''));
    });
    return out;
  }

  // Same rule as tools/ledger.py: yesterday may still be open; any earlier unclosed day is a miss.
  function streak(dayRows, today) {
    const status = {};
    dayRows.forEach(r => { status[r.date] = r.status; });
    const yesterday = addDays(today, -1);
    const pending = yesterday >= STREAK_START && !status[yesterday];
    const last = pending ? addDays(yesterday, -1) : yesterday;
    const monthAgo = addDays(today, -31);
    let run = 0, best = 0, missed = 0;
    for (let d = STREAK_START; d <= last; d = addDays(d, 1)) {
      if (status[d] === 'complete') run++;
      else { run = 0; if (d > monthAgo) missed++; }
      best = Math.max(best, run);
    }
    return { current: run, best, missed, pending };
  }

  // ---- GitHub contents API: the ledger repo is the database ----

  const b64encode = text => {
    const bytes = new TextEncoder().encode(text);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), ch => ch.charCodeAt(0)));

  function github(repo, token) {
    const base = `https://api.github.com/repos/${repo}/contents/`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    async function call(url, options) {
      const res = await fetch(url, Object.assign({ headers, cache: 'no-store' }, options));
      if (res.ok) return res;
      let message = `GitHub error ${res.status}`;
      if (res.status === 401) message = 'GitHub rejected the token. It may be mistyped or expired: paste it again in Settings.';
      if (res.status === 403) message = 'The token can see the repo but may not change it. Edit the token and set Contents to "Read and write".';
      if (res.status === 404) {
        // GitHub answers 404 for a private repo the token was not given, so check which it is
        const repoSeen = await fetch(`https://api.github.com/repos/${repo}`, { headers, cache: 'no-store' }).then(r => r.ok, () => false);
        message = repoSeen
          ? `${repo} is missing a file the app needs, or the token lacks Contents access.`
          : `This token can't see ${repo}. Edit the token: Repository access, "Only select repositories", choose ${repo.split('/')[1]} (not the -app repo), and set Contents to "Read and write".`;
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return {
      async read(path) {
        const meta = await (await call(base + path + '?ref=main')).json();
        if (meta.content) return { text: b64decode(meta.content), sha: meta.sha };
        // files over 1 MB come back without content
        const raw = await call(base + path + '?ref=main', { headers: Object.assign({}, headers, { Accept: 'application/vnd.github.raw+json' }) });
        return { text: await raw.text(), sha: meta.sha };
      },
      async write(path, text, sha, message) {
        const res = await call(base + path, { method: 'PUT', body: JSON.stringify({ message, content: b64encode(text), sha, branch: 'main' }) });
        return (await res.json()).content.sha;
      },
    };
  }

  const api = { FOOD_FIELDS, WEIGHT_FIELDS, DAYS_FIELDS, MACROS, parseCSV, toCSV, chicagoNow, addDays,
    prettyDate, splitQuantity, splitSegments, bestMatch, estimate, parseEntry, totals, nextEntryId,
    sortFood, parseTargets, streak, num, github };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
