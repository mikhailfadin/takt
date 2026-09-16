// ── Быстрые дела: всё из хранилища Obsidian, корзина на день, таймер 5/15 и серия.
// Заметки выгружает мост на маке (bd_notes), правки уходят очередью (bd_changes) и доезжают до Obsidian.

const Q = {
  notes: [], settings: null, loaded: false, loading: false, error: "", at: null,
  tab: "basket", q: "", open: {}, folds: {}, award: null, tick: null, poll: null,
};
const Q_ORDER = ["Быстрые", "Актуальное", "В работе", "Новые", "Не забыть", "Идеи", "Цели", "WIKI", "Контент", "Гипотезы", "Разобрать", "Когда-нибудь"];
const Q_RANKS = [[0, "Авральщик"], [10, "Догоняющий"], [30, "Успевающий"], [70, "На шаг впереди"], [150, "Разгребатель"]];
const Q_CHEERS = ["Разобрал всё, что взял", "Корзина пуста, и голова тоже", "Взял и сделал. Редкое дело", "Сегодня разгребли — завтра не копится"];

const qe = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const qDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const qYesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return qDay(d); };
const qDoneDay = n => n.updated_at ? qDay(new Date(n.updated_at)) : "";
const qPlural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const qStore = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const qRead = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

/* ---------- шаги в корзине: живут на устройстве до конца дня ---------- */
function qStepKeys() {
  const s = qRead("bd-steps-basket");
  return s && s.day === qDay() ? new Set(s.keys) : new Set();
}
function qSaveStepKeys(set) { qStore("bd-steps-basket", { day: qDay(), keys: [...set] }); }

/* ---------- облако ---------- */
async function qLoad(force) {
  if (typeof sb === "undefined" || !sb || !user) { Q.error = "login"; Q.loaded = true; return; }
  if (Q.loading || (Q.loaded && !force && Date.now() - Q.at < 20e3)) return;
  Q.loading = true;
  try {
    const [notes, set] = await Promise.all([
      sb.from("bd_notes").select("*").eq("deleted", false).order("updated_at", { ascending: false }),
      sb.from("bd_settings").select("*"),
    ]);
    if (notes.error) throw notes.error;
    const keys = qStepKeys();
    Q.notes = (notes.data || []).map(n => ({ ...n, steps: (n.steps || []).map((s, i) => ({ ...s, basket: keys.has(`${n.id}:${i}`) && !s.done })) }));
    Q.settings = (set.data && set.data[0]) || { streak: 0, streak_day: null };
    Q.error = ""; Q.at = Date.now();
  } catch (e) {
    console.warn("быстрые дела: загрузка", e);
    Q.error = navigator.onLine ? "cloud" : "offline";
  }
  Q.loading = false; Q.loaded = true;
  render();
}
function qChange(note, op, value) {
  if (!sb || !user) return;
  sb.from("bd_changes").insert({ user_id: user.id, note_id: note.id, op, value })
    .then(({ error }) => { if (error) toast("Не ушло в Obsidian — проверь связь"); });
}

/* ---------- выборки ---------- */
function qBasket() {
  const out = [];
  Q.notes.forEach(n => {
    if (n.status === "сделано") return;
    const steps = (n.steps || []).map((s, i) => ({ ...s, i })).filter(s => s.basket && !s.done);
    if (steps.length) steps.forEach(s => out.push({ key: `${n.id}:${s.i}`, note: n, step: s }));
    else if (n.basket) out.push({ key: n.id, note: n, step: null });
  });
  return out;
}
const quickCount = () => Q.loaded ? qBasket().length : "";
const qGroup = n => {
  if (n.kind === "не забыть") return "Не забыть";
  if (n.quick) return "Быстрые";
  if (["актуальное", "в работе", "когда-нибудь"].includes(n.status)) return n.status[0].toUpperCase() + n.status.slice(1);
  return { "идея": "Идеи", "цель": "Цели", "материал": "WIKI", "контент": "Контент", "гипотеза": "Гипотезы", "разобрать": "Разобрать" }[n.kind] || "Новые";
};
const qFind = key => {
  const [id, i] = String(key).split(":");
  const note = Q.notes.find(n => n.id === id);
  if (!note) return null;
  return { key, note, step: i === undefined ? null : { ...note.steps[+i], i: +i } };
};
function qStreak() {
  const s = Q.settings || {};
  const alive = s.streak_day === qDay() || s.streak_day === qYesterday();
  return { n: alive ? (s.streak || 0) : 0, today: s.streak_day === qDay() };
}
function qRank() {
  const total = Q.notes.filter(n => n.status === "сделано").length + Q.notes.reduce((a, n) => a + (n.starts || 0), 0) + ((Q.settings || {}).total_done || 0);
  let cur = Q_RANKS[0], next = null;
  Q_RANKS.forEach((r, i) => { if (total >= r[0]) { cur = r; next = Q_RANKS[i + 1] || null; } });
  return { total, cur, next };
}

