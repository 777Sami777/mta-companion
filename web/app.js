// 4Life Companion: jedna strona, dane z Pythona (window.pywebview.api)
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const pln = v => Math.round(v).toLocaleString("pl-PL") + " PLN";
const dur = s => { s = Math.max(0, Math.round(s / 60)); return s >= 60 ? `${Math.floor(s / 60)} h ${s % 60} min` : `${s} min`; };
const hm = ts => new Date(ts * 1000).toLocaleTimeString("pl-PL", {hour: "2-digit", minute: "2-digit"});
const day = ts => new Date(ts * 1000).toLocaleDateString("pl-PL", {weekday: "short", day: "2-digit", month: "2-digit"});
const dayKey = ts => new Date(ts * 1000).toLocaleDateString("sv");
const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
const table = (head, rows) => `<tr>${head.map(h => `<th class="${h[1] || ""}">${h[0]}</th>`).join("")}</tr>` +
  (rows.length ? rows.join("") : `<tr><td class="empty" colspan="${head.length}">Brak danych</td></tr>`);

let hist = {events: [], sessions: []}, srv = {list: []}, user = {friends: [], hidden: []};
let api;

// ---------- zakładki ----------
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab, .page").forEach(e => e.classList.remove("on"));
  b.classList.add("on");
  $("#" + b.dataset.tab).classList.add("on");
  if (b.dataset.tab === "mapa") initMap();
});

// ---------- znajomi: z logów + ręcznie dodani, bez ukrytych ----------
function friends() {
  const map = new Map();
  for (const f of user.friends) map.set(f.nick.toLowerCase(), {...f});
  for (const e of hist.events) {
    if (e.t !== "friend") continue;
    const k = e.nick.toLowerCase();
    if (user.hidden.includes(k)) continue;
    const f = map.get(k) || {nick: e.nick, note: "", auto: true};
    f.lastSeen = e.ts;
    f.lastOn = e.on;
    map.set(k, f);
  }
  const online = new Map(srv.list.map(p => [String(p.nick).toLowerCase(), p]));
  return [...map.values()].map(f => ({...f, live: online.get(f.nick.toLowerCase())}))
    .sort((a, b) => !!b.live - !!a.live || a.nick.localeCompare(b.nick));
}

const save = () => api.save(user);

function renderFriends() {
  const q = $("#f-filter").value.trim().toLowerCase();
  const list = friends().filter(f => !q || f.nick.toLowerCase().includes(q) || (f.note || "").toLowerCase().includes(q));
  $("#f-list").innerHTML = list.length ? list.map(f => {
    const meta = f.live
      ? `<span class="good">Online</span>${f.live.joined ? ` od ${hm(f.live.joined)} (${dur(Date.now() / 1000 - f.live.joined)})` : ""} · ID ${esc(f.live.id)} · ping ${esc(f.live.ping)}`
      : f.lastSeen ? `Offline · ostatnio ${f.lastOn ? "wszedł" : "wyszedł"} ${day(f.lastSeen)} ${hm(f.lastSeen)}` : "Offline";
    return `<li class="friend"><header><i class="dot ${f.live ? "on" : ""}"></i><b>${esc(f.nick)}</b>
      <button class="btn small" data-del="${esc(f.nick)}" aria-label="Usuń ${esc(f.nick)}">Usuń</button></header>
      <div class="meta">${meta}</div>
      <input type="text" data-note="${esc(f.nick)}" value="${esc(f.note)}" placeholder="Notatka: numer, frakcja, dług…" aria-label="Notatka o ${esc(f.nick)}"></li>`;
  }).join("") : `<li class="empty">Brak znajomych. Dodaj kogoś albo wejdź do gry, gdy znajomy jest online.</li>`;
}

