import test from 'node:test';
import assert from 'node:assert/strict';
import {AREAS, AREA_REFERENCE, areaScore, gramsFrom, gradeFor, dailyBrain, profileBrain, radarPoints} from '../brain-score.js';

test('area score is 0..100 against each category reference', () => {
  assert.equal(areaScore(0, 0), 0);
  assert.equal(areaScore(0, AREA_REFERENCE[0]), 100);
  assert.equal(areaScore(1, AREA_REFERENCE[1] / 2), 50);
  assert.equal(areaScore(2, 999999), 100);
  assert.equal(areaScore(3, -5), 0);
  assert.equal(areaScore(4, 'x'), 0);
});

test('말랑그램 ranges 400g..2000g in 10g steps', () => {
  assert.equal(gramsFrom([0, 0, 0, 0, 0]), 400);
  assert.equal(gramsFrom([100, 100, 100, 100, 100]), 2000);
  assert.equal(gramsFrom([50, 50, 50, 50, 50]) % 10, 0);
  assert.equal(gradeFor(400).name, '새싹 두뇌');
  assert.equal(gradeFor(810).name, '말랑 두뇌');
  assert.equal(gradeFor(2000).name, '전설의 두뇌');
});

test('daily brain uses the five stage results in category order', () => {
  const results = AREA_REFERENCE.map((ref) => ({ score: ref }));
  const brain = dailyBrain(results);
  assert.deepEqual(brain.areas, [100, 100, 100, 100, 100]);
  assert.equal(brain.grams, 2000);
  assert.equal(dailyBrain([]).grams, 400);
});

test('profile needs all five areas and averages recent records', () => {
  const partial = profileBrain({ 0: [3200], 1: [600] });
  assert.equal(partial.grams, null);
  assert.equal(partial.measured, 2);
  assert.deepEqual(partial.areas.slice(0, 2), [100, 50]);
  const full = profileBrain({ 0: [1600, 1600], 1: { a: 600 }, 2: [750], 3: [700], 4: [800] });
  assert.deepEqual(full.areas, [50, 50, 50, 50, 50]);
  assert.equal(full.grams, 1200);
  assert.equal(full.grade.name, '탱글 두뇌');
});

test('radar points start at the top and go clockwise', () => {
  const [[x0, y0], [x1]] = radarPoints([100, 100, 100, 100, 100], 10, 50, 50);
  assert.ok(Math.abs(x0 - 50) < 1e-9 && Math.abs(y0 - 40) < 1e-9);
  assert.ok(x1 > 50);
  assert.equal(AREAS.length, 5);
});
