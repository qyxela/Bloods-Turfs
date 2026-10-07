async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function checkSitePassword() {
  if (sessionStorage.getItem("bloods_auth") === "true") return true;

  const entered = prompt("Enter Passkey to access the site:");
  if (!entered) {
    document.body.innerHTML = "<h2 style='color:white;text-align:center;margin-top:20%'>Access Denied</h2>";
    return false;
  }

  const hash = await sha256(entered.trim());
  if (hash === CONFIG.SITE_PASSWORD_HASH) {
    sessionStorage.setItem("bloods_auth", "true");
    return true;
  } else {
    alert("Incorrect Password!");
    document.body.innerHTML = "<h2 style='color:white;text-align:center;margin-top:20%'>Access Denied</h2>";
    return false;
  }
}

const DB = CONFIG.DATABASE_URL.replace(/\/+$/, "");
const LOCAL_KEY = "bloods_state";
const MAX = CONFIG.MAX_LOYALTY;

let state = { turfs: {}, checks: {}, log: {} };
let user = localStorage.getItem("bloods_user") || "";
let selectedId = null;
let pending = 0;

let map;
let layers = {};
let drawing = false;
let drawPts = [];
let drawDots = [];
let drawLine = null;

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function makeId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function memberKey(name) {
  return name.replace(/[.#$\/\[\]]/g, "_");
}

function today() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2500);
}

// storage

function fixState() {
  state.turfs = state.turfs || {};
  state.checks = state.checks || {};
  state.log = state.log || {};
}

function setPath(path, value) {
  const keys = path.split("/");
  let node = state;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!node[keys[i]]) node[keys[i]] = {};
    node = node[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value === null) delete node[last];
  else node[last] = value;
  fixState();
}

async function write(path, value) {
  setPath(path, value);

  if (!DB) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    return;
  }

  pending++;
  try {
    const res = await fetch(`${DB}/${path}.json`, {
      method: value === null ? "DELETE" : "PUT",
      body: value === null ? undefined : JSON.stringify(value)
    });
    if (!res.ok) throw new Error("http " + res.status);
    showSync(true);
  } catch (err) {
    console.error(err);
    showSync(false);
    toast("Save failed, try again");
  } finally {
    pending--;
  }
}

