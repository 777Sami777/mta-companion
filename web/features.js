// Giełda z czatu, statystyki (wykresy), cel zakupowy, serie pracy, powiadomienia i widżet.
// Korzysta z danych app.js (hist, srv, user, friends) i wiki.js (wikiData, minPrice, engineList).

// ---------- Giełda: ogłoszenia GO> z logów ----------
const SELL = /\b(s\/?w|sell|sprzedam|sprzedaje|sprzedaż|zamienie|zamiana)\b|\[s/i;
const BUY = /\b(kupie|kupię|kupuje|kupuję|skup|szukam|buy)\b/i;
let ads = null, adKind = "";

// pierwszy pasujący pojazd z wiki w treści ogłoszenia (najdłuższe nazwy najpierw: "Sultan RS" przed "Sultan")
function adVehicle(text, vehicles) {
  const t = " " + text.toLowerCase() + " ";
  return vehicles.find(v => t.includes(" " + v.name.toLowerCase() + " ") || t.includes(" " + v.name.toLowerCase() + ","));
}

async function renderMarket() {
  ads ??= await api.market();
  const vehicles = ((await wikiData("vehicles")) || []).slice().sort((a, b) => b.name.length - a.name.length);
  const q = $("#ad-q").value.trim().toLowerCase();
  const rows = ads.filter(a => (!adKind || (adKind === "sell" ? SELL.test(a.text) : BUY.test(a.text))) &&
    (!q || a.text.toLowerCase().includes(q) || a.nick.toLowerCase().includes(q)));
  $("#ad-info").textContent = `${rows.length} z ${ads.length} ogłoszeń${rows.length > 300 ? " · pokazane najnowsze 300" : ""}`;
  $("#ad-list").innerHTML = table([["Kiedy"], ["Gracz"], ["Ogłoszenie"], ["Cena w salonie", "n"]], rows.slice(0, 300).map(a => {
    const v = adVehicle(a.text, vehicles), p = v && minPrice(v);
    return `<tr><td>${day(a.ts)} ${hm(a.ts)}</td><td>${esc(a.nick)} <small class="muted">(${esc(a.id)})</small></td><td>${esc(a.text)}</td>
      <td class="n">${v ? `${esc(v.name)}${isFinite(p) ? "<br><b>" + fmtPln(p) + "</b>" : ""}` : ""}</td></tr>`;
  }));
}
$("#ad-q").oninput = renderMarket;
$("#ad-kind").onclick = e => {
  const b = e.target.closest("[data-k]");
  if (!b) return;
  adKind = b.dataset.k;
  $("#ad-kind").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === b));
  renderMarket();
};

// ---------- wykresy (SVG, jedna seria na wykres, podpowiedź po najechaniu) ----------
function lineChart(el, points, fmt) {
  if (points.length < 2) { el.innerHTML = `<p class="empty">Za mało danych. Wykres uzupełni się sam, gdy aplikacja będzie włączona.</p>`; return; }
  const W = 520, H = 150, P = {l: 8, r: 8, t: 12, b: 20};
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.1 || 1;
  const X = t => P.l + (t - x0) / (x1 - x0 || 1) * (W - P.l - P.r), Y = v => P.t + (hi + pad - v) / (hi - lo + 2 * pad) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Wykres">
    <line x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}" class="axis"/>
    <path d="${d}" class="line"/><g class="hover" hidden><line class="cross" y1="${P.t}" y2="${H - P.b}"/><circle r="4"/></g>
    <text x="${P.l}" y="${H - 5}" class="tick">${day(x0)} ${hm(x0)}</text><text x="${W - P.r}" y="${H - 5}" class="tick end">${day(x1)} ${hm(x1)}</text>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" class="hit"/></svg><div class="tip" hidden></div>`;
  const svg = el.querySelector("svg"), g = el.querySelector(".hover"), tip = el.querySelector(".tip");
  svg.onpointermove = e => {
    const r = svg.getBoundingClientRect(), t = x0 + ((e.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r) * (x1 - x0);
    const p = points.reduce((a, b) => Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a);
    g.hidden = tip.hidden = false;
    g.querySelector("line").setAttribute("x1", X(p[0])); g.querySelector("line").setAttribute("x2", X(p[0]));
    g.querySelector("circle").setAttribute("cx", X(p[0])); g.querySelector("circle").setAttribute("cy", Y(p[1]));
    tip.textContent = `${day(p[0])} ${hm(p[0])} · ${fmt(p[1])}`;
    tip.style.left = Math.min(r.width - 150, Math.max(0, X(p[0]) / W * r.width - 60)) + "px";
  };
  svg.onpointerleave = () => { g.hidden = tip.hidden = true; };
}

