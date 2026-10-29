// Zakładki z danymi wiki serwera: Pojazdy, Tuning, Prace dorywcze.
// Dane i obrazki pobiera Python (api.wiki / api.wiki_img) i trzyma je w %APPDATA%.
const wikiCache = {};
// nieudane pobranie nie zostaje w pamięci, więc kolejne otwarcie zakładki próbuje jeszcze raz
const wikiData = kind => wikiCache[kind] ??= api.wiki(kind).then(d => { if (!d) delete wikiCache[kind]; return d; });
const imgCache = {};
const wikiImg = path => imgCache[path] ??= api.wiki_img(path);
const fmtPln = v => v == null ? "—" : Math.round(v).toLocaleString("pl-PL") + " PLN";
const TYPES = {car: "Samochody", bike: "Motocykle", boat: "Łodzie", heli: "Helikoptery", plane: "Samoloty"};
const noData = what => `<li class="empty">Nie udało się pobrać ${what} z wiki. Sprawdź internet; po pierwszym pobraniu działa też bez sieci.</li>`;

// obrazki ładowane dopiero, gdy są widoczne
const imgObserver = new IntersectionObserver(entries => entries.forEach(async e => {
  if (!e.isIntersecting) return;
  imgObserver.unobserve(e.target);
  const src = await wikiImg(e.target.dataset.img);
  if (src) e.target.src = src; else e.target.classList.add("broken");
}), {rootMargin: "300px"});
const lazyImgs = root => root.querySelectorAll("img[data-img]").forEach(i => imgObserver.observe(i));

// ---------- Pojazdy ----------
const engineList = v => Object.entries(v.engines || {});
const vmax = v => Math.max(0, ...engineList(v).map(([, e]) => e.up1 || e.stock || 0));
const minPrice = v => Math.min(...engineList(v).map(([, e]) => e.price ?? Infinity));
const vehImg = v => `/vehicles/${v.type}s/${v.id}_front.png`;
let vehType = "car";

async function renderVehicles() {
  const list = await wikiData("vehicles");
  if (!list) { $("#veh-list").innerHTML = noData("pojazdów"); opened.delete("pojazdy"); return; }
  const types = [...new Set(list.map(v => v.type))];
  $("#veh-types").innerHTML = types.map(t => `<button class="chip ${t === vehType ? "on" : ""}" style="--c:var(--accent)" data-t="${t}">${TYPES[t] || t} · ${list.filter(v => v.type === t).length}</button>`).join("");
  const q = $("#veh-q").value.trim().toLowerCase();
  const rows = list.filter(v => v.type === vehType && (!q || v.name.toLowerCase().includes(q) || engineList(v).some(([, e]) => (e.location || "").toLowerCase().includes(q))))
    .sort((a, b) => minPrice(a) - minPrice(b));
  $("#veh-info").textContent = `${rows.length} pojazdów · prędkości: fabryczna / po UP1 (km/h) · ceny z salonów`;
  $("#veh-list").innerHTML = rows.map(v => `<li class="card">
      <div class="card-img"><img data-img="${esc(vehImg(v))}" alt="${esc(v.name)}"></div>
      <div class="card-body"><b>${esc(v.name)}</b>
      <div class="meta">${[v.drive, v.seats && v.seats + " miejsca", vmax(v) && "do " + vmax(v) + " km/h"].filter(Boolean).map(esc).join(" · ")}</div>
      <table class="mini">${engineList(v).map(([name, e]) => `<tr><td>${esc(name)}</td><td class="n">${e.stock ? e.stock + " / " + e.up1 : ""}</td><td class="n">${e.price ? fmtPln(e.price) : ""}</td><td>${esc(e.location || "")}</td></tr>`).join("")}</table></div></li>`).join("")
    || `<li class="empty">Brak pojazdów</li>`;
  lazyImgs($("#veh-list"));
}
$("#veh-types").onclick = e => { const b = e.target.closest("[data-t]"); if (b) { vehType = b.dataset.t; renderVehicles(); } };
$("#veh-q").oninput = renderVehicles;

