// Forum (ogłoszenia, wydarzenia, taryfikator), Discord, alert ceny auta, porównywarka i obserwowane auta,
// eksport CSV, dziennik postaci i cele dzienne.

// ---------- ogłoszenia i wydarzenia z forum, Discord ----------
const linkItem = (title, url, ts) => `<li><button class="link" data-url="${esc(url)}">${esc(title)}</button><span class="muted">${ts ? day(ts) + (Date.now() / 1000 - ts < 86400 * 2 ? " " + hm(ts) : "") : ""}</span></li>`;
async function renderForum() {
  const [news, events, discord] = await Promise.all([api.wiki("news"), api.wiki("events"), api.wiki("discord")]);
  $("#news").innerHTML = (news || []).slice(0, 6).map(n => linkItem(n.title, n.url, n.ts)).join("") || `<li class="empty">Nie udało się pobrać ogłoszeń</li>`;
  const soon = (events || []).filter(e => !e.ts || e.ts > Date.now() / 1000 - 3600);
  $("#events").innerHTML = soon.slice(0, 6).map(e => linkItem(e.title, e.url, e.ts)).join("") || `<li class="empty">Brak zaplanowanych wydarzeń na forum</li>`;
  if (discord?.online != null && !$("#discord-stat")) $("#today").insertAdjacentHTML("beforeend", `<div class="stat" id="discord-stat"><b></b><span>Online na Discordzie</span></div>`);
  if (discord?.online != null) $("#discord-stat b").textContent = discord.online.toLocaleString("pl-PL");
  // przypomnienie godzinę przed wydarzeniem
  if (settings().events !== false) soon.forEach(e => {
    const left = e.ts - Date.now() / 1000, key = "event" + e.url + e.ts;
    if (left > 0 && left <= 3600 && !notified.has(key)) { notified.add(key); api.notify("Wydarzenie za " + dur(left), e.title); }
  });
}
document.addEventListener("click", e => { const b = e.target.closest("[data-url]"); if (b) api.open_url(b.dataset.url); });
document.addEventListener("data", () => { renderForum(); renderGoals(); });

// ---------- taryfikator ----------
async function renderTariff() {
  const rows = await api.wiki("tariff");
  if (!rows) { $("#tar-list").innerHTML = `<tr><td class="empty">Nie udało się pobrać taryfikatora z forum</td></tr>`; return; }
  const q = $("#tar-q").value.trim().toLowerCase();
  const hit = rows.filter(r => !q || (r.offence + " " + r.section).toLowerCase().includes(q));
  let section = "";
  $("#tar-list").innerHTML = table([["Przewinienie"], ["Kara"], ["Recydywa"]], hit.map(r => {
    const head = r.section !== section ? `<tr><th colspan="3" class="tar-sec">${esc(section = r.section)}</th></tr>` : "";
    return head + `<tr><td>${esc(r.offence)}</td><td>${esc(r.penalty)}</td><td>${esc(r.repeat)}</td></tr>`;
  }));
}
$("#tar-q").oninput = renderTariff;
$("#tar-link").onclick = () => api.open_url("https://mta4life.pl/taryfikator/");
FEATURE_TABS.taryfikator = renderTariff;