function barChart(el, bars, fmt) {
  const W = 720, H = 170, P = {l: 4, r: 4, t: 10, b: 22}, max = Math.max(1, ...bars.map(b => b.v || 0));
  const bw = (W - P.l - P.r) / bars.length;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Średnia liczba graczy w godzinach">
    ${bars.map((b, i) => {
      const h = (b.v || 0) / max * (H - P.t - P.b), x = P.l + i * bw;
      return `<g class="bar" data-i="${i}"><rect x="${x}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" fill="transparent"/>
        ${b.v ? `<path d="M${x + 1},${H - P.b} v${-(h - 4)} q0,-4 4,-4 h${bw - 10} q4,0 4,4 v${h - 4} z" class="${b.now ? "bar-now" : "bar-fill"}"/>` : ""}
        ${i % 3 === 0 ? `<text x="${x + bw / 2}" y="${H - 6}" class="tick mid">${b.label}</text>` : ""}</g>`;
    }).join("")}</svg><div class="tip" hidden></div>`;
  const tip = el.querySelector(".tip");
  el.querySelectorAll(".bar").forEach(g => {
    g.onpointerenter = () => { const b = bars[g.dataset.i]; tip.hidden = false; tip.textContent = `${b.label}:00 · ${b.v ? fmt(b.v) : "brak danych"}`; tip.style.left = Math.min(el.clientWidth - 170, g.dataset.i / bars.length * el.clientWidth) + "px"; };
    g.onpointerleave = () => { tip.hidden = true; };
  });
}

let lastPrices = null;
async function renderStats() {
  const d = lastPrices || await api.prices();
  if (d) {
    $("#price-charts").innerHTML = d.items.map(p => `<div class="panel"><h2>${esc(p.name)} <small>${esc(p.unit)}</small></h2><div class="stat-mini" id="pc-${esc(p.id)}-s"></div><div class="chart" id="pc-${esc(p.id)}"></div></div>`).join("");
    d.items.forEach(p => {
      const pts = (d.history || []).filter(h => h.p[p.id] != null).map(h => [h.ts, h.p[p.id]]);
      pts.push([Date.now() / 1000, p.price]);
      const vals = pts.map(x => x[1]);
      // najlepsza godzina sprzedaży: najwyższa średnia cena w danej godzinie dnia
      const byHour = {};
      pts.forEach(([t, v]) => (byHour[new Date(t * 1000).getHours()] ??= []).push(v));
      const best = Object.entries(byHour).map(([h, a]) => [h, a.reduce((s, x) => s + x, 0) / a.length]).sort((a, b) => b[1] - a[1])[0];
      $(`#pc-${p.id}-s`).innerHTML = `Teraz <b>${price(p.price)}</b> · min ${price(Math.min(...vals))} · max ${price(Math.max(...vals))}${best && Object.keys(byHour).length > 3 ? ` · najdrożej ok. ${best[0]}:00` : ""}`;
      lineChart($(`#pc-${p.id}`), pts, v => price(v) + " " + p.unit);
    });
  }
  const ph = await api.players_history();
  const hours = Array.from({length: 24}, (_, h) => ({label: String(h).padStart(2, "0"), sum: 0, n: 0, now: h === new Date().getHours()}));
  ph.forEach(([t, v]) => { const h = hours[new Date(t * 1000).getHours()]; h.sum += v; h.n++; });
  hours.forEach(h => h.v = h.n ? Math.round(h.sum / h.n) : 0);
  const peak = hours.reduce((a, b) => b.v > a.v ? b : a);
  $("#players-info").textContent = ph.length ? `Średnia liczba graczy w każdej godzinie z ${Math.ceil((Date.now() / 1000 - ph[0][0]) / 86400)} dni · szczyt ok. ${peak.label}:00 (${peak.v})` : "Zbieram dane: liczba graczy zapisuje się co 5 minut, gdy aplikacja jest włączona.";
  barChart($("#players-chart"), hours, v => v + " graczy");
}
document.addEventListener("prices", e => { lastPrices = e.detail; if ($("#statystyki").classList.contains("on")) renderStats(); });