// ---------- Tuning ----------
let tunGroup = null, tunSub = null;
const cart = new Map(); // id -> {name, mount, qty}
const tunImgPath = (g, s, it) => (g === "components" && s !== "components_others") || (g === "parts" && s !== "performance") || g === "custom" ? `/tuning/${g}/${s}/${it.id}.png` : null;

async function renderTuning() {
  const data = await wikiData("tuning");
  if (!data) { $("#tun-list").innerHTML = noData("tuningu"); opened.delete("tuning"); return; }
  tunGroup ??= Object.keys(data)[0];
  const subs = data[tunGroup].sub;
  if (!subs[tunSub]) tunSub = Object.keys(subs)[0];
  $("#tun-groups").innerHTML = Object.entries(data).map(([k, g]) => `<button class="chip ${k === tunGroup ? "on" : ""}" style="--c:var(--accent)" data-g="${k}">${esc(g.title)}</button>`).join("");
  $("#tun-subs").innerHTML = Object.entries(subs).map(([k, s]) => `<button class="chip ${k === tunSub ? "on" : ""}" style="--c:#38bdf8" data-s="${k}">${esc(s.title)} · ${s.items.length}</button>`).join("");
  const q = $("#tun-q").value.trim().toLowerCase();
  // przy wyszukiwaniu szukamy we wszystkich kategoriach
  const items = q ? Object.entries(data).flatMap(([g, gr]) => Object.entries(gr.sub).flatMap(([s, sub]) => sub.items.map(it => [g, s, it]))).filter(([, , it]) => it.name.toLowerCase().includes(q))
    : subs[tunSub].items.map(it => [tunGroup, tunSub, it]);
  $("#tun-list").innerHTML = items.slice(0, 400).map(([g, s, it]) => {
    const img = tunImgPath(g, s, it), color = /^#[0-9a-f]{6}/i.test(it.desc || "") ? it.desc.slice(0, 7) : null;
    const opts = it.variants ? it.variants : [it];
    return `<li class="card">
      <div class="card-img sm">${img ? `<img data-img="${esc(img)}" alt="">` : color ? `<i class="swatch" style="background:${color}"></i>` : ""}</div>
      <div class="card-body"><b>${esc(it.name)}</b>${it.desc && !color ? `<div class="meta">${esc(it.desc)}</div>` : ""}
      ${opts.map(o => `<div class="price-row"><span>${it.variants ? esc(o.name) + " · " : ""}${fmtPln(o.mount)}${o.dismount ? ` <small>demontaż ${fmtPln(o.dismount)}</small>` : ""}</span>
        <button class="btn small" data-add='${esc(JSON.stringify({id: o.id, name: it.variants ? it.name + " " + o.name : it.name, mount: o.mount}))}'>${cart.has(o.id) ? "W koszyku" : "Dodaj"}</button></div>`).join("")}
      </div></li>`;
  }).join("") || `<li class="empty">Brak części</li>`;
  lazyImgs($("#tun-list"));
  renderCart();
}
function renderCart() {
  $("#tun-cart").innerHTML = [...cart.values()].map(c => `<li><span>${esc(c.name)}</span><span>${fmtPln(c.mount)} <button class="btn small" data-del="${c.id}" aria-label="Usuń ${esc(c.name)}">×</button></span></li>`).join("") || `<li class="empty">Dodaj części, żeby policzyć koszt</li>`;
  $("#tun-sum").textContent = cart.size ? "Razem: " + fmtPln([...cart.values()].reduce((a, c) => a + c.mount, 0)) : "";
}
$("#tun-groups").onclick = e => { const b = e.target.closest("[data-g]"); if (b) { tunGroup = b.dataset.g; tunSub = null; renderTuning(); } };
$("#tun-subs").onclick = e => { const b = e.target.closest("[data-s]"); if (b) { tunSub = b.dataset.s; renderTuning(); } };
$("#tun-q").oninput = renderTuning;
$("#tun-list").onclick = e => {
  const b = e.target.closest("[data-add]");
  if (!b) return;
  const it = JSON.parse(b.dataset.add);
  cart.has(it.id) ? cart.delete(it.id) : cart.set(it.id, it);
  b.textContent = cart.has(it.id) ? "W koszyku" : "Dodaj";
  renderCart();
};
$("#tun-cart").onclick = e => { const id = e.target.dataset.del; if (id) { cart.delete(+id); renderTuning(); } };
$("#tun-clear").onclick = () => { cart.clear(); renderTuning(); };