function upsertFriend(nick, patch) {
  const k = nick.toLowerCase();
  user.hidden = user.hidden.filter(h => h !== k);
  let f = user.friends.find(x => x.nick.toLowerCase() === k);
  if (!f) user.friends.push(f = {nick, note: ""});
  Object.assign(f, patch);
  save();
}

$("#f-add").onsubmit = e => {
  e.preventDefault();
  const nick = $("#f-nick").value.trim();
  if (!nick) return;
  upsertFriend(nick, {});
  $("#f-nick").value = "";
  renderAll();
};
$("#f-filter").oninput = renderFriends;
$("#f-list").onclick = e => {
  const nick = e.target.dataset.del;
  if (!nick || !confirm(`Usunąć ${nick} z listy znajomych?`)) return;
  const k = nick.toLowerCase();
  user.friends = user.friends.filter(f => f.nick.toLowerCase() !== k);
  if (!user.hidden.includes(k)) user.hidden.push(k); // nie wraca sam z logów
  save();
  renderAll();
};
$("#f-list").onchange = e => { if (e.target.dataset.note) upsertFriend(e.target.dataset.note, {note: e.target.value}); };

// ---------- zarobki i sesje ----------
const earnings = () => hist.events.filter(e => e.t === "pay" || e.t === "bonus");

function byDay() {
  const days = {};
  for (const e of earnings()) {
    const d = days[dayKey(e.ts)] ??= {ts: e.ts, pay: 0, bonus: 0, n: 0, lp: 0, time: 0};
    if (e.t === "pay") { d.pay += e.v; d.n++; } else { d.bonus += e.v; d.lp += e.lp || 0; }
  }
  for (const s of hist.sessions) (days[dayKey(s.start)] ??= {ts: s.start, pay: 0, bonus: 0, n: 0, lp: 0, time: 0}).time += s.end - s.start;
  return Object.entries(days).sort((a, b) => b[0].localeCompare(a[0]));
}

function renderAll() {
  const now = Date.now() / 1000, today = dayKey(now), days = byDay();
  const t = (days.find(d => d[0] === today) || [0, {pay: 0, bonus: 0, n: 0, lp: 0, time: 0}])[1];
  const fr = friends(), on = fr.filter(f => f.live);
  const last = hist.sessions.at(-1);
  const inGame = last && now - last.end < 120; // log dopisuje się na bieżąco, więc świeży wpis = sesja trwa

  $("#today").innerHTML = stat(dur(t.time), "Czas gry dziś") + stat(pln(t.pay + t.bonus), "Zarobek dziś") +
    stat(t.n, "Wypłat dziś") + stat(t.lp, "LP dziś") +
    stat(inGame ? dur(now - last.start) : "—", inGame ? "Obecna sesja" : "Nie grasz") +
    stat(srv.players != null ? `${srv.players}/${srv.max}` : "—", "Graczy na serwerze");
  $("#today-friends").innerHTML = on.length ? on.map(f => `<li><span>${esc(f.nick)}</span><span>${f.live.joined ? dur(now - f.live.joined) : ""}</span></li>`).join("")
    : `<li class="empty">Nikt ze znajomych nie gra</li>`;
  $("#today-pays").innerHTML = earnings().slice(-8).reverse().map(e => `<li><span>${e.t === "bonus" ? "Bonus godzinowy" : "Wypłata"} · ${day(e.ts)} ${hm(e.ts)}</span><b>${pln(e.v)}</b></li>`).join("")
    || `<li class="empty">Brak wypłat w logach</li>`;

  const week = days.filter(d => now - d[1].ts < 7 * 86400), sum = (a, k) => a.reduce((s, d) => s + d[1][k], 0);
  const wTime = sum(week, "time"), wMoney = sum(week, "pay") + sum(week, "bonus");
  $("#earn-sum").innerHTML = stat(pln(wMoney), "Zarobek 7 dni") + stat(wTime ? pln(wMoney / (wTime / 3600)) : "—", "Średnio na godzinę") +
    stat(pln(sum(days, "pay") + sum(days, "bonus")), "Razem w historii") + stat(sum(days, "lp"), "LP razem");
  $("#earn-days").innerHTML = table([["Dzień"], ["Wypłaty", "n"], ["Liczba", "n"], ["Bonusy", "n"], ["LP", "n"], ["Czas gry", "n"], ["Na godzinę", "n"]],
    days.map(([, d]) => `<tr><td>${day(d.ts)}</td><td class="n">${pln(d.pay)}</td><td class="n">${d.n}</td><td class="n">${pln(d.bonus)}</td><td class="n">${d.lp}</td><td class="n">${dur(d.time)}</td><td class="n">${d.time ? pln((d.pay + d.bonus) / (d.time / 3600)) : "—"}</td></tr>`));

  const ss = [...hist.sessions].reverse();
  $("#sess-sum").innerHTML = stat(dur(wTime), "Gra w 7 dni") + stat(ss.length, "Sesji w historii") +
    stat(ss.length ? dur(ss.reduce((a, s) => a + s.end - s.start, 0) / ss.length) : "—", "Średnia sesja") +
    stat(hist.events.filter(e => e.t === "afk").length, "Kicków za AFK");
  $("#sess-list").innerHTML = table([["Dzień"], ["Od"], ["Do"], ["Długość", "n"], ["Zarobek", "n"]], ss.map(s => {
    const m = earnings().filter(e => e.ts >= s.start && e.ts <= s.end).reduce((a, e) => a + e.v, 0);
    return `<tr><td>${day(s.start)}</td><td>${hm(s.start)}</td><td>${hm(s.end)}</td><td class="n">${dur(s.end - s.start)}</td><td class="n">${pln(m)}</td></tr>`;
  }));

  renderFriends();
  renderServer();
}

