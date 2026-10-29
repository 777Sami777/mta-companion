// Podsumowanie sesji, statystyki z logów, czat, zrzuty ekranu, ustawienia aplikacji, jasny motyw i wersja angielska.

// ---------- podsumowanie po wyjściu z gry ----------
let wasInGame = null;
document.addEventListener("data", () => {
  const now = Date.now() / 1000, last = hist.sessions.at(-1), inGame = !!last && now - last.end < 120;
  if (wasInGame && !inGame && settings().session !== false && last.end - last.start > 300) {
    const ev = hist.events.filter(e => e.ts >= last.start && e.ts <= last.end), money = ev.filter(e => e.t === "pay" || e.t === "bonus").reduce((a, e) => a + e.v, 0);
    api.notify("Koniec sesji", `${dur(last.end - last.start)} gry · zarobiłeś ${pln(money)} · ${ev.filter(e => e.t === "pay").length} wypłat`);
  }
  wasInGame = inGame;
  if ($("#statystyki").classList.contains("on")) renderLogStats();
});

// ---------- statystyki z logów ----------
function renderLogStats() {
  const n = t => hist.events.filter(e => e.t === t).length;
  $("#log-stats").innerHTML = stat(n("afk"), "Kicków za AFK") + stat(n("exam_fail"), "Oblanych egzaminów") + stat(n("ticket"), "Opłaconych parkingów") +
    stat(n("shot"), "Zrobionych zrzutów") + stat(hist.sessions.length, "Sesji w historii") + stat(n("friend"), "Wejść i wyjść znajomych");
}
FEATURE_TABS.statystyki = () => { renderStats(); renderLogStats(); };

// ---------- czat ----------
let chatKind = "", chatTimer;
async function renderChat() {
  const list = await api.chat($("#chat-q").value.trim(), chatKind);
  $("#chat-list").innerHTML = list.map(c => `<li class="c-${c.k}"><span class="muted">${day(c.ts)} ${hm(c.ts)}</span><span>${esc(c.text)}</span></li>`).join("")
    || `<li class="empty">Nic nie znaleziono</li>`;
}
$("#chat-q").oninput = () => { clearTimeout(chatTimer); chatTimer = setTimeout(renderChat, 250); };
$("#chat-kind").onclick = e => {
  const b = e.target.closest("[data-k]");
  if (!b) return;
  chatKind = b.dataset.k;
  $("#chat-kind").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === b));
  renderChat();
};
FEATURE_TABS.czat = renderChat;

// ---------- zrzuty ekranu ----------
const shotObserver = new IntersectionObserver(entries => entries.forEach(async e => {
  if (!e.isIntersecting) return;
  shotObserver.unobserve(e.target);
  const src = await api.screenshot_thumb(e.target.dataset.shot);
  if (src) e.target.src = src;
}), {rootMargin: "300px"});
async function renderShots() {
  const list = await api.screenshots();
  $("#shots-info").textContent = list.length ? `${list.length} zrzutów z MTA (F12 w grze) · kliknij, żeby otworzyć` : "Brak zrzutów. W grze zrobisz je klawiszem F12.";
  $("#shots-list").innerHTML = list.map(s => `<li class="card"><button class="card-img shot" data-open="${esc(s.name)}" aria-label="Otwórz zrzut z ${day(s.ts)} ${hm(s.ts)}"><img data-shot="${esc(s.name)}" alt=""></button>
    <div class="card-body"><span class="meta">${day(s.ts)} ${hm(s.ts)}</span></div></li>`).join("");
  $("#shots-list").querySelectorAll("img[data-shot]").forEach(i => shotObserver.observe(i));
}
$("#shots-list").onclick = e => { const b = e.target.closest("[data-open]"); if (b) api.open_screenshot(b.dataset.open); };
$("#shots-folder").onclick = () => api.open_shots_folder();
FEATURE_TABS.zrzuty = renderShots;