/* ---------- действия ---------- */
function qToggleBasket(note) {
  note.basket = !note.basket; note.basket_day = qDay();
  qChange(note, "basket", { basket: note.basket });
  render(); toast(note.basket ? `В корзине: ${note.title}` : `Убрано из корзины`);
}
function qToggleStep(note, i) {
  const s = note.steps[i]; if (!s || s.done) return;
  s.basket = !s.basket;
  const keys = qStepKeys(); s.basket ? keys.add(`${note.id}:${i}`) : keys.delete(`${note.id}:${i}`); qSaveStepKeys(keys);
  render(); toast(s.basket ? "Шаг в корзине" : "Шаг убран");
}
function qMinutes(entry) {
  const m = entry.note.minutes === 15 ? 5 : 15;
  entry.note.minutes = m; qChange(entry.note, "minutes", { minutes: m }); render();
}
async function qCredit(note) {
  note.starts = (note.starts || 0) + 1;
  qChange(note, "start", { starts: note.starts });
  const s = Q.settings || (Q.settings = {});
  if (s.streak_day === qDay()) return;
  s.streak = (s.streak_day === qYesterday() ? (s.streak || 0) : 0) + 1;
  s.streak_day = qDay();
  const { error } = await sb.from("bd_settings").upsert({ user_id: user.id, streak: s.streak, streak_day: s.streak_day });
  if (error) console.warn("быстрые дела: серия", error);
}
function qFinish(entry, { credit = true } = {}) {
  const { note, step } = entry;
  let line;
  if (step) {
    const real = note.steps[step.i];
    real.done = true; real.basket = false;
    const keys = qStepKeys(); keys.delete(entry.key); qSaveStepKeys(keys);
    qChange(note, "step", { index: step.i, done: true });
    const left = note.steps.filter(s => !s.done).length;
    if (!left) { note.status = "сделано"; note.updated_at = new Date().toISOString(); qChange(note, "status", { status: "сделано" }); }
    line = left ? `Шаг закрыт — осталось ${left} из ${note.steps.length}. Чекбокс отмечен в заметке` : `Задача «${note.title}» закрыта целиком`;
  } else {
    note.status = "сделано"; note.basket = false; note.updated_at = new Date().toISOString();
    qChange(note, "status", { status: "сделано" });
    line = "В заметке теперь «сделано»";
  }
  if (credit) qCredit(note).then(() => render());
  return line;
}