// ---------- serwer ----------
function renderServer() {
  const now = Date.now() / 1000, q = $("#srv-q").value.trim().toLowerCase();
  $("#srv-sum").innerHTML = srv.error ? stat("—", "Serwer nie odpowiada") :
    stat(`${srv.players ?? "—"}/${srv.max ?? "—"}`, "Graczy online") + stat(friends().filter(f => f.live).length, "Znajomych online");
  const rows = srv.list.filter(p => !q || String(p.nick).toLowerCase().includes(q) || p.id === q).slice(0, 200);
  $("#srv-list").innerHTML = table([["Nick"], ["ID", "n"], ["Ping", "n"], ["Gra od", "n"], [""]], rows.map(p =>
    `<tr><td>${esc(p.nick)}</td><td class="n">${esc(p.id)}</td><td class="n">${esc(p.ping)}</td><td class="n">${p.joined ? `${hm(p.joined)} · ${dur(now - p.joined)}` : "—"}</td>
     <td class="n"><button class="btn small" data-add="${esc(p.nick)}">Do znajomych</button></td></tr>`));
}
$("#srv-q").oninput = renderServer;
$("#srv-list").onclick = e => { if (e.target.dataset.add) { upsertFriend(e.target.dataset.add, {}); renderAll(); e.target.textContent = "Dodano"; } };

