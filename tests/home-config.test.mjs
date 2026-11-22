import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../app-catalog.json', import.meta.url), 'utf8'));
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const oniki = new URL('../oniki.html', import.meta.url);

test('school and category identifiers and internal routes', () => {
  assert.equal(catalog.schema_version,1);
  const schools = new Set();
  for (const school of catalog.schools) {
    assert.match(school.id,/^[a-z0-9-]+$/);
    assert.ok(!schools.has(school.id));
    schools.add(school.id);
    const cats = new Set();
    for (const c of school.categories || []) {
      assert.match(c.id,/^[a-z0-9-]+$/);
      assert.ok(!cats.has(c.id));
      cats.add(c.id);
      assert.ok(c.title);
      const target = new URL(c.href,'https://example.test/');
      assert.equal(target.origin,'https://example.test');
      assert.match(target.pathname,/\.html$/);
    }
    if(school.status==='pending') assert.equal((school.categories||[]).length,0);
  }
  assert.ok(schools.has('oniki'));
  assert.ok(schools.has('nihon-isen'));
});

test('Oniki original and deep links retained', () => {
  assert.ok(statSync(oniki).size > 1_000_000);
  const source = readFileSync(oniki,'utf8');
  const bank = catalog.schools.find(s=>s.id==='oniki').categories;
  for (const key of ['grad','term','class','national']) {
    assert.ok(source.includes('href="#app='+key+'"'));
    assert.ok(bank.some(c=>c.id===key && c.href.endsWith('#app='+key)));
  }
  assert.ok(home.includes('location.replace'));
  assert.ok(home.includes('./app-catalog.json'));
});
test('Judo remains pending until finished layout arrives', () => {
  const judo = catalog.schools.find(s=>s.id==='nihon-isen');
  assert.equal(judo.status,'pending');
  assert.equal(judo.categories.length,0);
  assert.ok(!home.includes('judo-preview.html'));
});
