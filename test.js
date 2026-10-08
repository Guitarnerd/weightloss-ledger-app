// node test.js [path-to-ledger-repo]
// Checks the CSV round trip against the real ledger files and the food parser against known entries.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Core = require('./core.js');

const ledger = process.argv[2] || path.join(__dirname, '..', 'weightloss-ledger');
const reference = JSON.parse(fs.readFileSync(path.join(ledger, 'data/reference.json'), 'utf8'));

for (const file of ['food.csv', 'weight.csv', 'days.csv']) {
  const text = fs.readFileSync(path.join(ledger, 'data', file), 'utf8').replace(/\r\n/g, '\n');
  const { header, rows } = Core.parseCSV(text);
  assert.strictEqual(Core.toCSV(header, rows), text, `${file} does not round-trip`);
  console.log(`ok  ${file} round-trips (${rows.length} rows)`);
}

// [typed text, expected item, expected calories, tolerance, expect confident]
const cases = [
  ['200 g of 2% milk', '2% milk', 100, 0, true],
  ['250g 2% milk', '2% milk', 125, 0, true],
  ['one scoop of protein powder', 'Vanilla protein powder', 120, 0, true],
  ['3 scoops protein powder', 'Vanilla protein powder', 360, 0, true],
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
  ['protein powder 2 scoops', 'Vanilla protein powder', 240, 0, true],
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
assert.deepStrictEqual(multi.map(i => i.calories), [100, 100, 120]);
const list = Core.parseEntry('- 1 cup of mac and cheese\n- 2 eggs and 1 slice of toast', reference);
assert.deepStrictEqual(list.map(i => i.item), ['Macaroni and cheese', 'Egg', 'Bread']);
const dictated = Core.parseEntry('2 cups of spaghetti. A quarter cup of low-fat sharp cheddar cheese', reference);
assert.deepStrictEqual(dictated.map(i => [i.item, i.calories]), [['Spaghetti', 400], ['Low-fat shredded cheddar cheese', 80]]);
assert.deepStrictEqual(Core.parseEntry('1 tbsp. of ranch dressing. 1.5 cups of baby carrots', reference).map(i => i.calories), [73, 67]);
console.log('ok  multi-item entries');

const days = [['2026-10-01', 'complete'], ['2026-10-02', 'complete'], ['2026-10-03', 'complete']]
  .map(([date, status]) => ({ date, status }));
assert.deepStrictEqual(Core.streak(days, '2026-10-04'), { current: 3, best: 3, missed: 0, pending: false });
assert.deepStrictEqual(Core.streak(days, '2026-10-05'), { current: 3, best: 3, missed: 0, pending: true });
assert.deepStrictEqual(Core.streak(days, '2026-10-06'), { current: 0, best: 3, missed: 1, pending: true });
assert.strictEqual(Core.nextEntryId([{ date: '2026-10-07', entry_id: '20261007-02' }], '2026-10-07'), '20261007-03');
assert.match(Core.chicagoNow(new Date('2026-10-07T04:30:00Z')).date, /^2026-10-06$/);
console.log('ok  streak, entry ids, Chicago time');