// ---------- mapa: obraz z cache MTA, miejsca z wiki serwera i punkty ze skryptów w cache ----------
const ICON = {
  exchange: "M7 7h12l-3-3M17 17H5l3 3", car: "M5 16v-5l2-5h10l2 5v5M3 16h18v3H3z", bank: "M3 10h18L12 4zM5 10v8M10 10v8M14 10v8M19 10v8M3 20h18",
  wrench: "M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 1-2-2z", job: "M4 8h16v11H4zM9 8V5h6v3", shield: "M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z",
  star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5l-5.3 2.9 1.2-6-4.5-4.1 6-.7z", pin: "M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z",
  bus: "M6 4h12v13H6zM6 11h12M8 20v-3M16 20v-3", truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7", flag: "M5 21V4h12l-2 4 2 4H5",
  check: "M5 12l4 4 10-10", box: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10", lock: "M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0v4",
};
// warstwa: [nazwa, kolor, ikona, domyślnie włączona]
const LAYERS = {
  moje: ["Moje znaczniki", "#f8fafc", "pin", 1], gieldy: ["Giełdy", "#facc15", "exchange", 1], salony: ["Salony i komisy", "#fb923c", "car", 1], banki: ["Banki i urzędy", "#4ade80", "bank", 1],
  pojazdy: ["Stacje, mechanicy, tuning", "#38bdf8", "wrench", 0], prace: ["Prace", "#f59e0b", "job", 1], frakcje: ["Frakcje", "#ef4444", "shield", 1],
  biznesy: ["Biznesy", "#c084fc", "star", 1], inne: ["Inne miejsca", "#94a3b8", "pin", 0],
  "4l-model-busstop": ["Przystanki", "#22d3ee", "bus", 0], "4l-app-eTransporter": ["Punkty eTransporter", "#f97316", "truck", 0],
  "4l-skp-base": ["Stacje kontroli (SKP)", "#a78bfa", "check", 0], "4l-map-warehouse-courier": ["Kurier: magazyn", "#22c55e", "box", 0],
  "4l-race": ["Wyścigi", "#f472b6", "flag", 0], "4l-prison": ["Więzienie (punkty)", "#ef4444", "lock", 0],
};
function wikiLayer(p) {
  if (p.type.endsWith("_exchange")) return "gieldy";
  if (p.type === "bank" || p.type === "office") return "banki";
  return {trading: "salony", vehicles: "pojazdy", job: "prace", faction: "frakcje", business: "biznesy"}[p.cat] || "inne";
}
let mapReady = false;