async function load() {
  if (!DB) {
    try { state = JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch (e) { state = {}; }
    fixState();
    return;
  }
  if (pending > 0) return;
  try {
    const res = await fetch(`${DB}/.json`);
    if (!res.ok) throw new Error("http " + res.status);
    state = (await res.json()) || {};
    fixState();
    showSync(true);
  } catch (err) {
    console.error(err);
    showSync(false);
  }
}

function showSync(ok) {
  const el = $("syncState");
  if (!DB) { el.textContent = "local only"; el.style.color = "var(--warn)"; return; }
  el.textContent = ok ? "synced" : "offline";
  el.style.color = ok ? "var(--good)" : "var(--red-light)";
}

// loyalty

function currentLoyalty(t) {
  const lost = (Date.now() - t.loyaltyAt) / 86400000 * CONFIG.DECAY_PER_DAY;
  return Math.max(0, t.loyalty - lost);
}

function loyaltyColor(v) {
  const pct = v / MAX;
  if (pct >= 0.7) return "var(--good)";
  if (pct >= 0.35) return "var(--warn)";
  return "var(--red-light)";
}

function sortedTurfs() {
  return Object.entries(state.turfs).sort((a, b) => a[1].name.localeCompare(b[1].name));
}

function getPoly(t) {
  try { return JSON.parse(t.poly); } catch (e) { return []; }
}

function needName() {
  if (user) return true;
  toast("Put your name in the top right first");
  $("userName").focus();
  return false;
}

function addLog(turfName, text) {
  return write("log/" + makeId("l"), { t: Date.now(), user: user, turf: turfName, text: text });
}

// map

function initMap() {
  const size = CONFIG.MAP_SIZE;
  const bounds = [[0, 0], [size, size]];

  map = L.map("map", { crs: L.CRS.Simple, minZoom: -1, maxZoom: 4, zoomSnap: 0.25, attributionControl: false });
  L.imageOverlay(CONFIG.MAP_IMAGE, bounds).addTo(map);
  map.fitBounds(bounds);

  map.on("click", e => {
    if (!drawing) return;
    const p = [Math.round(e.latlng.lat * 10) / 10, Math.round(e.latlng.lng * 10) / 10];
    drawPts.push(p);
    drawDots.push(L.circleMarker(p, { radius: 4, color: "#fff", fillColor: "#e5383b", fillOpacity: 1 }).addTo(map));
    updateDrawLine();
  });
}

function updateDrawLine() {
  if (drawLine) map.removeLayer(drawLine);
  drawLine = null;
  if (drawPts.length > 1) {
    drawLine = L.polyline(drawPts, { color: "#e5383b", dashArray: "5 5" }).addTo(map);
  }
  $("drawCount").textContent = drawPts.length + (drawPts.length === 1 ? " point" : " points");
}

function setDrawing(on) {
  drawing = on;
  $("drawBar").classList.toggle("on", on);
  $("map").classList.toggle("drawing", on);
  if (!on) {
    drawDots.forEach(m => map.removeLayer(m));
    drawDots = [];
    drawPts = [];
    updateDrawLine();
  }
}

function drawTurfs() {
  Object.values(layers).forEach(l => map.removeLayer(l));
  layers = {};

  sortedTurfs().forEach(([id, t]) => {
    const pts = getPoly(t);
    if (pts.length < 3) return;
    const v = currentLoyalty(t);
    const low = v / MAX < 0.35;

    const poly = L.polygon(pts, {
      color: low ? "#d6a21c" : "#e5383b",
      dashArray: low ? "6 4" : null,
      weight: id === selectedId ? 4 : 2,
      fillColor: "#c4161c",
      fillOpacity: 0.15 + (v / MAX) * 0.5
    }).addTo(map);

    const tip = document.createElement("div");
    tip.innerHTML = "<b>" + esc(t.name) + "</b><br>" + Math.round(v) + " / " + MAX;
    poly.bindTooltip(tip, { sticky: true });
    poly.on("click", () => { if (!drawing) selectTurf(id, false); });

    layers[id] = poly;
  });
}

// sidebar

function renderTurfs() {
  const list = sortedTurfs();
  $("turfCount").textContent = list.length;

  if (!list.length) {
    $("turfList").innerHTML = '<p class="muted">Nothing here yet. Hit "+ New turf" and click around the area on the map.</p>';
    return;
  }

  $("turfList").innerHTML = list.map(([id, t]) => {
    const v = currentLoyalty(t);
    const sel = id === selectedId;
    return `
      <div class="card click ${sel ? "sel" : ""}" data-id="${esc(id)}">
        <div class="row">
          <strong>${esc(t.name)}</strong>
          <span style="color:${loyaltyColor(v)};font-weight:600">${Math.round(v)}</span>
        </div>
        <div class="muted">last set ${timeAgo(t.loyaltyAt)}</div>
        <div class="bar"><i style="width:${v / MAX * 100}%;background:${loyaltyColor(v)}"></i></div>
        ${sel ? `<div class="actions">
          <button class="small primary" data-act="loyalty">Update loyalty</button>
          <button class="small danger" data-act="delete">Delete</button>
        </div>` : ""}
      </div>`;
  }).join("");
}

function renderDaily() {
  const date = $("dayPick").value || today();
  const day = state.checks[date] || {};
  const turfs = sortedTurfs();
  const me = user ? memberKey(user) : null;
  let total = 0;
  const people = new Set();

  if (!turfs.length) {
    $("dailyList").innerHTML = '<p class="muted">Add a turf first.</p>';
    $("daySummary").textContent = "";
    return;
  }

  $("dailyList").innerHTML = turfs.map(([id, t]) => {
    const rows = CONFIG.TASKS.map(task => {
      const who = (day[id] && day[id][task]) || {};
      const names = Object.values(who);
      names.forEach(n => people.add(n));
      total += names.length;
      const mine = me && who[me];
      return `
        <div class="task">
          <button class="small ${mine ? "done" : ""}" data-turf="${esc(id)}" data-task="${esc(task)}">${mine ? "✓ " : ""}${esc(task)}</button>
          <div class="chips">${names.length
            ? names.map(n => `<span class="chip">${esc(n)}</span>`).join("")
            : '<span class="muted">nobody yet</span>'}</div>
        </div>`;
    }).join("");
    return `<div class="card"><strong>${esc(t.name)}</strong><div style="margin-top:6px">${rows}</div></div>`;
  }).join("");

  $("daySummary").textContent = total + " check-ins, " + people.size + " people (" + date + ")";
}

function renderLog() {
  const entries = Object.values(state.log).sort((a, b) => b.t - a.t).slice(0, 100);
  if (!entries.length) {
    $("logList").innerHTML = '<p class="muted">Nothing logged yet.</p>';
    return;
  }
  $("logList").innerHTML = entries.map(e => `
    <div class="card">
      <div class="row"><strong>${esc(e.user)}</strong><span class="muted">${timeAgo(e.t)}</span></div>
      <div class="muted">${esc(e.turf)}</div>
      <div>${esc(e.text)}</div>
    </div>`).join("");
}

function renderAll() {
  drawTurfs();
  renderTurfs();
  renderDaily();
  renderLog();
}

function openTab(name) {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach(s => s.classList.toggle("active", s.id === "tab-" + name));
}

// actions

function selectTurf(id, zoom) {
  selectedId = id;
  if (zoom !== false && layers[id]) map.fitBounds(layers[id].getBounds(), { padding: [40, 40] });
  openTab("turfs");
  drawTurfs();
  renderTurfs();
}

function toggleTask(turfId, task) {
  if (!needName()) return;
  const date = $("dayPick").value || today();
  const key = memberKey(user);
  const already = state.checks[date] && state.checks[date][turfId] &&
                  state.checks[date][turfId][task] && state.checks[date][turfId][task][key];

  write(`checks/${date}/${turfId}/${task}/${key}`, already ? null : user);
  if (!already) addLog(state.turfs[turfId].name, "did: " + task + (date !== today() ? " (for " + date + ")" : ""));
  renderDaily();
  renderLog();
}

function saveNewTurf() {
  const name = $("tName").value.trim();
  if (!name) return toast("Needs a name");
  if (!needName()) return;

  const id = makeId("t");
  const loyalty = Math.min(MAX, Math.max(0, parseInt($("tLoyalty").value) || 0));

  write("turfs/" + id, {
    name: name,
    poly: JSON.stringify(drawPts),
    loyalty: loyalty,
    loyaltyAt: Date.now()
  });
  addLog(name, "added the turf");

  $("turfDialog").close();
  setDrawing(false);
  selectedId = id;
  renderAll();
}

function openLoyaltyDialog() {
  const t = state.turfs[selectedId];
  if (!t) return;
  $("lTitle").textContent = t.name;
  $("lValue").value = Math.round(currentLoyalty(t));
  $("lValue").max = MAX;
  $("lNote").value = "";
  $("loyaltyDialog").showModal();
}

function saveLoyalty() {
  const t = state.turfs[selectedId];
  const v = parseInt($("lValue").value);
  if (!t) return;
  if (isNaN(v) || v < 0 || v > MAX) return toast("Score has to be 0 - " + MAX);
  if (!needName()) return;

  write(`turfs/${selectedId}/loyalty`, v);
  write(`turfs/${selectedId}/loyaltyAt`, Date.now());

  const note = $("lNote").value.trim();
  addLog(t.name, "set loyalty to " + v + (note ? " - " + note : ""));

  $("loyaltyDialog").close();
  renderAll();
}

function deleteTurf() {
  const t = state.turfs[selectedId];
  if (!t) return;
  if (!needName()) return;
  if (!confirm('Delete "' + t.name + '"?')) return;

  write("turfs/" + selectedId, null);
  addLog(t.name, "deleted the turf");
  selectedId = null;
  renderAll();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bloods-turf-" + today() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importData(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    return toast("That's not a valid backup file");
  }
  if (!confirm("This replaces everything currently saved. Sure?")) return;

  for (const key of ["turfs", "checks", "log"]) {
    await write(key, data[key] || {});
  }
  renderAll();
  toast("Imported");
}

