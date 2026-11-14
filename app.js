// 画面の表示と操作。データの扱いは habits.js に任せる。
import {
  createEmptyState,
  addHabit,
  toggleRecord,
  isDone,
  currentStreak,
  monthCalendar,
  parseState,
  serializeState,
  toDateKey,
} from './habits.js';

const STORAGE_KEY = 'habit-tracker:v1';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const els = {
  today: document.getElementById('today'),
  form: document.getElementById('add-form'),
  name: document.getElementById('habit-name'),
  message: document.getElementById('message'),
  empty: document.getElementById('empty'),
  list: document.getElementById('habit-list'),
};

let today = toDateKey(new Date());
let state = loadState();

// ---- 保存(端末の localStorage のみ) ----

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    showMessage('この端末ではデータを保存できません(プライベートブラウズなど)。', true);
    return createEmptyState();
  }
  if (raw === null) return createEmptyState();
  try {
    return parseState(raw);
  } catch (err) {
    // 壊れたデータは消さずに別名で残し、空の状態から始める
    try {
      localStorage.setItem(`${STORAGE_KEY}:broken:${Date.now()}`, raw);
    } catch { /* 退避できなくても起動は続ける */ }
    showMessage(`保存データを読み込めませんでした(${err.message})。元のデータは別名で残しています。`, true);
    return createEmptyState();
  }
}

function saveState(next) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(next));
    return true;
  } catch {
    showMessage('保存できませんでした。端末の空き容量や設定を確認してください。', true);
    return false;
  }
}

/** 保存に成功したときだけ画面の状態を更新する。 */
function commit(next) {
  if (!saveState(next)) return false;
  state = next;
  render();
  return true;
}

// ---- 表示 ----

function showMessage(text, isError = false) {
  els.message.textContent = text;
  els.message.classList.toggle('is-error', isError);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function render() {
  const [y, m, d] = today.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  els.today.textContent = `${m}月${d}日(${weekday})`;

  els.empty.hidden = state.habits.length > 0;
  els.list.replaceChildren(...state.habits.map((habit) => renderHabit(habit, y, m)));
}

function renderHabit(habit, year, month) {
  const done = isDone(habit, today);
  const streak = currentStreak(habit, today);

  const check = el('button', {
    type: 'button',
    class: 'check',
    'data-id': habit.id,
    'aria-pressed': String(done),
    'aria-label': `${habit.name}を今日${done ? 'の記録から外す' : 'やったことにする'}`,
  }, [el('span', { class: 'check-mark', 'aria-hidden': 'true', text: '✓' }), el('span', { text: done ? 'できた' : '今日' })]);

  const head = el('div', { class: 'card-head' }, [
    el('div', { class: 'card-title' }, [
      el('h2', { class: 'habit-name', text: habit.name }),
      el('p', {
        class: streak > 0 ? 'streak is-active' : 'streak',
        text: streak > 0 ? `${streak}日連続` : '連続記録なし',
      }),
    ]),
    check,
  ]);

  return el('li', { class: done ? 'card is-done' : 'card' }, [head, renderMonth(habit, year, month)]);
}

function renderMonth(habit, year, month) {
  const cal = monthCalendar(habit, year, month, today);
  const grid = el('div', { class: 'cal', role: 'group', 'aria-label': `${month}月の記録` });

  for (const w of WEEKDAYS) grid.append(el('span', { class: 'cal-weekday', 'aria-hidden': 'true', text: w }));
  for (let i = 0; i < cal.leadingBlanks; i += 1) grid.append(el('span', { class: 'cal-blank', 'aria-hidden': 'true' }));
  for (const day of cal.days) {
    const classes = ['cal-day'];
    if (day.done) classes.push('is-done');
    if (day.isToday) classes.push('is-today');
    if (day.isFuture) classes.push('is-future');
    const status = day.isFuture ? '' : day.done ? '記録あり' : '記録なし';
    grid.append(el('span', { class: classes.join(' ') }, [
      el('span', { 'aria-hidden': 'true', text: String(day.day) }),
      el('span', { class: 'visually-hidden', text: `${month}月${day.day}日 ${status}` }),
    ]));
  }

  return el('div', { class: 'month' }, [
    el('p', { class: 'month-summary' }, [
      `${month}月の記録 `,
      el('strong', { text: String(cal.doneCount) }),
      ` / ${cal.elapsedDays}日`,
    ]),
    grid,
  ]);
}

// ---- 操作 ----

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  let next;
  try {
    next = addHabit(state, els.name.value, { id: newId(), today });
  } catch (err) {
    showMessage(err.message, true);
    els.name.focus();
    return;
  }
  if (commit(next)) {
    showMessage(`「${next.habits.at(-1).name}」を追加しました。`);
    els.name.value = '';
  }
});

els.list.addEventListener('click', (event) => {
  const button = event.target.closest('button.check');
  if (!button) return;
  const id = button.dataset.id;
  if (commit(toggleRecord(state, id, today))) {
    showMessage('');
    // 再描画でボタンが作り直されるので、フォーカスを戻す
    els.list.querySelector(`button.check[data-id="${CSS.escape(id)}"]`)?.focus();
  }
});

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// 日付が変わったら表示を更新する(開きっぱなしで日をまたいだとき用)
function refreshDate() {
  const now = toDateKey(new Date());
  if (now !== today) {
    today = now;
    render();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDate();
});
setInterval(refreshDate, 60 * 1000);

render();

// ---- オフライン対応とデータの保護 ----

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* 登録できない環境(file:// など)でも、アプリ自体は動かす */
  });
}
// ブラウザが容量不足のときに勝手にデータを消さないよう頼む(許可されないこともある)
navigator.storage?.persist?.().catch(() => {});