async function initMap() {
  if (mapReady) return;
  mapReady = true;
  const [p, wiki] = await Promise.all([api.places(), api.wiki("places").then(w => w || [])]);
  if (!p.map) { $("#map").innerHTML = `<p class="missing">Nie znaleziono mapy w cache MTA. Wejdź raz na serwer 4Life, żeby MTA pobrało pliki, i otwórz zakładkę ponownie.</p>`; return; }
  const img = document.createElement("img");
  img.id = "map-img"; img.alt = "Mapa San Andreas"; img.src = p.map;
  $("#map-in").prepend(img);
  const groups = {};
  wiki.forEach(w => (groups[wikiLayer(w)] ??= []).push({x: w.x, y: w.y, name: w.name, desc: w.desc, icon: w.icon}));
  p.points.forEach(pt => (groups[pt.layer] ??= []).push({x: pt.x, y: pt.y, name: (LAYERS[pt.layer] || [pt.layer])[0], desc: pt.label}));
  groups.moje = user.markers ??= []; // własne znaczniki: ta sama tablica co w zapisie, więc zmiany od razu się zapisują
  const names = Object.keys(LAYERS).filter(l => groups[l]).concat(Object.keys(groups).filter(l => !LAYERS[l]));
  const def = l => LAYERS[l] || [l.replace(/^4l-/, ""), "#94a3b8", "pin", 0];
  const state = user.mapLayerState ??= {}; // tylko warstwy przełączone ręcznie, reszta ma ustawienie domyślne
  const on = new Set(names.filter(l => state[l] ?? !!def(l)[3]));
  const svg = k => `<svg viewBox="0 0 24 24"><path d="${ICON[k]}"/></svg>`;
  const chips = () => $("#layers").innerHTML = names.map(l => `<button class="chip ${on.has(l) ? "on" : ""}" style="--c:${def(l)[1]}" data-l="${esc(l)}">${svg(def(l)[2])}${esc(def(l)[0])} · ${groups[l].length}</button>`).join("");
  chips();
  const info = () => $("#map-info").textContent = `${wiki.length} miejsc z wiki · ${p.points.length} punktów z cache MTA · kliknij ikonę, żeby zobaczyć opis · dwuklik na mapie dodaje własny znacznik`;
  const draw = () => {
    $("#pins").innerHTML = names.flatMap(l => on.has(l) ? groups[l].map((pt, i) =>
      `<button class="pin" style="--c:${def(l)[1]};left:${(pt.x + 3000) / 2}px;top:${(3000 - pt.y) / 2}px" data-p="${esc(l)}|${i}" title="${esc(pt.name)}${pt.desc ? ": " + esc(pt.desc) : ""}" aria-label="${esc(pt.name)}">${svg(def(l)[2])}${pt.icon ? `<img data-icon="${esc(pt.icon)}" alt="">` : ""}</button>`) : []).join("");
    // ikony z wiki: każda pobierana raz (potem z dysku); do czasu wczytania widać zwykłą ikonę warstwy
    $("#pins").querySelectorAll("img[data-icon]").forEach(async i => {
      const src = await api.wiki_img(i.dataset.icon);
      if (src) { i.src = src; i.parentElement.classList.add("blip"); }
    });
    info();
  };
  $("#layers").onclick = e => {
    const b = e.target.closest("[data-l]");
    if (!b) return;
    const l = b.dataset.l;
    on.has(l) ? on.delete(l) : on.add(l);
    b.classList.toggle("on");
    state[l] = on.has(l); save(); draw();
  };
  $("#pins").onclick = e => {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    const [l, i] = b.dataset.p.split("|"), pt = groups[l][i];
    $("#map-info").textContent = `${pt.name}${pt.desc ? " · " + pt.desc : ""}`;
    if (l === "moje") {
      const del = document.createElement("button");
      del.className = "btn small"; del.textContent = "Usuń znacznik";
      del.onclick = () => { if (confirm(`Usunąć znacznik „${pt.name}”?`)) { groups.moje.splice(i, 1); save(); chips(); draw(); } };
      $("#map-info").append(" ", del);
    }
  };
  $("#map").ondblclick = e => {
    if (e.target.closest("[data-p]")) return;
    const r = $("#map-in").getBoundingClientRect(), k = r.width / 3000; // piksele mapy 3000 px = świat ±3000 jednostek
    const px = (e.clientX - r.left) / k, py = (e.clientY - r.top) / k;
    const name = prompt("Nazwa znacznika:");
    if (!name) return;
    groups.moje.push({x: px * 2 - 3000, y: 3000 - py * 2, name: name.slice(0, 60), desc: (prompt("Notatka (opcjonalnie):") || "").slice(0, 200)});
    on.add("moje"); save(); chips(); draw();
  };
  $("#pins").onpointerdown = e => { if (e.target.closest("[data-p]")) e.stopPropagation(); }; // klik w ikonę nie zaczyna przeciągania
  draw();
  panZoom();
}

function panZoom() {
  const box = $("#map"), inner = $("#map-in");
  let s = Math.min(box.clientWidth, box.clientHeight) / 3000, x = (box.clientWidth - 3000 * s) / 2, y = (box.clientHeight - 3000 * s) / 2;
  const apply = () => { inner.style.transform = `translate(${x}px,${y}px) scale(${s})`; inner.style.setProperty("--inv", Math.min(8, Math.max(0.5, 0.9 / s))); }; // --inv: ikony mają stały rozmiar na ekranie
  box.onwheel = e => {
    e.preventDefault();
    const r = box.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const ns = Math.min(3, Math.max(0.1, s * k));
    x = mx - (mx - x) * ns / s; y = my - (my - y) * ns / s; s = ns; apply();
  };
  box.onpointerdown = e => {
    const sx = e.clientX - x, sy = e.clientY - y;
    box.classList.add("drag"); box.setPointerCapture(e.pointerId);
    box.onpointermove = m => { x = m.clientX - sx; y = m.clientY - sy; apply(); };
    box.onpointerup = () => { box.onpointermove = null; box.classList.remove("drag"); };
  };
  box.onkeydown = e => {
    const d = {ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60]}[e.key];
    if (d) { x += d[0]; y += d[1]; apply(); e.preventDefault(); }
  };
  apply();
}

