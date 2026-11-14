// 習慣トラッカーの画面に関係しない処理。
// 日付計算・記録の更新・連続日数・月の集計・保存形式の読み書きを扱う。
// どの関数も渡された state を書き換えず、新しい state を返す。
//
// 保存形式(version 1):
// {
//   "version": 1,
//   "habits": [
//     { "id": "h1", "name": "朝の散歩", "createdAt": "2026-11-01", "records": ["2026-11-01", ...] }
//   ]
// }
// records は記録した日付(YYYY-MM-DD)だけを昇順・重複なしで持つ。

export const STORAGE_VERSION = 1;
export const MAX_NAME_LENGTH = 30;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Date を端末のタイムゾーンでの日付キー(YYYY-MM-DD)にする。 */
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 実在する日付の YYYY-MM-DD かどうか。 */
export function isValidDateKey(key) {
  if (typeof key !== 'string' || !DATE_KEY_RE.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 日付キーに n 日足す(負なら引く)。UTC で計算するので夏時間の影響を受けない。 */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function createEmptyState() {
  return { version: STORAGE_VERSION, habits: [] };
}

/** 前後の空白を除き、連続する空白を1つにまとめる。 */
export function normalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * 習慣を追加した新しい state を返す。名前が不正なら Error を投げる(message は画面にそのまま出せる文言)。
 * @param {{id: string, today: string}} options
 */
export function addHabit(state, name, { id, today }) {
  const normalized = normalizeName(name);
  if (normalized === '') throw new Error('習慣の名前を入力してください。');
  if ([...normalized].length > MAX_NAME_LENGTH) {
    throw new Error(`習慣の名前は${MAX_NAME_LENGTH}文字以内にしてください。`);
  }
  if (state.habits.some((h) => h.name === normalized)) {
    throw new Error('同じ名前の習慣がすでにあります。');
  }
  if (state.habits.some((h) => h.id === id)) throw new Error(`id が重複しています: ${id}`);
  if (!isValidDateKey(today)) throw new Error(`日付の形式が正しくありません: ${today}`);

  const habit = { id, name: normalized, createdAt: today, records: [] };
  return { ...state, habits: [...state.habits, habit] };
}

/** 指定した日の記録をつける/外す(切り替える)。 */
export function toggleRecord(state, habitId, date) {
  if (!isValidDateKey(date)) throw new Error(`日付の形式が正しくありません: ${date}`);
  const index = state.habits.findIndex((h) => h.id === habitId);
  if (index === -1) throw new Error(`習慣が見つかりません: ${habitId}`);

  const habit = state.habits[index];
  const records = habit.records.includes(date)
    ? habit.records.filter((r) => r !== date)
    : [...habit.records, date].sort();
  const habits = state.habits.slice();
  habits[index] = { ...habit, records };
  return { ...state, habits };
}

export function isDone(habit, date) {
  return habit.records.includes(date);
}

/**
 * 連続日数。今日が未記録でも、昨日まで続いていればその日数を返す
 * (今日はまだ終わっていないので、途切れたとはみなさない)。
 */
export function currentStreak(habit, today) {
  const done = new Set(habit.records);
  let day = done.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (done.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

/**
 * 月のカレンダー表示用データ。週は日曜始まり。
 * @param {number} year
 * @param {number} month 1〜12
 * @returns {{year, month, leadingBlanks, days: Array<{date, day, done, isToday, isFuture}>, doneCount, elapsedDays}}
 */
export function monthCalendar(habit, year, month, today) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const done = new Set(habit.records);
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    days.push({ date, day, done: done.has(date), isToday: date === today, isFuture: date > today });
  }
  return {
    year,
    month,
    leadingBlanks: first.getUTCDay(),
    days,
    doneCount: days.filter((d) => d.done && !d.isFuture).length,
    elapsedDays: days.filter((d) => !d.isFuture).length,
  };
}

/**
 * 保存された JSON 文字列を検証して state にする。形が正しくなければ Error を投げる。
 * 書き出しファイル(exportedAt などを含むもの)もそのまま読める。知らない項目は捨てる。
 */
export function parseState(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON として読み込めません。');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('データの形式が正しくありません。');
  }
  if (data.version !== STORAGE_VERSION) {
    throw new Error(`対応していないバージョンです: ${data.version}`);
  }
  if (!Array.isArray(data.habits)) throw new Error('habits が配列ではありません。');

  const ids = new Set();
  const habits = data.habits.map((h, i) => {
    const where = `${i + 1}番目の習慣`;
    if (h === null || typeof h !== 'object') throw new Error(`${where}の形式が正しくありません。`);
    if (typeof h.id !== 'string' || h.id === '') throw new Error(`${where}の id が正しくありません。`);
    if (ids.has(h.id)) throw new Error(`id が重複しています: ${h.id}`);
    ids.add(h.id);
    const name = normalizeName(typeof h.name === 'string' ? h.name : '');
    if (name === '') throw new Error(`${where}の名前が空です。`);
    if (h.createdAt !== undefined && !isValidDateKey(h.createdAt)) {
      throw new Error(`${where}の createdAt が正しくありません: ${h.createdAt}`);
    }
    if (!Array.isArray(h.records)) throw new Error(`${where}の records が配列ではありません。`);
    for (const r of h.records) {
      if (!isValidDateKey(r)) throw new Error(`${where}に正しくない日付があります: ${r}`);
    }
    const habit = { id: h.id, name, records: [...new Set(h.records)].sort() };
    if (h.createdAt !== undefined) habit.createdAt = h.createdAt;
    return habit;
  });
  return { version: STORAGE_VERSION, habits };
}

export function serializeState(state) {
  return JSON.stringify(state);
}