// ---------- alert ceny auta z giełdy ----------
let lastCarTs = null;
function renderCarAlerts() {
  const list = settings().carAlerts ??= [];
  $("#car-alerts").innerHTML = list.map((a, i) => `<li><span>${esc(a.veh)} · do ${pln(a.max)}</span><button class="btn small" data-del-alert="${i}">Usuń</button></li>`).join("") || `<li class="empty">Brak alertów</li>`;
}
$("#car-alert-form").onsubmit = e => {
  e.preventDefault();
  const veh = $("#ca-veh").value.trim(), max = +$("#ca-max").value.replace(/\D/g, "");
  if (!veh || !max) return;
  (settings().carAlerts ??= []).push({veh, max});
  $("#ca-veh").value = $("#ca-max").value = "";
  save(); renderCarAlerts();
};
$("#car-alerts").onclick = e => { const i = e.target.dataset.delAlert; if (i != null) { settings().carAlerts.splice(+i, 1); save(); renderCarAlerts(); } };
document.addEventListener("data", async () => {
  const rules = settings().carAlerts || [];
  if (!rules.length) return;
  const prices = await api.car_prices(), newest = prices.at(-1)?.ts || 0;
  if (lastCarTs === null) { lastCarTs = newest; return; } // przy starcie nie zgłaszamy starych ogłoszeń
  prices.filter(p => p.ts > lastCarTs && p.s).forEach(p => rules.forEach(r => {
    if (p.v.toLowerCase() === r.veh.toLowerCase() && p.p <= r.max) api.notify(`${p.v} za ${pln(p.p)}`, `Wystawia ${p.nick} na giełdzie (Twój próg: ${pln(r.max)})`);
  }));
  lastCarTs = Math.max(lastCarTs, newest);
});

// ---------- obserwowane auta i porównywarka ----------
let marketStats = {};
// typowa cena z giełdy przy karcie pojazdu (wywoływane przez wiki.js przy rysowaniu kart)
function marketLine(v) {
  const m = marketStats[v.name];
  return m ? `<div class="meta">Giełda: typowo <b>${fmtPln(m.med)}</b> · ${m.n} ogłoszeń</div>` : "";
}
async function loadMarketStats() {
  const [prices, vehicles] = await Promise.all([api.car_prices(), wikiData("vehicles")]);
  const by = {};
  prices.filter(p => p.s).forEach(p => {
    const veh = (vehicles || []).find(x => x.name === p.v), sp = veh ? minPrice(veh) : Infinity;
    if (!isFinite(sp) || (p.p >= sp * 0.1 && p.p <= sp * 10)) (by[p.v] ??= []).push(p.p);
  });
  marketStats = Object.fromEntries(Object.entries(by).map(([v, ps]) => [v, {med: median(ps), n: ps.length}]));
}
window.compareIds = [];
async function renderCompare() {
  const vehicles = await wikiData("vehicles") || [], picked = compareIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean);
  $("#compare").hidden = !picked.length;
  if (!picked.length) return;
  const tuning = [...cart.values()].reduce((a, c) => a + c.mount, 0);
  const row = (label, f) => `<tr><th>${label}</th>${picked.map(v => `<td>${f(v)}</td>`).join("")}</tr>`;
  $("#compare-table").innerHTML = `<tr><th></th>${picked.map(v => `<th>${esc(v.name)}</th>`).join("")}</tr>` +
    row("Napęd", v => esc(v.drive || "—")) + row("Miejsca", v => v.seats ?? "—") + row("V-max (po UP1)", v => vmax(v) ? vmax(v) + " km/h" : "—") +
    row("Cena w salonie od", v => fmtPln(minPrice(v))) + row("Salon", v => esc((engineList(v).find(([, e]) => e.price) || [, {}])[1].location || "—")) +
    row("Typowo na giełdzie", v => marketStats[v.name] ? fmtPln(marketStats[v.name].med) : "—") +
    (tuning ? row("Salon + tuning z koszyka", v => fmtPln(minPrice(v) + tuning)) : "");
}
$("#veh-list").addEventListener("click", e => {
  const w = e.target.closest("[data-watch]"), c = e.target.closest("[data-cmp]");
  if (w) {
    const id = +w.dataset.watch, list = user.watch ??= [];
    list.includes(id) ? list.splice(list.indexOf(id), 1) : list.push(id);
    save(); renderVehicles();
  }
  if (c) {
    const id = +c.dataset.cmp;
    compareIds = compareIds.includes(id) ? compareIds.filter(x => x !== id) : [...compareIds, id].slice(-3);
    renderVehicles(); renderCompare();
  }
});
$("#compare-clear").onclick = () => { compareIds = []; renderVehicles(); renderCompare(); };
const prevVehTab = WIKI_TABS.pojazdy;
WIKI_TABS.pojazdy = async () => { await loadMarketStats(); await prevVehTab(); renderCompare(); };