/* ---------- таймер: считает от времени окончания, переживает перезагрузку ---------- */
const qTimer = () => qRead("bd-timer");
function qStart(entry) {
  const min = entry.note.minutes === 15 ? 15 : 5;
  qStore("bd-timer", { key: entry.key, end: Date.now() + min * 60e3, full: min * 60, title: entry.step ? entry.step.t : entry.note.title, parent: entry.step ? entry.note.title : "", rang: false });
  Q.award = null;
  try { if (window.Notification && Notification.permission === "default") Notification.requestPermission(); } catch {}
  render();
}
function qBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(.25, ctx.currentTime + t + .02);
      g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + t + .25);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .3);
    });
  } catch {}
}
function qTick() {
  const t = qTimer();
  if (!t) { clearInterval(Q.tick); Q.tick = null; document.title = "Быстродел"; return; }
  const left = Math.max(0, Math.round((t.end - Date.now()) / 1000));
  const txt = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  const clock = document.getElementById("qClock");
  if (clock) {
    clock.textContent = txt;
    document.getElementById("qArc").setAttribute("stroke-dashoffset", (339.29 * (1 - left / t.full)).toFixed(2));
    document.querySelector(".q-focus")?.classList.toggle("up", left === 0);
    const sub = document.getElementById("qClockSub"); if (sub) sub.textContent = left ? "осталось" : "время вышло";
    const more = document.getElementById("qMore"); if (more) more.hidden = left > 0;
  }
  document.title = left ? `${txt} · ${t.title}` : "Время вышло · Быстродел";
  if (!left && !t.rang) {
    t.rang = true; qStore("bd-timer", t); qBeep();
    try { if (window.Notification && Notification.permission === "granted") new Notification("Время вышло", { body: `${t.title}\nСделал? Ещё подход? Хватит?` }); } catch {}
    if (view.mode !== "quick") toast(`Время вышло: ${t.title}`);
  }
}
function qEnsureTick() { if (qTimer() && !Q.tick) { Q.tick = setInterval(qTick, 1000); qTick(); } }

/* ---------- отрисовка ---------- */
const QI = {
  check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>',
  play: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>',
  chev: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 5.5 3 3 3-3"/></svg>',
  out: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3H3v8h8V8.5M8 2h4v4M12 2 6.5 7.5"/></svg>',
  bolt: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M9.2 1 3 9h4.3l-.8 6L13 7H8.6z" fill="currentColor"/></svg>',
};