// ---------- Zarobki: serie pracy i cel zakupowy ----------
function workRuns() {
  const pays = hist.events.filter(e => e.t === "pay"), jobs = hist.events.filter(e => e.t === "job"), runs = [];
  for (const p of pays) {
    const r = runs.at(-1);
    if (r && p.ts - r.end <= 20 * 60) { r.end = p.ts; r.sum += p.v; r.n++; } else runs.push({start: p.ts, end: p.ts, sum: p.v, n: 1});
  }
  // co najmniej 3 wypłaty i 10 minut: dwie wypłaty w tej samej minucie dawały absurdalne "miliony na godzinę"
  return runs.filter(r => r.n >= 3 && r.end - r.start >= 600).map(r => {
    const gap = (r.end - r.start) / (r.n - 1); // pierwsza wypłata też wymagała pracy: doliczamy średni odstęp
    const job = jobs.filter(j => j.ts <= r.start && r.start - j.ts < 30 * 60).at(-1);
    return {...r, perH: r.sum / ((r.end - r.start + gap) / 3600), job: job ? "Praca " + job.v : "—"};
  }).reverse();
}

function avgPerHour() {
  const now = Date.now() / 1000, wk = hist.events.filter(e => (e.t === "pay" || e.t === "bonus") && now - e.ts < 7 * 86400);
  const time = hist.sessions.filter(s => now - s.start < 7 * 86400).reduce((a, s) => a + s.end - s.start, 0);
  return time ? wk.reduce((a, e) => a + e.v, 0) / (time / 3600) : 0;
}

async function renderEarnExtra() {
  $("#earn-runs").innerHTML = table([["Kiedy"], ["Praca"], ["Wypłat", "n"], ["Razem", "n"], ["Na godzinę", "n"]], workRuns().slice(0, 15).map(r =>
    `<tr><td>${day(r.start)} ${hm(r.start)}–${hm(r.end)}</td><td>${esc(r.job)}</td><td class="n">${r.n}</td><td class="n">${pln(r.sum)}</td><td class="n"><b>${pln(r.perH)}</b></td></tr>`));
  const vehicles = await wikiData("vehicles");
  if (!vehicles) return;
  if (!$("#veh-names").children.length) $("#veh-names").innerHTML = vehicles.map(v => `<option value="${esc(v.name)}">`).join("");
  const goal = user.goal ??= {};
  $("#goal-veh").value ||= goal.veh || "";
  $("#goal-have").value ||= goal.have || "";
  const v = vehicles.find(x => x.name.toLowerCase() === $("#goal-veh").value.trim().toLowerCase());
  const priced = v ? engineList(v).filter(([, e]) => e.price) : [];
  $("#goal-eng").innerHTML = priced.map(([n, e]) => `<option value="${esc(n)}" ${n === goal.eng ? "selected" : ""}>${esc(n)} · ${fmtPln(e.price)}</option>`).join("") || `<option>wybierz pojazd</option>`;
  const eng = priced.find(([n]) => n === $("#goal-eng").value);
  if (!eng) { $("#goal-out").innerHTML = `<p class="empty">Wpisz pojazd z listy podpowiedzi i ile masz pieniędzy.</p>`; return; }
  const have = +($("#goal-have").value.replace(/\D/g, "")) || 0, left = Math.max(0, eng[1].price - have), perH = avgPerHour();
  const pct = Math.min(100, have / eng[1].price * 100);
  $("#goal-out").innerHTML = `<div class="goal-bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    <p>${left ? `Brakuje <b>${pln(left)}</b>${perH ? ` · przy Twoim średnim zarobku (${pln(perH)}/h z 7 dni) to ok. <b>${dur(left / perH * 3600)}</b> gry` : ""}` : "<b>Stać Cię!</b>"}
    · salon: ${esc(eng[1].location || "—")}</p>`;
}
["#goal-veh", "#goal-eng", "#goal-have"].forEach(s => $(s).addEventListener("change", () => {
  user.goal = {veh: $("#goal-veh").value.trim(), eng: $("#goal-eng").value, have: $("#goal-have").value.trim()};
  save(); renderEarnExtra();
}));
document.addEventListener("data", () => { if ($("#zarobki").classList.contains("on")) renderEarnExtra(); });

// ---------- powiadomienia ----------
const notified = new Set(); // co już zgłoszono w tej sesji aplikacji
let prevOnline = null;

function settings() { return user.notify ??= {friends: true, bonus: true, prices: {}}; }

document.addEventListener("data", () => {
  const n = settings(), now = Date.now() / 1000;
  const online = new Set(friends().filter(f => f.live).map(f => f.nick));
  if (prevOnline && n.friends) online.forEach(nick => { if (!prevOnline.has(nick)) api.notify("Znajomy w grze", `${nick} właśnie wszedł na serwer`); });
  prevOnline = online;
  // bonus Premium+ wpada co pełną godzinę gry: następny = ostatni + 60 min, jeśli wciąż grasz
  const last = hist.sessions.at(-1), bonus = hist.events.filter(e => e.t === "bonus").at(-1);
  if (n.bonus && bonus && last && now - last.end < 120 && bonus.ts >= last.start) {
    const next = bonus.ts + 3600, key = "bonus" + next;
    if (next - now <= 300 && next > now && !notified.has(key)) { notified.add(key); api.notify("Bonus za 5 minut", "Nie wychodź z gry, za chwilę wpadnie bonus godzinowy"); }
  }
});