// ---------- ustawienia aplikacji ----------
const appSet = () => user.app ??= {tray: true, light: false, lang: "pl"};
async function renderAppSettings() {
  const a = appSet();
  $("#s-tray").checked = a.tray !== false; $("#s-light").checked = !!a.light; $("#s-lang").value = a.lang || "pl";
  $("#n-session").checked = settings().session !== false;
  $("#s-auto").checked = await api.get_autostart();
}
$("#s-tray").onchange = () => { appSet().tray = $("#s-tray").checked; save(); };
$("#s-auto").onchange = async () => {
  if (!await api.set_autostart($("#s-auto").checked)) { $("#s-auto").checked = false; alert("Start z Windows działa w zainstalowanej wersji aplikacji (.exe)."); }
};
$("#s-light").onchange = () => { appSet().light = $("#s-light").checked; save(); applyTheme(); };
$("#s-lang").onchange = () => { appSet().lang = $("#s-lang").value; save(); location.reload(); };
$("#n-session").onchange = () => { settings().session = $("#n-session").checked; save(); };
const prevSettingsTab = FEATURE_TABS.ustawienia;
FEATURE_TABS.ustawienia = () => { prevSettingsTab(); renderAppSettings(); };
const applyTheme = () => document.documentElement.classList.toggle("light", !!appSet().light);