const qObsidian = n => `obsidian://open?vault=Obsidian&file=${encodeURIComponent(String(n.path || "").replace(/\.md$/, ""))}`;
function qDetail(n) {
  const steps = n.steps || [];
  const text = (n.excerpt || "").trim();
  const long = text.length >= 1490;
  return `<div class="q-detail">
    ${text ? `<div class="q-text">${qe(text)}${long ? "…" : ""}</div>` : `<div class="q-text empty-t">В заметке нет текста — только название.</div>`}
    ${steps.length ? `<div class="q-steps">${steps.map((s, i) => `
      <button class="q-step${s.done ? " done" : ""}${s.basket ? " on" : ""}" data-q-step="${n.id}:${i}" ${s.done ? "disabled" : ""}>
        <span class="q-box">${s.done ? QI.check : s.basket ? QI.bolt : ""}</span><span>${qe(s.t)}</span>
      </button>`).join("")}<div class="q-hint">Нажми на шаг — он уйдёт в корзину на сегодня</div></div>` : ""}
    <div class="q-detail-acts">
      <a class="q-link" href="${qObsidian(n)}">Открыть в Obsidian ${QI.out}</a>
      <span class="q-path">${qe(n.folder || "")}</span>
    </div>
  </div>`;
}
function qItemBasket(e) {
  const min = e.note.minutes === 15 ? 15 : 5;
  const open = Q.open["b:" + e.key];
  const meta = e.step ? `${qe(e.note.title)} · шаг ${e.step.i + 1} из ${e.note.steps.length}` : `${qe(qGroup(e.note))}${e.note.source ? " · " + qe(e.note.source) : ""}`;
  return `<div class="q-item${e.note.kind === "не забыть" ? " alarm" : ""}${open ? " open" : ""}">
    <button class="q-min" data-q-min="${e.key}" title="Оценка: нажми, чтобы сменить 5 ↔ 15">${min}<small>мин</small></button>
    <button class="q-t q-t-btn" data-q-open="b:${e.key}" title="Что за дело"><b>${qe(e.step ? e.step.t : e.note.title)}</b><span>${meta}</span></button>
    <div class="q-acts">
      <button class="q-ic" data-q-done="${e.key}" title="Уже сделал — без таймера">${QI.check}</button>
      <button class="q-ic" data-q-drop="${e.key}" title="Убрать из корзины">${QI.x}</button>
      <button class="q-go" data-q-start="${e.key}">${QI.play}<span>Поехали</span></button>
    </div>
    ${open ? qDetail(e.note) : ""}
  </div>`;
}
function qItemPlain(n, { cls = "", meta = "" } = {}) {
  const steps = n.steps || [];
  const inB = steps.length ? steps.some(s => s.basket && !s.done) : n.basket;
  const open = Q.open[n.id];
  const pick = steps.length
    ? `<span class="q-pick static">${steps.filter(s => s.basket && !s.done).length ? "шаг в корзине" : "шаги"}</span>`
    : `<button class="q-pick" data-q-toggle="${n.id}">${inB ? "в корзине" : "в корзину"}</button>`;
  return `<div class="q-row${inB ? " picked" : ""}${open ? " open" : ""}${cls ? " " + cls : ""}">
    <button class="q-row-main" data-q-open="${n.id}">
      <span class="q-t"><b>${qe(n.title)}</b><span>${meta}</span></span>
      <span class="q-chev${open ? " open" : ""}">${QI.chev}</span>
    </button>
    <div class="q-row-side">${pick}${n.kind === "не забыть" && n.status !== "сделано" ? `<button class="q-ic" data-q-done="${n.id}" title="Сделал">${QI.check}</button>` : ""}</div>
    ${open ? qDetail(n) : ""}
  </div>`;
}
function qFocusHTML(t) {
  return `<div class="q-focus">
    <div class="q-focus-top">${t.parent ? `<span>${qe(t.parent)}</span>` : "<span>быстрое дело</span>"}<b>${qe(t.title)}</b>${(() => { const en = qFind(t.key); const x = en && (en.note.excerpt || "").trim(); return x ? `<details class="q-focus-text"${Q.focusText ? " open" : ""}><summary>Что за дело</summary><div class="q-text">${qe(x)}</div><a class="q-link" href="${qObsidian(en.note)}">Открыть в Obsidian ${QI.out}</a></details>` : ""; })()}</div>
    <div class="q-ring">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" class="bg"/><circle id="qArc" cx="60" cy="60" r="54" class="fg" stroke-dasharray="339.29" stroke-dashoffset="0"/></svg>
      <div><b id="qClock">--:--</b><span id="qClockSub">осталось</span></div>
    </div>
    <div class="q-focus-acts">
      <button class="q-big" data-q-timer="done">${QI.check}<span>Сделал</span></button>
      <button class="q-soft" id="qMore" data-q-timer="more" hidden>Ещё 15 минут</button>
      <button class="q-soft" data-q-timer="stop">Хватит на сегодня</button>
    </div>
    <p class="q-note">Подход засчитается в серию, даже если дело не закончено</p>
  </div>`;
}
function qAwardHTML(a) {
  const next = qBasket().length;
  return `<div class="q-award">
    <div class="q-award-n">${a.streak}</div>
    <div class="q-award-l">${qPlural(a.streak, "день", "дня", "дней")} подряд</div>
    <b>${qe(a.title)}</b>
    <p>${qe(a.line)}</p>
    <div class="q-focus-acts">
      ${next ? `<button class="q-big" data-q-next>${QI.play}<span>Следующее дело</span></button>` : ""}
      <button class="q-soft" data-q-home>${next ? "К корзине" : "Готово"}</button>
    </div>
  </div>`;
}
function qBody() {
  if (!Q.loaded || (Q.loading && !Q.notes.length)) return '<div class="empty">Загружаю дела из хранилища…</div>';
  if (Q.error === "login") return '<div class="q-state"><b>Нужен вход</b><p>Дела из хранилища лежат в облаке — войди в аккаунт (значок человечка справа сверху).</p></div>';
  if (Q.error && !Q.notes.length) return `<div class="q-state"><b>${Q.error === "offline" ? "Нет интернета" : "Облако не ответило"}</b><p>Попробую снова через минуту.</p><button class="q-soft" data-q-reload>Повторить сейчас</button></div>`;
  const t = qTimer();
  if (t) return qFocusHTML(t);
  if (Q.award) return qAwardHTML(Q.award);

  const basket = qBasket();
  if (Q.tab === "basket") {
    if (basket.length) {
      const min = basket.reduce((a, e) => a + (e.note.minutes === 15 ? 15 : 5), 0);
      return `<div class="q-sum"><span>${basket.length} ${qPlural(basket.length, "дело", "дела", "дел")} · около ${min} мин</span><span class="q-sum-hint">Оценку ставишь ты: нажми на минуты</span></div>
        <div class="list">${basket.map(qItemBasket).join("")}</div>`;
    }
    const doneToday = Q.notes.filter(n => n.status === "сделано" && qDoneDay(n) === qDay()).length;
    if (doneToday) return `<div class="q-state cleared"><div class="q-cheer">${Q_CHEERS[doneToday % Q_CHEERS.length]}</div>
      <p>Сегодня закрыто ${doneToday} ${qPlural(doneToday, "дело", "дела", "дел")} · серия ${qStreak().n} ${qPlural(qStreak().n, "день", "дня", "дней")}</p>
      <div class="q-focus-acts"><button class="q-soft" data-q-tab="all">Взять ещё из «Всё»</button></div></div>`;
    return `<div class="q-state"><b>Корзина пустая</b><p>Набери дела на сегодня: из «Всё из хранилища» или попроси подобрать быстрые.</p>
      <div class="q-focus-acts"><button class="q-big" data-q-suggest>${QI.bolt}<span>Подобрать быстрые</span></button><button class="q-soft" data-q-tab="all">Открыть «Всё»</button></div></div>`;
  }
  if (Q.tab === "remember") {
    const list = Q.notes.filter(n => n.kind === "не забыть" && n.status !== "сделано");
    return `<div class="list">${list.map(n => qItemPlain(n, { cls: "alarm", meta: qe(n.source || "") })).join("") || '<div class="empty">Ничего не висит — всё, что было «не забыть», закрыто.</div>'}</div>`;
  }
  if (Q.tab === "done") {
    const all = Q.notes.filter(n => n.status === "сделано").sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    const day = all.filter(n => qDoneDay(n) === qDay());
    const item = n => `<div class="q-done"><span class="q-tick">${QI.check}</span><span class="q-t"><b>${qe(n.title)}</b><span>${qDoneDay(n)}</span></span></div>`;
    const block = (k, label, arr, def) => {
      const shown = Q.folds[k] ?? def;
      return `<button class="q-fold" data-q-fold="${k}" aria-expanded="${shown}"><span>${label}</span><span class="n">${arr.length}</span><span class="q-chev${shown ? " open" : ""}">${QI.chev}</span></button>
        ${shown ? `<div class="list">${arr.map(item).join("") || '<div class="empty">Пока пусто</div>'}</div>` : ""}`;
    };
    return block("today", "Сегодня", day, true) + block("all", "Всё сделанное", all, false);
  }
  const q = Q.q.trim().toLowerCase();
  const live = Q.notes.filter(n => n.status !== "сделано" && (!q || (n.title || "").toLowerCase().includes(q) || (n.excerpt || "").toLowerCase().includes(q)));
  const groups = Q_ORDER.map(g => {
    const list = live.filter(n => qGroup(n) === g);
    if (!list.length) return "";
    const shown = Q.folds["g:" + g] ?? true;
    const cls = g === "Идеи" ? "idea" : g === "Не забыть" ? "alarm" : "grey";
    return `<button class="q-fold ${cls}" data-q-fold="g:${g}" aria-expanded="${shown}"><span>${g}</span><span class="n">${list.length}</span><span class="q-chev${shown ? " open" : ""}">${QI.chev}</span></button>
      ${shown ? `<div class="list">${list.map(n => {
        const steps = n.steps || [];
        const meta = steps.length ? `${steps.filter(s => s.done).length} из ${steps.length} шагов${n.starts ? ` · ${n.starts} ${qPlural(n.starts, "подход", "подхода", "подходов")}` : ""}` : `${qe(n.source || "")}${n.minutes ? ` · ${n.minutes} мин` : ""}`;
        return qItemPlain(n, { cls, meta });
      }).join("")}</div>` : ""}`;
  }).join("");
  return `<div class="q-search"><input id="qSearch" placeholder="Найти в хранилище" autocomplete="off" value="${qe(Q.q)}"></div>${groups || '<div class="empty">Ничего не нашлось</div>'}`;
}
function qSide() {
  const { n, today } = qStreak();
  const cells = [...Array(14)].map((_, i) => {
    const isToday = i === 13;
    const on = isToday ? today : i >= 13 - (today ? n - 1 : n) && i < 13;
    return `<i class="${on ? "on" : ""}${isToday ? " today" : ""}"></i>`;
  }).join("");
  const r = qRank();
  const pct = r.next ? Math.round(100 * (r.total - r.cur[0]) / (r.next[0] - r.cur[0])) : 100;
  const basket = qBasket();
  return `<div class="q-card q-streak">
      <div class="q-big-n"><b>${n}</b><span>${qPlural(n, "день", "дня", "дней")} подряд</span></div>
      <div class="q-chain" title="Клетка — день. Закрашена, если в этот день был хоть один подход">${cells}</div>
      <div class="q-chain-l"><span>2 недели назад</span><span>${today ? "сегодня есть" : "сегодня — ещё нет"}</span></div>
    </div>
    <div class="q-card q-rank">
      <div class="q-rank-h"><span>Звание</span><b>${r.cur[1]}</b></div>
      <div class="q-rank-bar"><i style="width:${pct}%"></i></div>
      <div class="q-rank-l"><span>${r.cur[1]}</span><span>${r.next ? `${r.next[1]} · ещё ${r.next[0] - r.total}` : "высшее звание"}</span></div>
    </div>
    ${qTimer() ? "" : `<div class="q-card q-mini">
      <button class="q-soft wide" data-q-suggest>${QI.bolt}<span>Подобрать быстрые</span></button>
      <div class="q-mini-l">${basket.length ? `В корзине ${basket.length} · до ночи` : "Корзина обнуляется ночью"}</div>
    </div>`}`;
}
function renderQuick() {
  if ((!Q.loaded || (Q.error === "login" && typeof user !== "undefined" && user)) && !Q.loading) qLoad(true);
  if (!Q.poll) Q.poll = setInterval(() => { if (view.mode === "quick" && !document.hidden) qLoad(true); }, 60e3);
  qEnsureTick();

  $("h1Plain").hidden = false; $("h1Plain").textContent = "Быстрые дела";
  $("h1Lead").hidden = true; $("period").hidden = true; $("steps").hidden = true;
  $("barFill").parentElement.hidden = true; $("pct").hidden = true;
  const live = Q.notes.filter(n => n.status !== "сделано").length;
  $("dateLine").textContent = Q.loaded && !Q.error ? `Всё из хранилища · ${live} ${qPlural(live, "заметка", "заметки", "заметок")} в работе` : "Всё из хранилища";
  $("prog").textContent = "";
  $("board").classList.remove("week-mode");
  $("aim").hidden = false; $("aimInline").hidden = true; $("collapse").hidden = true;
  document.querySelector(".main").classList.remove("bucket-view");
  $("carryBtn").hidden = true;
  sideCal._show(TODAY);

  const focused = document.activeElement?.id === "qSearch";
  const caret = focused ? document.activeElement.selectionStart : 0;
  const t = qTimer(), basket = Q.loaded ? qBasket() : [];
  const counts = {
    basket: basket.length,
    remember: Q.notes.filter(n => n.kind === "не забыть" && n.status !== "сделано").length,
    done: Q.notes.filter(n => n.status === "сделано" && qDoneDay(n) === qDay()).length,
    all: Q.notes.filter(n => n.status !== "сделано").length,
  };
  const tabs = [["basket", "Корзина"], ["remember", "Не забыть"], ["done", "Сделано"], ["all", "Всё из хранилища"]];
  $("board").innerHTML = `<div class="q">
    <div class="q-main">
      ${t || Q.award ? "" : `<div class="q-tabs">${tabs.map(([k, l]) => `<button class="${Q.tab === k ? "on" : ""}${k === "remember" ? " alarm" : ""}" data-q-tab="${k}"><span>${l}</span>${counts[k] ? `<span class="n">${counts[k]}</span>` : ""}</button>`).join("")}</div>`}
      <div class="q-body">${qBody()}</div>
    </div>
    <aside class="q-side">${Q.loaded && !Q.error ? qSide() : ""}</aside>
  </div>`;
  if (focused) { const s = $("qSearch"); s.focus(); s.setSelectionRange(caret, caret); }
  qTick();
}