// ---------- Prace dorywcze ----------
const COLS = {poziom: "Poz.", poziomSilnika: "Silnik", poziomZarobkow: "Poz. zarobków", lp: "LP", xp: "XP"};
const variantName = l => l.includes("_") ? l.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" · ") : l;

function levelTable(rows) {
  const keys = Object.keys(COLS).filter(k => rows.some(r => k in r));
  const hasPay = rows.some(r => "premium" in r);
  return `<table class="mini"><tr>${keys.map(k => `<th>${COLS[k]}</th>`).join("")}${hasPay ? `<th class="n">Domyślne / h</th><th class="n">Premium+ / h</th>` : ""}</tr>` +
    rows.map(r => `<tr>${keys.map(k => `<td>${typeof r[k] === "number" && k !== "poziom" && k.length < 3 ? r[k].toLocaleString("pl-PL") : r[k]}</td>`).join("")}${hasPay ? (r.premium
      ? `<td class="n">${fmtPln(r.premium / 1.2)}</td><td class="n">${fmtPln(r.premium)}</td>` : `<td class="n empty" colspan="2">Brak danych</td>`) : ""}</tr>`).join("") + `</table>`;
}

async function renderJobs() {
  const jobs = await wikiData("jobs");
  if (!jobs) { $("#job-list").innerHTML = noData("prac"); opened.delete("prace"); return; }
  $("#job-list").innerHTML = jobs.map((j, ji) => `<li class="card job">
    <div class="card-img wide">${j.img ? `<img data-img="${esc(j.img)}" alt="${esc(j.name)}">` : ""}${j.new ? `<span class="badge">Nowość</span>` : ""}</div>
    <div class="card-body"><b>${esc(j.name)}</b><p>${esc(j.desc)}</p>
    ${j.variants.length > 1 ? `<div class="chips" data-job="${ji}">${j.variants.map((v, i) => `<button class="chip ${i ? "" : "on"}" style="--c:var(--accent)" data-v="${i}">${esc(variantName(v.label))}</button>`).join("")}</div>` : ""}
    <div class="job-table">${j.variants[0] ? levelTable(j.variants[0].rows) : ""}</div>
    <div class="job-foot"><div><span>Wymagania</span>${esc(j.req || "—")}</div><div><span>Uwagi</span>${esc(j.notes || "—")}</div></div>
    ${j.link ? `<button class="btn small" data-link="${esc(j.link)}">Poradnik na forum</button>` : ""}</div></li>`).join("");
  lazyImgs($("#job-list"));
}
$("#job-list").onclick = async e => {
  const v = e.target.closest("[data-v]"), link = e.target.closest("[data-link]");
  if (link) return window.open(link.dataset.link);
  if (!v) return;
  const box = v.closest("[data-job]"), job = (await wikiData("jobs"))[box.dataset.job];
  box.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === v));
  box.nextElementSibling.innerHTML = levelTable(job.variants[v.dataset.v].rows);
};

// ładowanie zakładek przy pierwszym otwarciu
const WIKI_TABS = {pojazdy: renderVehicles, tuning: renderTuning, prace: renderJobs};
const opened = new Set();
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
  const fn = WIKI_TABS[b.dataset.tab];
  if (fn && !opened.has(b.dataset.tab)) { opened.add(b.dataset.tab); fn().catch(() => opened.delete(b.dataset.tab)); }
}));
