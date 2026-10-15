// node test.js [path-to-ledger-repo]
// Checks the CSV round trip against the real ledger files and the food parser against known entries.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Core = require('./core.js');

const ledger = process.argv[2] || path.join(__dirname, '..', 'weightloss-ledger');
const reference = JSON.parse(fs.readFileSync(path.join(ledger, 'data/reference.json'), 'utf8'));

for (const file of ['food.csv', 'weight.csv', 'days.csv', 'plans.csv', 'events.csv', 'orders.csv']) {
  const text = fs.readFileSync(path.join(ledger, 'data', file), 'utf8').replace(/\r\n/g, '\n');
  const { header, rows } = Core.parseCSV(text);
  assert.strictEqual(Core.toCSV(header, rows), text, `${file} does not round-trip`);
  console.log(`ok  ${file} round-trips (${rows.length} rows)`);
}

// [typed text, expected item, expected calories, tolerance, expect confident]
const cases = [
  ['200 g of 2% milk', '2% milk', 100, 0, true],
  ['250g 2% milk', '2% milk', 125, 0, true],
  ['one scoop of protein powder', 'Vanilla protein powder', 160, 0, true],
  ['3 scoops protein powder', 'Vanilla protein powder', 480, 0, true],
  ['170 g of nonfat vanilla Greek yogurt', 'Nonfat vanilla Greek yogurt', 100, 0, true],
  ['a bag of broccoli', 'Frozen broccoli', 100, 0, true],
  ['1 bag of broccoli', 'Frozen broccoli', 100, 0, true],
  ['1/8 cup shredded cheddar cheese', 'Shredded cheddar cheese', 55, 0, true],
  ['1/8 cup of shredded sharp cheddar cheese', 'Shredded cheddar cheese', 55, 0, true],
  ['12 g of sharp cheddar cheese', 'Shredded cheddar cheese', 47, 1, true],
  ['1 tbsp. of ranch dressing', 'Ranch dressing', 73, 0, true],
  ['1.5 cups of baby carrots', 'Baby carrots', 67, 1, true],
  ['3 eggs', 'Egg', 216, 0, true],
  ['4 small corn tortillas', 'Small corn tortilla', 208, 0, true],
  ['30 tortilla chips', 'Tortilla chips', 420, 0, true],
  ['1/2 cup rice', 'White rice', 103, 1, true],
  ['half a cup of blueberries', 'Blueberries', 42, 0, true],
  ['four strawberries', 'Strawberries', 15, 1, true],
  ['6 oz. of 2% milk', '2% milk', 85, 1, true],
  ['1 tablespoon of sour cream', 'Sour cream', 30, 0, true],
  ['a knob of butter', 'Butter', 100, 0, true],
  ['1 piece of cornbread', 'Cornbread', 180, 0, true],
  ['1 cup of homemade chili', 'Homemade chili', 280, 0, true],
  ['protein powder 2 scoops', 'Vanilla protein powder', 320, 0, true],
  ['2 Rockin protein shakes', 'Rockin Protein shake', 380, 0, true],
  ['dragonfruit smoothie bowl', 'Dragonfruit smoothie bowl', 200, 0, false],
];
for (const [text, item, cal, tol, confident] of cases) {
  const got = Core.estimate(text, reference);
  assert.strictEqual(got.item, item, `${text}: item ${got.item}`);
  assert.ok(Math.abs(got.calories - cal) <= tol, `${text}: ${got.calories} cal, expected ${cal}`);
  assert.strictEqual(got.confident, confident, `${text}: confident=${got.confident} (${got.why})`);
}
console.log(`ok  ${cases.length} food estimates`);

const multi = Core.parseEntry('200 g 2% milk, 170 g of nonfat vanilla Greek yogurt, and one scoop of protein powder.', reference);
assert.deepStrictEqual(multi.map(i => i.calories), [100, 100, 160]);
const list = Core.parseEntry('- 1 cup of mac and cheese\n- 2 eggs and 1 slice of toast', reference);
assert.deepStrictEqual(list.map(i => i.item), ['Macaroni and cheese', 'Egg', 'Bread']);
const dictated = Core.parseEntry('2 cups of spaghetti. A quarter cup of low-fat sharp cheddar cheese', reference);
assert.deepStrictEqual(dictated.map(i => [i.item, i.calories]), [['Spaghetti', 400], ['Low-fat shredded cheddar cheese', 80]]);
assert.deepStrictEqual(Core.parseEntry('1 tbsp. of ranch dressing. 1.5 cups of baby carrots', reference).map(i => i.calories), [73, 67]);
const stated = (text) => Core.parseEntry(text, reference).map(i => [i.item, i.calories, i.source]);
assert.deepStrictEqual(stated('One 460-calorie jumbo muffin from Cub Foods.'), [['Jumbo muffin', 460, 'label']]);
assert.deepStrictEqual(stated('2 rockin protein shakes, 190 calories each'), [['Rockin Protein shake', 380, 'label']]);
assert.deepStrictEqual(stated('gas station burrito 520 cal, 1 apple'), [['Burrito', 520, 'label'], ['Apple', 95, 'app']]);
assert.strictEqual(Core.parseEntry('3 mystery bars at 150 calories each', reference)[0].calories, 450);
console.log('ok  multi-item entries');

