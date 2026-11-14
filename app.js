// 画面の表示と操作。データの扱いは habits.js に任せる。
import {
  createEmptyState,
  addHabit,
  removeHabit,
  toggleRecord,
  isDone,
  currentStreak,
  addMonths,
  monthCalendar,
  parseState,
  serializeState,
  createExportText,
  exportFileName,
  summarizeState,
  toDateKey,
} from './habits.js';

const STORAGE_KEY = 'habit-tracker:v1';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const els = {
  today: document.getElementById('today'),
  form: document.getElementById('add-form'),
  name: document.getElementById('habit-name'),
  message: document.getElementById('message'),
  monthNav: document.getElementById('month-nav'),
  monthLabel: document.getElementById('month-label'),
  prevMonth: document.getElementById('prev-month'),
  nextMonth: document.getElementById('next-month'),
  empty: document.getElementById('empty'),
  list: document.getElementById('habit-list'),
  exportButton: document.getElementById('export-button'),
  importButton: document.getElementById('import-button'),
  importFile: document.getElementById('import-file'),
};

let today = toDateKey(new Date());
let view = currentMonth(); // カレンダーに表示している年月
let state = loadState();

function currentMonth() {
  const [year, month] = today.split('-').map(Number);
  return { year, month };
}

function isCurrentMonth() {
  const now = currentMonth();
  return view.year === now.year && view.month === now.month;
}

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

function formatDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${m}月${d}日(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

function render() {
  els.today.textContent = formatDate(today);

  const hasHabits = state.habits.length > 0;
  els.empty.hidden = hasHabits;
  els.monthNav.hidden = !hasHabits;
  els.monthLabel.textContent = view.year === currentMonth().year
    ? `${view.month}月`
    : `${view.year}年${view.month}月`;
  els.nextMonth.disabled = isCurrentMonth();

  els.list.replaceChildren(...state.habits.map(renderHabit));
}

function renderHabit(habit) {
  const done = isDone(habit, today);
  const streak = currentStreak(habit, today);

  const check = el('button', {
    type: 'button',
    class: 'check',
    'data-action': 'toggle',
    'data-id': habit.id,
    'data-date': today,
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

  const remove = el('button', {
    type: 'button',
    class: 'remove',
    'data-action': 'remove',
    'data-id': habit.id,
    'aria-label': `${habit.name}を削除`,
    text: '削除',
  });

  return el('li', { class: done ? 'card is-done' : 'card' }, [head, renderMonth(habit), remove]);
}

function renderMonth(habit) {
  const { year, month } = view;
  const cal = monthCalendar(habit, year, month, today);
  const grid = el('div', { class: 'cal', role: 'group', 'aria-label': `${habit.name}の${month}月の記録` });

  for (const w of WEEKDAYS) grid.append(el('span', { class: 'cal-weekday', 'aria-hidden': 'true', text: w }));
  for (let i = 0; i < cal.leadingBlanks; i += 1) grid.append(el('span', { class: 'cal-blank', 'aria-hidden': 'true' }));
  for (const day of cal.days) {
    const classes = ['cal-day'];
    if (day.done) classes.push('is-done');
    if (day.isToday) classes.push('is-today');
    if (day.isFuture) {
      // まだ来ていない日は押せない
      classes.push('is-future');
      grid.append(el('span', { class: classes.join(' '), 'aria-hidden': 'true', text: String(day.day) }));
      continue;
    }
    grid.append(el('button', {
      type: 'button',
      class: classes.join(' '),
      'data-action': 'toggle',
      'data-id': habit.id,
      'data-date': day.date,
      'aria-pressed': String(day.done),
      'aria-label': `${month}月${day.day}日`,
      text: String(day.day),
    }));
  }

  return el('div', { class: 'month' }, [
    el('p', { class: 'month-summary' }, [
      `${month}月の記録 `,
      el('strong', { text: String(cal.doneCount) }),
      ` / ${cal.elapsedDays}日`,
      el('span', { class: 'month-hint', text: '日付を押すと記録を付け外しできます' }),
    ]),
    grid,
  ]);
}

/** 再描画でボタンが作り直されるので、押したボタンにフォーカスを戻す。 */
function restoreFocus(selector) {
  els.list.querySelector(selector)?.focus();
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
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id, date } = button.dataset;
  const habit = state.habits.find((h) => h.id === id);
  if (!habit) return;

  if (action === 'toggle') {
    let next;
    try {
      next = toggleRecord(state, id, date, { today });
    } catch (err) {
      showMessage(err.message, true);
      return;
    }
    if (commit(next)) {
      showMessage(date === today ? '' : `${formatDate(date)}を${isDone(habit, date) ? '未記録に戻しました' : '記録しました'}。`);
      const sameKind = button.classList.contains('check') ? '.check' : '.cal-day';
      restoreFocus(`button${sameKind}[data-id="${CSS.escape(id)}"][data-date="${date}"]`);
    }
    return;
  }

  if (action === 'remove') {
    const count = habit.records.length;
    const ok = window.confirm(
      `「${habit.name}」を削除しますか?\nこれまでの記録(${count}日分)も消え、元に戻せません。`,
    );
    if (ok && commit(removeHabit(state, id))) {
      showMessage(`「${habit.name}」を削除しました。`);
      els.name.focus();
    }
  }
});

els.prevMonth.addEventListener('click', () => {
  view = addMonths(view.year, view.month, -1);
  render();
});

els.nextMonth.addEventListener('click', () => {
  if (isCurrentMonth()) return;
  view = addMonths(view.year, view.month, 1);
  render();
  if (isCurrentMonth()) els.prevMonth.focus(); // 押したボタンが押せなくなるので移す
});

// ---- 書き出しと読み込み ----

els.exportButton.addEventListener('click', () => {
  if (state.habits.length === 0) {
    showMessage('書き出す習慣がまだありません。', true);
    return;
  }
  const blob = new Blob([createExportText(state, new Date())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: exportFileName(today) });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  const { habitCount, recordCount } = summarizeState(state);
  showMessage(`習慣${habitCount}件・記録${recordCount}日分を「${exportFileName(today)}」に書き出しました。`);
});

els.importButton.addEventListener('click', () => {
  els.importFile.value = ''; // 同じファイルを続けて選んでも change が起きるように
  els.importFile.click();
});

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files?.[0];
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showMessage('ファイルが大きすぎます。このアプリで書き出したファイルを選んでください。', true);
    return;
  }

  let imported;
  try {
    imported = parseState(await file.text());
  } catch (err) {
    showMessage(`読み込めませんでした: ${err.message}`, true);
    return;
  }

  const incoming = summarizeState(imported);
  const current = summarizeState(state);
  const lines = [`「${file.name}」を読み込みます。`, `ファイルの中身: 習慣${incoming.habitCount}件・記録${incoming.recordCount}日分`];
  if (current.habitCount > 0) {
    lines.push(
      '',
      `今のデータ(習慣${current.habitCount}件・記録${current.recordCount}日分)はすべて置き換わり、元に戻せません。`,
      '必要なら、先に「書き出す」で控えを取ってください。',
    );
  }
  if (!window.confirm(lines.join('\n'))) return;

  if (commit(imported)) {
    showMessage(`習慣${incoming.habitCount}件・記録${incoming.recordCount}日分を読み込みました。`);
  }
});

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// 日付が変わったら表示を更新する(開きっぱなしで日をまたいだとき用)
function refreshDate() {
  const now = toDateKey(new Date());
  if (now === today) return;
  const wasCurrent = isCurrentMonth();
  today = now;
  if (wasCurrent) view = currentMonth(); // 今月を見ていたら新しい月についていく
  render();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDate();
});
setInterval(refreshDate, 60 * 1000);

render();

// ---- オフライン対応とデータの保護 ----

if ('serviceWorker' in navigator) {
  // updateViaCache: 'none' … sw.js 自体の更新確認でブラウザの HTTP キャッシュを使わない
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
    // ホーム画面のアプリは開きっぱなしになりやすいので、前面に戻ったときにも sw.js の更新を確かめる
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  }).catch(() => {
    /* 登録できない環境(file:// など)でも、アプリ自体は動かす */
  });
}
// ブラウザが容量不足のときに勝手にデータを消さないよう頼む(許可されないこともある)
navigator.storage?.persist?.().catch(() => {});
