import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toDateKey,
  isValidDateKey,
  addDays,
  createEmptyState,
  normalizeName,
  addHabit,
  removeHabit,
  toggleRecord,
  addMonths,
  isDone,
  currentStreak,
  monthCalendar,
  parseState,
  serializeState,
  createExportText,
  exportFileName,
  summarizeState,
  MAX_NAME_LENGTH,
} from './habits.js';

const habitWith = (records) => ({ id: 'h', name: 'テスト', createdAt: '2026-01-01', records });

test('toDateKey は端末のタイムゾーンの年月日を使う', () => {
  assert.equal(toDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(toDateKey(new Date(2026, 10, 14, 0, 0)), '2026-11-14');
});

test('isValidDateKey は実在する YYYY-MM-DD だけを通す', () => {
  assert.equal(isValidDateKey('2026-11-14'), true);
  assert.equal(isValidDateKey('2028-02-29'), true);
  assert.equal(isValidDateKey('2026-02-29'), false);
  assert.equal(isValidDateKey('2026-13-01'), false);
  assert.equal(isValidDateKey('2026-1-1'), false);
  assert.equal(isValidDateKey(''), false);
  assert.equal(isValidDateKey(20261114), false);
});

test('addDays は月末・年末・うるう年をまたげる', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('normalizeName は前後の空白を除き、連続する空白をまとめる', () => {
  assert.equal(normalizeName('  朝の   散歩 '), '朝の 散歩');
  assert.equal(normalizeName('　読書　'), '読書');
});

test('addHabit は習慣を追加し、元の state を変えない', () => {
  const before = createEmptyState();
  const after = addHabit(before, ' 朝の散歩 ', { id: 'a', today: '2026-11-14' });
  assert.deepEqual(after.habits, [
    { id: 'a', name: '朝の散歩', createdAt: '2026-11-14', records: [] },
  ]);
  assert.deepEqual(before.habits, []);
});

test('addHabit は空の名前・長すぎる名前・重複を拒む', () => {
  const opts = { id: 'x', today: '2026-11-14' };
  const state = addHabit(createEmptyState(), '読書', { id: 'a', today: '2026-11-14' });
  assert.throws(() => addHabit(state, '   ', opts), /名前を入力/);
  assert.throws(() => addHabit(state, 'あ'.repeat(MAX_NAME_LENGTH + 1), opts), /文字以内/);
  assert.throws(() => addHabit(state, ' 読書 ', opts), /同じ名前/);
  assert.throws(() => addHabit(state, '日記', { id: 'a', today: '2026-11-14' }), /id が重複/);
  // ちょうど上限の長さは通る(絵文字も1文字として数える)
  assert.doesNotThrow(() => addHabit(state, '🏃'.repeat(MAX_NAME_LENGTH), opts));
});

test('toggleRecord は記録をつけ外しし、日付順に保つ', () => {
  let state = addHabit(createEmptyState(), '読書', { id: 'a', today: '2026-11-01' });
  const original = state;
  state = toggleRecord(state, 'a', '2026-11-14');
  state = toggleRecord(state, 'a', '2026-11-02');
  assert.deepEqual(state.habits[0].records, ['2026-11-02', '2026-11-14']);
  assert.equal(isDone(state.habits[0], '2026-11-14'), true);

  state = toggleRecord(state, 'a', '2026-11-14');
  assert.deepEqual(state.habits[0].records, ['2026-11-02']);
  assert.deepEqual(original.habits[0].records, []);
});

test('toggleRecord は不正な日付や存在しない習慣で Error を投げる', () => {
  const state = addHabit(createEmptyState(), '読書', { id: 'a', today: '2026-11-01' });
  assert.throws(() => toggleRecord(state, 'a', '2026-11-31'), /日付の形式/);
  assert.throws(() => toggleRecord(state, 'nope', '2026-11-14'), /見つかりません/);
});

test('removeHabit は指定した習慣だけを消し、元の state を変えない', () => {
  let state = addHabit(createEmptyState(), '読書', { id: 'a', today: '2026-11-01' });
  state = addHabit(state, '散歩', { id: 'b', today: '2026-11-01' });
  const after = removeHabit(state, 'a');
  assert.deepEqual(after.habits.map((h) => h.id), ['b']);
  assert.equal(state.habits.length, 2);
  assert.throws(() => removeHabit(after, 'a'), /見つかりません/);
});

test('toggleRecord は過去の日を切り替えられ、today より先の日は拒む', () => {
  let state = addHabit(createEmptyState(), '読書', { id: 'a', today: '2026-11-01' });
  state = toggleRecord(state, 'a', '2026-10-31', { today: '2026-11-14' });
  state = toggleRecord(state, 'a', '2026-11-14', { today: '2026-11-14' });
  assert.deepEqual(state.habits[0].records, ['2026-10-31', '2026-11-14']);
  assert.throws(() => toggleRecord(state, 'a', '2026-11-15', { today: '2026-11-14' }), /まだ来ていない/);
});

test('過去の日を埋めると連続日数がつながる', () => {
  let state = parseState(readFileSync(new URL('./sample-backup.json', import.meta.url), 'utf8'));
  const id = state.habits[1].id; // 読書: 11/12 だけ記録、11/13 と今日は未記録
  assert.equal(currentStreak(state.habits[1], '2026-11-14'), 0);
  state = toggleRecord(state, id, '2026-11-13', { today: '2026-11-14' });
  assert.equal(currentStreak(state.habits[1], '2026-11-14'), 2);
  state = toggleRecord(state, id, '2026-11-10', { today: '2026-11-14' });
  state = toggleRecord(state, id, '2026-11-11', { today: '2026-11-14' });
  assert.equal(currentStreak(state.habits[1], '2026-11-14'), 11); // 11/3〜11/13
});

test('addMonths は年をまたげる', () => {
  assert.deepEqual(addMonths(2026, 11, 1), { year: 2026, month: 12 });
  assert.deepEqual(addMonths(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(addMonths(2026, 11, -23), { year: 2024, month: 12 });
});

test('monthCalendar: 過去の月はすべての日が経過済み', () => {
  const cal = monthCalendar(habitWith(['2026-10-31']), 2026, 10, '2026-11-14');
  assert.equal(cal.elapsedDays, 31);
  assert.equal(cal.doneCount, 1);
  assert.equal(cal.days.some((d) => d.isToday || d.isFuture), false);
});

test('currentStreak: 今日まで続いていれば今日を含めて数える', () => {
  const h = habitWith(['2026-11-10', '2026-11-12', '2026-11-13', '2026-11-14']);
  assert.equal(currentStreak(h, '2026-11-14'), 3);
});

test('currentStreak: 今日が未記録でも昨日まで続いていれば途切れていない', () => {
  const h = habitWith(['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.equal(currentStreak(h, '2026-11-14'), 3);
});

test('currentStreak: 昨日も今日も未記録なら 0', () => {
  assert.equal(currentStreak(habitWith(['2026-11-12']), '2026-11-14'), 0);
  assert.equal(currentStreak(habitWith([]), '2026-11-14'), 0);
});

test('currentStreak: 月や年をまたいで数え、未来の記録は数えない', () => {
  const h = habitWith(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-03']);
  assert.equal(currentStreak(h, '2027-01-01'), 3);
});

test('monthCalendar: 曜日の空き・日数・今日と未来の区別', () => {
  const h = habitWith(['2026-04-01', '2026-04-10', '2026-04-20']);
  const cal = monthCalendar(h, 2026, 4, '2026-04-15');
  assert.equal(cal.leadingBlanks, 3); // 2026-04-01 は水曜
  assert.equal(cal.days.length, 30);
  assert.deepEqual(cal.days[0], { date: '2026-04-01', day: 1, done: true, isToday: false, isFuture: false });
  assert.equal(cal.days[14].isToday, true);
  assert.equal(cal.days[19].isFuture, true);
  assert.equal(cal.elapsedDays, 15);
  assert.equal(cal.doneCount, 2); // 未来の 04-20 は数えない
});

test('monthCalendar: うるう年の2月と日曜始まりの月', () => {
  assert.equal(monthCalendar(habitWith([]), 2028, 2, '2028-02-01').days.length, 29);
  assert.equal(monthCalendar(habitWith([]), 2026, 11, '2026-11-14').leadingBlanks, 0); // 2026-11-01 は日曜
});

test('parseState: アプリの書き出しファイル(sample-backup.json)を読める', () => {
  const text = readFileSync(new URL('./sample-backup.json', import.meta.url), 'utf8');
  const state = parseState(text);
  assert.equal(state.version, 1);
  assert.equal('exportedAt' in state, false);
  assert.deepEqual(
    state.habits.map((h) => [h.name, currentStreak(h, '2026-11-14')]),
    [
      ['朝の散歩(練習用)', 5],
      ['読書15分(練習用)', 0],
      ['日記を書く(練習用)', 0],
    ],
  );
  assert.equal(monthCalendar(state.habits[0], 2026, 11, '2026-11-14').doneCount, 11);
});

test('parseState: 記録の重複を除いて並べ替え、知らない項目を捨てる', () => {
  const state = parseState(JSON.stringify({
    version: 1,
    extra: true,
    habits: [{ id: 'a', name: ' 読書 ', records: ['2026-11-03', '2026-11-01', '2026-11-03'], color: 'red' }],
  }));
  assert.deepEqual(state, {
    version: 1,
    habits: [{ id: 'a', name: '読書', records: ['2026-11-01', '2026-11-03'] }],
  });
});

test('parseState: 形の正しくないデータは Error を投げる', () => {
  const bad = (obj) => () => parseState(JSON.stringify(obj));
  assert.throws(() => parseState('{oops'), /JSON として/);
  assert.throws(bad(null), /このアプリで書き出したファイルではありません/);
  assert.throws(bad([]), /このアプリで書き出したファイルではありません/);
  assert.throws(bad({ items: [] }), /このアプリで書き出したファイルではありません/);
  assert.throws(bad({ version: 2, habits: [] }), /バージョン/);
  assert.throws(bad({ version: 1 }), /habits が配列/);
  assert.throws(bad({ version: 1, habits: [{ id: '', name: 'a', records: [] }] }), /id が正しくありません/);
  assert.throws(bad({ version: 1, habits: [{ id: 'a', name: '  ', records: [] }] }), /名前が空/);
  assert.throws(bad({ version: 1, habits: [{ id: 'a', name: 'a', records: ['2026-02-30'] }] }), /正しくない日付/);
  assert.throws(bad({ version: 1, habits: [{ id: 'a', name: 'a', records: 'x' }] }), /records が配列/);
  assert.throws(bad({ version: 1, habits: [{ id: 'a', name: 'a', createdAt: 'x', records: [] }] }), /createdAt/);
  assert.throws(
    bad({ version: 1, habits: [{ id: 'a', name: 'a', records: [] }, { id: 'a', name: 'b', records: [] }] }),
    /id が重複/,
  );
});

test('serializeState と parseState で元に戻る', () => {
  let state = addHabit(createEmptyState(), '読書', { id: 'a', today: '2026-11-01' });
  state = toggleRecord(state, 'a', '2026-11-14');
  assert.deepEqual(parseState(serializeState(state)), state);
});

test('createExportText: version と exportedAt を含み、読み込むと元に戻る', () => {
  let state = addHabit(createEmptyState(), '読書', { id: 'a', today: '2026-11-01' });
  state = toggleRecord(state, 'a', '2026-11-14');
  const text = createExportText(state, new Date('2026-11-14T09:30:00Z'));
  const data = JSON.parse(text);
  assert.equal(data.version, 1);
  assert.equal(data.exportedAt, '2026-11-14T09:30:00.000Z');
  assert.deepEqual(parseState(text), state);
});

test('書き出しファイルの形は sample-backup.json と同じ項目を持つ', () => {
  const sample = JSON.parse(readFileSync(new URL('./sample-backup.json', import.meta.url), 'utf8'));
  const exported = JSON.parse(createExportText(parseState(JSON.stringify(sample)), new Date()));
  assert.deepEqual(Object.keys(exported), Object.keys(sample));
  // 値だけでなく項目の並び順もサンプルと同じ
  assert.equal(JSON.stringify(exported.habits), JSON.stringify(sample.habits));
});

test('exportFileName は日付入りのファイル名を返す', () => {
  assert.equal(exportFileName('2026-11-14'), 'habit-backup-2026-11-14.json');
});

test('summarizeState は習慣の数と記録の合計日数を数える', () => {
  const state = parseState(readFileSync(new URL('./sample-backup.json', import.meta.url), 'utf8'));
  assert.deepEqual(summarizeState(state), { habitCount: 3, recordCount: 26 });
  assert.deepEqual(summarizeState(createEmptyState()), { habitCount: 0, recordCount: 0 });
});