const days = [['2026-10-01', 'complete'], ['2026-10-02', 'complete'], ['2026-10-03', 'complete']]
  .map(([date, status]) => ({ date, status }));
assert.deepStrictEqual(Core.streak(days, '2026-10-04'), { current: 3, best: 3, missed: 0, pending: false });
assert.deepStrictEqual(Core.streak(days, '2026-10-05'), { current: 3, best: 3, missed: 0, pending: true });
assert.deepStrictEqual(Core.streak(days, '2026-10-06'), { current: 0, best: 3, missed: 1, pending: true });
assert.strictEqual(Core.nextEntryId([{ date: '2026-10-07', entry_id: '20261007-02' }], '2026-10-07'), '20261007-03');
assert.match(Core.chicagoNow(new Date('2026-10-07T04:30:00Z')).date, /^2026-10-06$/);
console.log('ok  streak, entry ids, Chicago time');

// Planning ahead: dinner and the evening snack both planned before 4 PM that day
const plan = (date, slot, at, extra) => Object.assign({ date, slot, plan: 'x', tag: '', planned_at: at, status: '', entry_id: '', note: '' }, extra);
const plans = [
  plan('2026-10-15', 'dinner', '2026-10-15 08:10'), plan('2026-10-15', 'evening', '2026-10-15 08:10'),
  plan('2026-10-16', 'dinner', '2026-10-15 21:00'), plan('2026-10-16', 'evening', '2026-10-16 15:59'),
  plan('2026-10-17', 'dinner', '2026-10-17 09:00'), plan('2026-10-17', 'evening', '2026-10-17 18:30'), // too late
  plan('2026-10-18', 'dinner', '2026-10-18 07:00'), plan('2026-10-18', 'evening', '2026-10-18 07:00'),
];
assert.strictEqual(Core.plannedAhead(plans, '2026-10-16'), true);
assert.strictEqual(Core.plannedAhead(plans, '2026-10-17'), false);
assert.deepStrictEqual(Core.planStreak(plans, '2026-10-16'), { current: 2, best: 2, today: true });
assert.deepStrictEqual(Core.planStreak(plans, '2026-10-17'), { current: 2, best: 2, today: false }); // today still open
assert.deepStrictEqual(Core.planStreak(plans, '2026-10-18'), { current: 1, best: 2, today: true });
assert.deepStrictEqual(Core.planStreak(plans, '2026-10-19'), { current: 1, best: 2, today: false });

// Editing keeps the first planned_at; eaten plans aren't touched; an emptied plan goes away
let rows = Core.upsertPlans([], '2026-10-20', [{ slot: 'evening', plan: 'yogurt' }, { slot: 'dinner', plan: 'chicken' }], '2026-10-20 08:00');
assert.deepStrictEqual(rows.map(r => r.slot), ['dinner', 'evening']);
rows = Core.upsertPlans(rows, '2026-10-20', [{ slot: 'dinner', plan: 'tacos', tag: 'celebration' }], '2026-10-20 19:00');
assert.deepStrictEqual([rows[0].plan, rows[0].tag, rows[0].planned_at], ['tacos', 'celebration', '2026-10-20 08:00']);
rows[1].status = 'eaten';
rows = Core.upsertPlans(rows, '2026-10-20', [{ slot: 'evening', plan: '' }, { slot: 'dinner', plan: '' }], '2026-10-20 20:00');
assert.deepStrictEqual(rows.map(r => r.slot), ['evening']);
assert.strictEqual(Core.toCSV(Core.PLAN_FIELDS, rows).split('\n')[0], 'date,slot,plan,tag,planned_at,status,entry_id,note');

// Weight: 7-day average and the week before
const weights = [['2026-10-01', 262], ['2026-10-05', 260], ['2026-10-09', 259], ['2026-10-12', 257]].map(([date, w]) => ({ date, weight_lb: String(w) }));
const wt = Core.weightTrend(weights, '2026-10-12');
assert.deepStrictEqual([wt.avg, wt.prev, wt.change], [258, 261, -3]);

// Debrief only after a day above 125% of target
const day = [{ date: '2026-10-14', calories: '2000' }, { date: '2026-10-14', calories: '200' }];
assert.strictEqual(Core.bigDay(day, '2026-10-14', 1700), true);
assert.strictEqual(Core.bigDay(day.slice(0, 1), '2026-10-14', 1700), false);

// Go-to orders become saved food rows
const orders = [{ restaurant: 'Panera', item: 'Soup', quantity: '1', unit: 'cup', calories: '180', protein_g: '6', carbs_g: '18', fat_g: '10', note: '' },
  { restaurant: 'Chick-fil-A', item: 'Grilled nuggets', quantity: '8', unit: 'each', calories: '130', protein_g: '25', carbs_g: '1', fat_g: '3', note: '' }];
assert.deepStrictEqual(Core.orderNames(orders), ['Chick-fil-A', 'Panera']);
assert.deepStrictEqual(Core.orderItems(orders, 'Panera').map(i => [i.item, i.calories, i.source]), [['Soup', 180, 'saved']]);
console.log('ok  plans, planning streak, weight trend, debrief, go-to orders');