document.addEventListener("prices", e => {
  const lim = settings().prices || {};
  e.detail.items.forEach(p => {
    const key = "price" + p.id + new Date().toDateString();
    if (lim[p.id] && p.price >= lim[p.id] && !notified.has(key)) { notified.add(key); api.notify(`${p.name}: ${price(p.price)} ${p.unit}`, `Cena przekroczyła Twój próg ${price(lim[p.id])}`); }
  });
  renderSettings(e.detail);
});

function renderSettings(d) {
  const n = settings();
  $("#n-friends").checked = n.friends; $("#n-bonus").checked = n.bonus;
  if (d && !$("#n-prices").children.length) $("#n-prices").innerHTML = d.items.map(p => `<label class="alert">${esc(p.name)} <input type="text" inputmode="decimal" data-id="${esc(p.id)}" value="${n.prices[p.id] ?? ""}" placeholder="np. ${price(p.price * 1.1)}" aria-label="Próg ceny: ${esc(p.name)}"> ${esc(p.unit)}</label>`).join("");
}
$("#n-friends").onchange = $("#n-bonus").onchange = () => { Object.assign(settings(), {friends: $("#n-friends").checked, bonus: $("#n-bonus").checked}); save(); };
$("#n-prices").onchange = e => {
  const id = e.target.dataset.id, v = parseFloat(e.target.value.replace(",", "."));
  if (!id) return;
  if (v > 0) settings().prices[id] = v; else delete settings().prices[id];
  save();
};
$("#n-test").onclick = () => api.notify("4Life Companion", "Tak wyglądają powiadomienia aplikacji");

// ---------- widżet nad grą ----------
$("#widget-btn").onclick = async () => { const open = await api.open_widget(); $("#widget-btn").textContent = open ? "Zamknij widżet" : "Widżet nad grą"; };

// zakładki ładowane przy otwarciu
let FEATURE_TABS = {gielda: renderMarket, statystyki: renderStats, zarobki: renderEarnExtra, ustawienia: () => renderSettings(lastPrices)};
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => FEATURE_TABS[b.dataset.tab]?.()));

// ---------- ceny aut z ogłoszeń ----------
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
async function renderCarPrices() {
  const [hist, vehicles] = await Promise.all([api.car_prices(), wikiData("vehicles")]);
  const by = {}, salonOf = v => { const veh = (vehicles || []).find(x => x.name === v); return veh ? minPrice(veh) : Infinity; };
  // odrzucamy kwoty od czapy (części, ID, literówki): poza zakresem 10% – 10× ceny salonu
  hist.filter(h => h.s).forEach(h => { const sp = salonOf(h.v); if (!isFinite(sp) || (h.p >= sp * 0.1 && h.p <= sp * 10)) (by[h.v] ??= []).push(h.p); });
  const q = $("#ad-q").value.trim().toLowerCase();
  const rows = Object.entries(by).filter(([v, ps]) => ps.length >= 2 && (!q || v.toLowerCase().includes(q))).sort((a, b) => b[1].length - a[1].length).slice(0, 15);
  $("#car-prices").innerHTML = table([["Pojazd"], ["Ogłoszeń", "n"], ["Typowa cena", "n"], ["Od – do", "n"], ["W salonie", "n"]], rows.map(([v, ps]) => {
    const veh = (vehicles || []).find(x => x.name === v), salon = veh && minPrice(veh);
    return `<tr class="click" data-v="${esc(v)}"><td><b>${esc(v)}</b></td><td class="n">${ps.length}</td><td class="n"><b>${fmtPln(median(ps))}</b></td>
      <td class="n">${fmtPln(Math.min(...ps))} – ${fmtPln(Math.max(...ps))}</td><td class="n">${veh && isFinite(salon) ? fmtPln(salon) : "—"}</td></tr>`;
  }));
}
$("#car-prices").onclick = e => { const r = e.target.closest("[data-v]"); if (r) { $("#ad-q").value = r.dataset.v; renderMarket(); renderCarPrices(); } };
$("#ad-q").addEventListener("input", renderCarPrices);

