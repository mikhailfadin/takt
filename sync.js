// ── Такт: облако — вход по почте и паролю, синхронизация задач, работа без сети.
// Приложение хранит задачи у себя (localStorage) и работает без интернета.
// Каждое сохранение сверяется с тем, что уже ушло в облако; изменённое и удалённое догоняет базу.
// С базы приходят изменения других устройств; при споре побеждает более поздняя правка.

const SUPA_URL = "https://yqumtlykftuxswbhnfru.supabase.co";
const SUPA_KEY = "sb_publishable_swH79jNgc-iQc04BGmSldw_3n9na-Uy";
const SYNC_LS = "takt-sync-v1";

let sb = null, user = null, pushing = false, pulling = false, pushTimer = null;
let syncState = loadSync();          // { lastPull, sent: {id: подпись}, dead: {id: время удаления} }
let localSig = {};                   // подписи задач на момент последнего сохранения

function loadSync() {
  try { return Object.assign({ lastPull: null, sent: {}, dead: {} }, JSON.parse(localStorage.getItem(SYNC_LS))); }
  catch { return { lastPull: null, sent: {}, dead: {} }; }
}
function saveSync() { try { localStorage.setItem(SYNC_LS, JSON.stringify(syncState)); } catch {} }
const syncStatus = s => window.onSyncStatus?.(s);

const FIELDS = ["title", "date", "time", "prio", "done", "doneAt", "pos", "carry"];
const sig = t => JSON.stringify(FIELDS.map(f => t[f] ?? null));
const nowIso = () => new Date().toISOString();

const toRow = t => ({
  id: t.id, user_id: user.id, title: t.title, date: t.date, time: t.time || "",
  prio: !!t.prio, done: !!t.done, done_at: t.doneAt || null, pos: t.pos | 0, carry: t.carry | 0,
  deleted: false, updated_at: t.updatedAt || nowIso(),
});
const fromRow = r => ({
  id: r.id, title: r.title, date: r.date, time: r.time || "", prio: r.prio, done: r.done,
  doneAt: r.done_at, pos: r.pos, carry: r.carry, updatedAt: r.updated_at,
});

// вызывается приложением после каждого save()
function onTasksSaved() {
  const t0 = nowIso(), ids = new Set();
  for (const t of tasks) {
    ids.add(t.id);
    const s = sig(t);
    if (t.sample && localSig[t.id] !== undefined && localSig[t.id] !== s) delete t.sample; // пример поправили — теперь это задача
    if (localSig[t.id] !== s) { if (localSig[t.id] !== undefined || !t.updatedAt) t.updatedAt = t0; localSig[t.id] = s; }
  }
  for (const id of Object.keys(localSig)) {
    if (!ids.has(id)) { delete localSig[id]; if (syncState.sent[id] !== undefined) syncState.dead[id] = t0; }
  }
  saveSync();
  schedulePush();
}

function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(pushPending, 400); }

async function pushPending() {
  if (!sb || !user || pushing || !navigator.onLine) { if (sb && user && !navigator.onLine) syncStatus("offline"); return; }
  const changed = tasks.filter(t => !t.sample && syncState.sent[t.id] !== sig(t));
  const dead = Object.entries(syncState.dead);
  if (!changed.length && !dead.length) { syncStatus("ok"); return; }
  pushing = true; syncStatus("syncing");
  try {
    const rows = changed.map(toRow).concat(dead.map(([id, at]) => ({ id, user_id: user.id, title: "", date: "inbox", deleted: true, updated_at: at })));
    const sigs = new Map(changed.map(t => [t.id, sig(t)]));
    const { error } = await sb.from("tasks").upsert(rows, { onConflict: "id" });
    if (error) throw error;
    for (const [id, s] of sigs) syncState.sent[id] = s;
    for (const [id] of dead) { delete syncState.dead[id]; delete syncState.sent[id]; }
    saveSync(); syncStatus("ok");
  } catch (e) { console.warn("синхронизация: отправка", e); syncStatus("error"); }
  pushing = false;
  if (tasks.some(t => !t.sample && syncState.sent[t.id] !== sig(t))) schedulePush();
}

async function pullChanges() {
  if (!sb || !user || pulling || !navigator.onLine) return;
  pulling = true;
  try {
    let q = sb.from("tasks").select("*").order("updated_at", { ascending: true }).limit(1000);
    if (syncState.lastPull) q = q.gt("updated_at", new Date(Date.parse(syncState.lastPull) - 5 * 60e3).toISOString());
    const { data, error } = await q;
    if (error) throw error;
    let touched = false;
    for (const r of data) {
      const i = tasks.findIndex(t => t.id === r.id), local = tasks[i];
      const pending = local && syncState.sent[local.id] !== sig(local);
      const newer = !local || !pending || Date.parse(r.updated_at) >= Date.parse(local.updatedAt || 0);
      if (r.deleted) {
        if (local && newer) { tasks.splice(i, 1); delete localSig[r.id]; touched = true; }
        delete syncState.sent[r.id]; delete syncState.dead[r.id];
      } else if (!syncState.dead[r.id] && newer) {
        const t = fromRow(r);
        if (local) Object.assign(local, t); else tasks.push(t);
        syncState.sent[r.id] = localSig[r.id] = sig(t);
        touched = true;
      }
      if (!syncState.lastPull || r.updated_at > syncState.lastPull) syncState.lastPull = r.updated_at;
    }
    saveSync();
    if (touched) { save(); render(); }
  } catch (e) { console.warn("синхронизация: загрузка", e); syncStatus("error"); }
  pulling = false;
}

// первый вход на устройстве: примеры убираем, своё отправляем, облачное забираем
async function firstSync() {
  const before = tasks.length;
  tasks = tasks.filter(t => !t.sample);
  if (tasks.length !== before) { localSig = {}; for (const t of tasks) localSig[t.id] = sig(t); save(); }
  await pushPending();
  await pullChanges();
  render();
}

function subscribeLive() {
  sb.channel("takt-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${user.id}` }, () => pullChanges())
    .subscribe();
}

async function initCloud() {
  for (const t of tasks) localSig[t.id] = sig(t);
  if (!window.supabase || SUPA_URL.startsWith("__")) { window.onAuthChange?.(null, "нет облака"); return; }
  sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  window.onAuthChange?.(user);
  sb.auth.onAuthStateChange(async (_e, session) => {
    const was = user;
    user = session?.user || null;
    window.onAuthChange?.(user);
    if (user && !was) { await firstSync(); subscribeLive(); }
  });
  if (user) { await firstSync(); subscribeLive(); }
  window.addEventListener("online", () => { pushPending(); pullChanges(); });
  window.addEventListener("offline", () => syncStatus("offline"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { pushPending(); pullChanges(); } });
  setInterval(() => { pushPending(); pullChanges(); }, 60e3);
}

async function cloudSignIn(email, password) { return sb ? sb.auth.signInWithPassword({ email, password }) : { error: { message: "облако недоступно" } }; }
async function cloudSignUp(email, password) {
  return sb ? sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }) : { error: { message: "облако недоступно" } };
}
async function cloudSignOut() { if (sb) await sb.auth.signOut(); }