// ---------- eksport zarobków do CSV ----------
$("#csv-btn").onclick = async () => {
  const q = v => `"${String(v).replace(/"/g, '""')}"`, d = ts => new Date(ts * 1000);
  const rows = [["Data", "Godzina", "Rodzaj", "Kwota PLN", "LP"].map(q).join(";")].concat(
    hist.events.filter(e => e.t === "pay" || e.t === "bonus").map(e => [d(e.ts).toLocaleDateString("pl-PL"), d(e.ts).toLocaleTimeString("pl-PL"),
      e.t === "bonus" ? "Bonus" : "Wypłata", String(e.v).replace(".", ","), e.lp || ""].map(q).join(";")));
  const p = await api.save_text(`zarobki-${new Date().toLocaleDateString("sv")}.csv`, rows.join("\r\n"));
  if (p) $("#report-info").textContent = "Zapisano: " + p;
};

// ---------- dziennik ----------
function renderJournal() {
  const q = $("#j-q").value.trim().toLowerCase(), list = user.journal ??= [];
  $("#j-list").innerHTML = list.map((j, i) => [j, i]).filter(([j]) => !q || j.text.toLowerCase().includes(q)).reverse()
    .map(([j, i]) => `<li class="panel"><div class="j-head"><span class="muted">${day(j.ts)} ${hm(j.ts)}</span><button class="btn small" data-del-j="${i}">Usuń</button></div><p>${esc(j.text)}</p></li>`).join("")
    || `<li class="empty">${list.length ? "Nic nie znaleziono" : "Brak wpisów. Zapisz pierwszy powyżej."}</li>`;
}
$("#j-form").onsubmit = e => {
  e.preventDefault();
  const text = $("#j-text").value.trim();
  if (!text) return;
  (user.journal ??= []).push({ts: Date.now() / 1000, text: text.slice(0, 5000)});
  $("#j-text").value = "";
  save(); renderJournal();
};
$("#j-q").oninput = renderJournal;
$("#j-list").onclick = e => { const i = e.target.dataset.delJ; if (i != null && confirm("Usunąć ten wpis?")) { user.journal.splice(+i, 1); save(); renderJournal(); } };
FEATURE_TABS.dziennik = renderJournal;

// ---------- cele dzienne ----------
function renderGoals() {
  const g = user.daily ??= {}, today = dayKey(Date.now() / 1000), d = (byDay().find(x => x[0] === today) || [0, {pay: 0, bonus: 0, time: 0}])[1];
  const bar = (label, have, goal, fmt) => goal ? `<div class="goal-row"><span>${label}: <b>${fmt(have)}</b> z ${fmt(goal)}</span><div class="goal-bar"><i style="width:${Math.min(100, have / goal * 100)}%"></i></div></div>` : "";
  $("#daily-goals").innerHTML = bar("Czas gry dziś", d.time, g.hours * 3600, dur) + bar("Zarobek dziś", d.pay + d.bonus, g.money, pln);
}
const prevSettings2 = FEATURE_TABS.ustawienia;
FEATURE_TABS.ustawienia = () => {
  prevSettings2(); renderCarAlerts();
  $("#n-events").checked = settings().events !== false;
  $("#g-hours").value = user.daily?.hours || ""; $("#g-money").value = user.daily?.money || "";
};
$("#n-events").onchange = () => { settings().events = $("#n-events").checked; save(); };
$("#g-hours").onchange = $("#g-money").onchange = () => {
  user.daily = {hours: parseFloat($("#g-hours").value.replace(",", ".")) || 0, money: +$("#g-money").value.replace(/\D/g, "") || 0};
  save(); renderGoals();
};

// podpowiedzi nazw pojazdów (alerty, cel zakupowy) od startu
document.addEventListener("data", async function fillNames() {
  document.removeEventListener("data", fillNames);
  const vehicles = await wikiData("vehicles");
  if (vehicles && !$("#veh-names").children.length) $("#veh-names").innerHTML = vehicles.map(v => `<option value="${esc(v.name)}">`).join("");
});