// ---------- wersja angielska: tłumaczenie tekstów interfejsu (dane z wiki i czatu zostają po polsku) ----------
const EN = {
  "Dziś": "Today", "Zarobki": "Earnings", "Sesje": "Sessions", "Znajomi": "Friends", "Giełda": "Market", "Statystyki": "Statistics",
  "Czat": "Chat", "Zrzuty ekranu": "Screenshots", "Pojazdy": "Vehicles", "Tuning": "Tuning", "Prace dorywcze": "Side jobs", "Mapa": "Map",
  "Serwer": "Server", "Ustawienia": "Settings", "Widżet nad grą": "Overlay widget", "Zamknij widżet": "Close widget", "Sprawdź aktualizacje": "Check for updates",
  "Dane zostają na tym komputerze": "Your data stays on this computer", "Znajomi online": "Friends online", "Ostatnie wypłaty": "Recent payouts",
  "Ceny surowców": "Commodity prices", "Czas gry dziś": "Play time today", "Zarobek dziś": "Earned today", "Wypłat dziś": "Payouts today", "LP dziś": "LP today",
  "Obecna sesja": "Current session", "Nie grasz": "Not playing", "Graczy na serwerze": "Players on server", "Nikt ze znajomych nie gra": "No friends online",
  "Brak wypłat w logach": "No payouts in logs", "Wypłata": "Payout", "Bonus godzinowy": "Hourly bonus", "Zarobek 7 dni": "Earned in 7 days",
  "Średnio na godzinę": "Average per hour", "Razem w historii": "Total in history", "LP razem": "LP total", "Dzień po dniu": "Day by day",
  "Dzień": "Day", "Wypłaty": "Payouts", "Liczba": "Count", "Bonusy": "Bonuses", "Czas gry": "Play time", "Na godzinę": "Per hour",
  "Cel zakupowy": "Purchase goal", "Serie pracy": "Work streaks", "Kiedy": "When", "Praca": "Job", "Wypłat": "Payouts", "Razem": "Total",
  "Raport tygodnia (obrazek)": "Weekly report (image)", "Gra w 7 dni": "Played in 7 days", "Sesji w historii": "Sessions in history",
  "Średnia sesja": "Average session", "Kicków za AFK": "AFK kicks", "Od": "From", "Do": "To", "Długość": "Length", "Zarobek": "Earned",
  "Dodaj": "Add", "Usuń": "Remove", "Online": "Online", "Offline": "Offline", "Wszystkie": "All", "Sprzedam": "Selling", "Kupię": "Buying",
  "Gracz": "Player", "Ogłoszenie": "Listing", "Cena w salonie": "Dealer price", "Ceny aut z ogłoszeń": "Car prices from listings", "Pojazd": "Vehicle",
  "Ogłoszeń": "Listings", "Typowa cena": "Typical price", "Od – do": "Range", "W salonie": "At dealer", "Gracze na serwerze": "Players on server",
  "Z Twoich logów": "From your logs", "Oblanych egzaminów": "Failed exams", "Opłaconych parkingów": "Paid parking", "Zrobionych zrzutów": "Screenshots taken",
  "Wejść i wyjść znajomych": "Friend joins and leaves", "Wszystko": "All", "Prywatne": "Private", "Globalny": "Global", "Komunikaty": "Messages",
  "Otwórz folder": "Open folder", "Aplikacja": "App",
  "Krzyżyk chowa aplikację do ikony przy zegarze (statystyki i powiadomienia działają dalej)": "Close button hides the app to the tray (stats and notifications keep running)",
  "Uruchamiaj z Windows (od razu przy zegarze)": "Start with Windows (straight to the tray)", "Jasny motyw": "Light theme", "Powiadomienia Windows": "Windows notifications",
  "Znajomy wszedł do gry": "Friend joined the game", "5 minut do bonusu godzinowego (Premium)": "5 minutes to hourly bonus (Premium)",
  "Podsumowanie po wyjściu z gry": "Summary after leaving the game", "Cena surowca powyżej": "Commodity price above", "Ogłoszenia na giełdzie": "Market listings",
  "Wyślij próbne powiadomienie": "Send test notification", "Kopia zapasowa": "Backup", "Zapisz kopię…": "Save backup…", "Wczytaj kopię…": "Load backup…",
  "Koszyk": "Cart", "Wyczyść": "Clear", "Wymagania": "Requirements", "Uwagi": "Notes", "Poradnik na forum": "Forum guide", "Samochody": "Cars",
  "Motocykle": "Motorbikes", "Łodzie": "Boats", "Helikoptery": "Helicopters", "Samoloty": "Planes", "Nick": "Nick", "Ping": "Ping", "Gra od": "Playing since",
  "Do znajomych": "Add friend", "Graczy online": "Players online", "Znajomych online": "Friends online", "Brak danych": "No data",
  "Moje znaczniki": "My markers", "Giełdy": "Markets", "Salony i komisy": "Dealers", "Banki i urzędy": "Banks & offices", "Stacje, mechanicy, tuning": "Gas, mechanics, tuning",
  "Prace": "Jobs", "Frakcje": "Factions", "Biznesy": "Businesses", "Inne miejsca": "Other places", "Przystanki": "Bus stops",
};
const EN_PH = {
  "Nick znajomego": "Friend's nick", "Szukaj…": "Search…", "Szukaj pojazdu lub salonu…": "Search vehicle or dealer…", "Szukaj części…": "Search parts…",
  "Szukaj gracza po nicku lub ID…": "Search player by nick or ID…", "Szukaj: Sultan, 2.2, felgi…": "Search: Sultan, 2.2, rims…",
  "Szukaj w czacie: nick, słowo…": "Search chat: nick, word…", "Szukaj na mapie: giełda, SAMD, mechanik…": "Search map: market, SAMD, mechanic…",
  "Pojazd z wiki, np. Sultan": "Vehicle from wiki, e.g. Sultan", "Ile masz teraz (PLN)": "How much you have (PLN)", "np. sultan, infernus, felgi": "e.g. sultan, infernus, rims",
};
function translate(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const t = n.nodeValue.trim(), tr = EN[t];
    if (tr) n.nodeValue = n.nodeValue.replace(t, tr);
    else { const m = t.match(/^(.+?) · (\d+)$/); if (m && EN[m[1]]) n.nodeValue = n.nodeValue.replace(m[1], EN[m[1]]); } // "Giełdy · 8"
  }
  root.querySelectorAll?.("[placeholder]").forEach(i => { const tr = EN_PH[i.placeholder]; if (tr) i.placeholder = tr; });
}
document.addEventListener("data", function once() {
  document.removeEventListener("data", once);
  applyTheme();
  if (appSet().lang === "en") {
    document.documentElement.lang = "en";
    translate(document.body);
    // treści dorysowywane później (tabele, karty) też przechodzą przez słownik
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 ? translate(n) : n.nodeType === 3 && translate(n.parentNode || document.body)))).observe(document.body, {childList: true, subtree: true});
  }
});