// ---------- powiadomienia z giełdy ----------
let lastAdTs = null;
document.addEventListener("data", async () => {
  const words = (settings().ads || "").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return;
  const list = await api.market();
  if (lastAdTs === null) { lastAdTs = list[0]?.ts || 0; return; } // przy starcie nie zgłaszamy starych ogłoszeń
  list.filter(a => a.ts > lastAdTs && words.some(w => a.text.toLowerCase().includes(w))).slice(0, 3)
    .forEach(a => api.notify(`Giełda: ${a.nick}`, a.text));
  lastAdTs = Math.max(lastAdTs, list[0]?.ts || 0);
  ads = list; // zakładka Giełda pokaże świeże ogłoszenia
});
$("#n-ads").onchange = () => { settings().ads = $("#n-ads").value; save(); };

// ---------- kopia zapasowa ----------
$("#bk-export").onclick = async () => { const p = await api.export_backup(); if (p) $("#bk-info").textContent = "Zapisano: " + p; };
$("#bk-import").onclick = async () => {
  if (!confirm("Wczytanie kopii zastąpi obecną historię, znajomych i ustawienia. Kontynuować?")) return;
  const r = await api.import_backup();
  if (r.ok) { $("#bk-info").textContent = `Wczytano ${r.files} plików, odświeżam…`; setTimeout(() => location.reload(), 800); }
  else if (r.error) $("#bk-info").textContent = r.error;
};

// ---------- raport tygodnia jako obrazek ----------
$("#report-btn").onclick = async () => {
  const now = Date.now() / 1000, wk = 7 * 86400;
  const money = hist.events.filter(e => (e.t === "pay" || e.t === "bonus") && now - e.ts < wk).reduce((a, e) => a + e.v, 0);
  const time = hist.sessions.filter(s => now - s.start < wk).reduce((a, s) => a + s.end - s.start, 0);
  const days = byDay().filter(d => now - d[1].ts < wk), best = days.reduce((a, d) => (d[1].pay + d[1].bonus) > (a ? a[1].pay + a[1].bonus : -1) ? d : a, null);
  const run = workRuns().filter(r => now - r.start < wk).sort((a, b) => b.perH - a.perH)[0];
  const c = document.createElement("canvas"), W = 900, H = 500, g = c.getContext("2d");
  c.width = W; c.height = H;
  g.fillStyle = "#0a1424"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#f59e0b"; g.fillRect(0, 0, 8, H);
  g.font = "700 44px Barlow, Bahnschrift, sans-serif"; g.fillText("RAPORT TYGODNIA", 50, 80);
  g.fillStyle = "#8d9bb3"; g.font = "500 20px Manrope, Segoe UI, sans-serif";
  g.fillText(`${day(now - wk + 86400)} – ${day(now)} · 4Life MTA`, 50, 115);
  const tiles = [[pln(money), "zarobione"], [dur(time), "czasu gry"], [time ? pln(money / (time / 3600)) : "—", "średnio na godzinę"],
    [best ? pln(best[1].pay + best[1].bonus) : "—", best ? "najlepszy dzień: " + day(best[1].ts) : "najlepszy dzień"],
    [run ? pln(run.perH) : "—", "najlepsza seria pracy / h"], [String(hist.events.filter(e => e.t === "pay" && now - e.ts < wk).length), "wypłat"]];
  tiles.forEach(([v, l], i) => {
    const x = 50 + (i % 3) * 275, y = 160 + Math.floor(i / 3) * 150;
    g.fillStyle = "#0f1d33"; g.beginPath(); g.roundRect(x, y, 255, 125, 10); g.fill();
    g.fillStyle = "#e9eff8"; g.font = "700 36px Barlow, Bahnschrift, sans-serif"; g.fillText(v, x + 20, y + 62);
    g.fillStyle = "#8d9bb3"; g.font = "500 17px Manrope, Segoe UI, sans-serif"; g.fillText(l, x + 20, y + 98);
  });
  g.fillStyle = "#8d9bb3"; g.font = "500 15px Manrope, Segoe UI, sans-serif"; g.fillText("4Life Companion", 50, H - 25);
  const url = c.toDataURL("image/png");
  try { await navigator.clipboard.write([new ClipboardItem({"image/png": await (await fetch(url)).blob()})]); $("#report-info").textContent = "Skopiowano do schowka: wklej na Discordzie (Ctrl+V)."; } catch { $("#report-info").textContent = ""; }
  const p = await api.save_image(url, `raport-${new Date().toLocaleDateString("sv")}.png`);
  if (p) $("#report-info").textContent += " Zapisano: " + p;
};

FEATURE_TABS.gielda = () => { renderMarket(); renderCarPrices(); };
FEATURE_TABS.ustawienia = () => { renderSettings(lastPrices); $("#n-ads").value = settings().ads || ""; };