// ---------- ceny surowców (forum serwera) ----------
const price = v => v.toLocaleString("pl-PL", {minimumFractionDigits: 2, maximumFractionDigits: 2});
async function refreshPrices() {
  const d = await api.prices();
  if (!d) { $("#prices").innerHTML = `<li class="empty">Nie udało się pobrać cen z forum</li>`; return; }
  const old = Date.now() / 1000 - d.at > 1800;
  $("#price-at").textContent = `· ${old ? "z " + day(d.at) + " " : ""}${hm(d.at)}`;
  $("#prices").innerHTML = d.items.map(p => `<li class="price"><span class="p-ico">${p.icon ? `<img data-icon="${esc(p.icon)}" alt="">` : ""}</span>
    <span><span class="p-name">${esc(p.name)}</span><b>${price(p.price)}</b><small>${esc(p.unit)}</small></span></li>`).join("");
  $("#prices").querySelectorAll("img[data-icon]").forEach(async i => { const src = await api.wiki_img(i.dataset.icon); if (src) i.src = src; });
  document.dispatchEvent(new CustomEvent("prices", {detail: d}));
}

// ---------- aktualizacje ----------
let update = null;
async function checkUpdate(manual) {
  const btn = $("#upd-btn"), info = $("#upd-info");
  if (manual) { btn.disabled = true; btn.textContent = "Sprawdzam…"; }
  update = await api.check_update();
  btn.disabled = false;
  if (update.error) { btn.textContent = "Sprawdź aktualizacje"; info.textContent = `Wersja ${update.current} · ${manual ? update.error : ""}`; return; }
  if (update.newer) {
    btn.textContent = update.canInstall ? `Pobierz wersję ${update.latest}` : `Jest wersja ${update.latest}`;
    btn.classList.add("primary"); btn.classList.remove("small");
    info.textContent = `Masz ${update.current}` + (update.canInstall ? "" : " · aktualizacja działa w wersji .exe");
  } else {
    btn.textContent = "Sprawdź aktualizacje";
    info.textContent = `Wersja ${update.current}` + (manual ? " · masz najnowszą" : "");
  }
}
$("#upd-btn").onclick = async () => {
  if (!update?.newer || !update.canInstall) return checkUpdate(true);
  const notes = update.notes ? "\n\nCo nowego:\n" + update.notes : "";
  if (!confirm(`Pobrać i zainstalować wersję ${update.latest}? Aplikacja uruchomi się ponownie.${notes}`)) return;
  $("#upd-btn").disabled = true; $("#upd-btn").textContent = "Pobieram…";
  const r = await api.install_update();
  if (!r.ok) { $("#upd-info").textContent = r.error; $("#upd-btn").disabled = false; $("#upd-btn").textContent = "Spróbuj ponownie"; }
  else $("#upd-btn").textContent = "Uruchamiam nową wersję…";
};

// ---------- start i odświeżanie ----------
async function refresh() {
  [hist, srv] = await Promise.all([api.history(), api.server()]);
  srv.list ??= [];
  renderAll();
  document.dispatchEvent(new CustomEvent("data")); // features.js: powiadomienia, widżet
}

window.addEventListener("pywebviewready", async () => {
  api = window.pywebview.api;
  user = Object.assign({friends: [], hidden: []}, await api.load());
  $("#upd-info").textContent = "Wersja " + await api.app_version();
  await refresh();
  setInterval(refresh, 60000);
  refreshPrices();
  setInterval(refreshPrices, 10 * 60000); // ceny na forum zmieniają się w ciągu dnia
  checkUpdate(false);
});