/* ---------- клики ---------- */
$("board").addEventListener("click", e => {
  if (view.mode !== "quick") return;
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.qTab) { Q.tab = d.qTab; Q.award = null; return render(); }
  if (d.qReload !== undefined) { Q.error = ""; return qLoad(true); }
  if (d.qFold) { Q.folds[d.qFold] = !(Q.folds[d.qFold] ?? (d.qFold !== "all")); return render(); }
  if (d.qOpen) { Q.open[d.qOpen] = !Q.open[d.qOpen]; return render(); }
  if (d.qToggle) { const n = Q.notes.find(x => x.id === d.qToggle); return n && qToggleBasket(n); }
  if (d.qStep) { const [id, i] = d.qStep.split(":"); const n = Q.notes.find(x => x.id === id); return n && qToggleStep(n, +i); }
  if (d.qMin) { const en = qFind(d.qMin); return en && qMinutes(en); }
  if (d.qStart) { const en = qFind(d.qStart); return en && qStart(en); }
  if (d.qDrop) {
    const en = qFind(d.qDrop); if (!en) return;
    return en.step ? qToggleStep(en.note, en.step.i) : qToggleBasket(en.note);
  }
  if (d.qDone) {
    const en = qFind(d.qDone); if (!en) return;
    const line = qFinish(en, { credit: false });
    render(); return toast(line);
  }
  if (d.qSuggest !== undefined) {
    const pick = Q.notes.filter(n => n.quick && n.status !== "сделано" && !n.basket && !(n.steps || []).length).slice(0, 3);
    pick.forEach(n => { n.basket = true; n.basket_day = qDay(); qChange(n, "basket", { basket: true }); });
    Q.tab = "basket"; render();
    return toast(pick.length ? `В корзину ${pick.length} ${qPlural(pick.length, "быстрое дело", "быстрых дела", "быстрых дел")}` : "Быстрых дел нет — загляни во «Всё»");
  }
  if (d.qTimer) {
    const t = qTimer(); if (!t) return render();
    const en = qFind(t.key);
    if (d.qTimer === "more") {
      qStore("bd-timer", { ...t, end: Date.now() + 15 * 60e3, full: 15 * 60, rang: false });
      if (en) qCredit(en.note);
      render(); return toast("Второй подход пошёл");
    }
    qStore("bd-timer"); clearInterval(Q.tick); Q.tick = null; document.title = "Быстродел";
    if (!en) return render();
    if (d.qTimer === "stop") {
      qCredit(en.note).then(render);
      render(); return toast(`Подход засчитан: ${t.title}`);
    }
    const line = qFinish(en);
    const s = qStreak();
    Q.award = { title: t.title, line, streak: Math.max(s.n, s.today ? s.n : s.n + 1) };
    return render();
  }
  if (d.qNext !== undefined) { Q.award = null; const list = qBasket(); return list.length ? qStart(list[0]) : render(); }
  if (d.qHome !== undefined) { Q.award = null; Q.tab = "basket"; return render(); }
});
$("board").addEventListener("toggle", e => { if (e.target.classList?.contains("q-focus-text")) Q.focusText = e.target.open; }, true);
$("board").addEventListener("input", e => {
  if (e.target.id !== "qSearch") return;
  Q.q = e.target.value; render();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) { qTick(); if (view.mode === "quick") qLoad(); } });
qEnsureTick();