async function wipeAll() {
  const pin = prompt("ENTER ADMIN PIN TO WIPE ALL DATA:");
  if (!pin) return;

  const enteredHash = await sha256(pin.trim());
  if (enteredHash !== CONFIG.ADMIN_PIN_HASH) {
    return toast("Incorrect Admin PIN!");
  }

  if (!confirm("CRITICAL WARNING: Delete ALL turfs, checklists, and logs permanently for everyone?")) return;

  for (const key of ["turfs", "checks", "log"]) {
    await write(key, null);
  }
  selectedId = null;
  renderAll();
  toast("Database wiped completely!");
}

function setupEvents() {
  $("userName").value = user;
  $("userName").addEventListener("change", e => {
    user = e.target.value.trim();
    localStorage.setItem("bloods_user", user);
    renderDaily();
  });

  $("tabs").addEventListener("click", e => {
    if (e.target.dataset.tab) openTab(e.target.dataset.tab);
  });

  $("turfList").addEventListener("click", e => {
    const card = e.target.closest(".card");
    if (!card) return;
    const act = e.target.dataset.act;
    if (act === "loyalty") openLoyaltyDialog();
    else if (act === "delete") deleteTurf();
    else selectTurf(card.dataset.id);
  });

  $("dayPick").value = today();
  $("dayPick").addEventListener("change", renderDaily);
  $("dailyList").addEventListener("click", e => {
    const btn = e.target.closest("button[data-task]");
    if (btn) toggleTask(btn.dataset.turf, btn.dataset.task);
  });

  $("drawStart").onclick = () => { setDrawing(true); toast("Click the map to place points"); };
  $("drawCancel").onclick = () => setDrawing(false);
  $("drawUndo").onclick = () => {
    drawPts.pop();
    const dot = drawDots.pop();
    if (dot) map.removeLayer(dot);
    updateDrawLine();
  };
  $("drawFinish").onclick = () => {
    if (drawPts.length < 3) return toast("Need at least 3 points");
    $("tName").value = "";
    $("tLoyalty").max = MAX;
    $("turfDialog").showModal();
  };

  $("turfSave").onclick = saveNewTurf;
  $("turfCancel").onclick = () => $("turfDialog").close();
  $("lSave").onclick = saveLoyalty;
  $("lCancel").onclick = () => $("loyaltyDialog").close();

  $("exportBtn").onclick = exportData;
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  };
  $("wipeBtn").onclick = wipeAll;
}

async function start() {
  const authorized = await checkSitePassword();
  if (!authorized) return;

  initMap();
  setupEvents();
  showSync(true);
  await load();
  renderAll();

  setInterval(async () => {
    await load();
    renderAll();
  }, CONFIG.REFRESH_SECONDS * 1000);
}

start();
