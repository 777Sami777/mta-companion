"""4Life Companion: sesje, zarobki, znajomi i mapa dla serwera 4Life MTA (pywebview + WebView2).

Wszystko zostaje na komputerze użytkownika. Czytamy tylko:
- logi, które klient MTA sam zapisuje (MTA\\logs\\console.log*),
- cache zasobów serwera, który MTA już pobrało (mods\\deathmatch\\resources) — w miejscu, bez kopiowania,
- publiczny status serwera (zapytanie ASE, to samo co przeglądarka serwerów w MTA),
- publiczną mapę z wiki serwera (giełdy, salony, prace…), zapamiętaną na dysku na wypadek braku sieci.
Historię zapisujemy w %APPDATA%\\4LifeCompanion. Gra nie jest dotykana.
"""
import datetime as dt
import glob
import json
import base64
import os
import re
import socket
import sys
import time

import webview

import wiki

APP_NAME = "4Life Companion"
APP_VERSION = "1.1.0"
GITHUB_REPO = "777Sami777/mta-companion"  # "login/repozytorium": tu aktualizator szuka najnowszego wydania
EXE_NAME = "4LifeCompanion.exe"
NO_WINDOW = 0x08000000
SERVER = ("s.mta4life.pl", 22110)
APPDATA = os.environ.get("APPDATA", os.path.expanduser("~"))
DATA_DIR = os.path.join(APPDATA, "4LifeCompanion")
OLD_DATA_DIR = os.path.join(APPDATA, "MTACompanion")  # nazwa z wersji 1.0.0: przenosimy historię
HISTORY_FILE = os.path.join(DATA_DIR, "historia.json")
USER_FILE = os.path.join(DATA_DIR, "dane.json")
PRICE_HIST_FILE = os.path.join(DATA_DIR, "ceny_historia.json")
PLAYERS_FILE = os.path.join(DATA_DIR, "gracze_historia.json")
LINE = re.compile(r"^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\] \[Output\] : (.*)$")
MONEY = re.compile(r"(\d[\d ]*(?:[.,]\d+)?) ?PLN")
SKIP_RES = {"driveby", "4l-replace_fix"}
# punkty w skryptach: {x, y, z, ...}, --komentarz
POINT = re.compile(r"\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)[^}\n]*\}[^\n]*?(?:--\s*(.*))?$", re.M)


def mta_dir():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Multi Theft Auto: San Andreas All\1.6") as k:
            return winreg.QueryValueEx(k, "Last Install Location")[0]
    except OSError:
        return r"C:\Program Files (x86)\MTA San Andreas 1.6"


MTA = mta_dir()
LOGS = os.path.join(MTA, "MTA", "logs")
CACHE = os.path.join(MTA, "mods", "deathmatch", "resources")


def resource(*parts):
    return os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__))), *parts)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)  # zapis atomowy: przerwany zapis nie niszczy historii


def money(text):
    m = MONEY.search(text)
    return float(m[1].replace(" ", "").replace(",", ".")) if m else 0.0


def classify(text):
    """Zamienia linię logu na zdarzenie albo None."""
    if text.startswith("* Connected!"):
        return {"t": "connect"}
    if "Otrzymujesz wypłatę" in text:
        return {"t": "pay", "v": money(text)}
    if "Otrzymujesz bonus" in text:
        lp = re.search(r"(\d+) LP", text)
        return {"t": "bonus", "v": money(text), "lp": int(lp[1]) if lp else 0}
    m = re.search(r"Poświęcony czas: (\d+) min\. (\d+) sek", text)
    if m:
        return {"t": "worktime", "v": int(m[1]) * 60 + int(m[2])}
    m = re.match(r"Twój znajomy (\S+) (dołączył do gry|opuszcza grę)", text)
    if m:
        return {"t": "friend", "nick": m[1], "on": m[2].startswith("dołączył")}
    if "wywalony z powodu AFK" in text:
        return {"t": "afk"}
    m = re.match(r"\* Rozpocząłeś pracę (.+?)\.?$", text)
    if m:
        return {"t": "job", "v": m[1]}
    return None


AD = re.compile(r"^GO> (.+?) \((\d+)\): (.+)$")


def parse_ads(paths):
    """Ogłoszenia z czatu giełdy (GO>) z obecnych logów MTA, najnowsze pierwsze."""
    ads = []
    for path in sorted(paths, key=os.path.getmtime):
        with open(path, encoding="utf-8", errors="replace") as f:
            for raw in f:
                m = LINE.match(raw.rstrip("\n"))
                a = m and AD.match(m[2])
                if a:
                    ts = dt.datetime.strptime(m[1], "%Y-%m-%d %H:%M:%S").timestamp()
                    ads.append({"ts": ts, "nick": a[1], "id": a[2], "text": a[3]})
    return ads[::-1]


def parse_logs(paths):
    """Zdarzenia i sesje z plików console.log*. Sesja = od "Connected!" do ostatniej linii przed kolejnym."""
    events, sessions = [], []
    for path in sorted(paths, key=os.path.getmtime):
        cur = None
        with open(path, encoding="utf-8", errors="replace") as f:
            for raw in f:
                m = LINE.match(raw.rstrip("\n"))
                if not m:
                    continue
                ts = dt.datetime.strptime(m[1], "%Y-%m-%d %H:%M:%S").timestamp()
                ev = classify(m[2])
                if ev and ev["t"] == "connect":
                    cur = {"start": ts, "end": ts}
                    sessions.append(cur)
                elif cur:
                    cur["end"] = ts
                if ev and ev["t"] != "connect":
                    ev["ts"] = ts
                    events.append(ev)
    return events, sessions


def merge_history(hist, events, sessions):
    """Logi MTA rotują po kilku plikach, więc dopisujemy je do własnej historii bez duplikatów."""
    seen = {(e["ts"], e["t"], e.get("v"), e.get("nick")) for e in hist["events"]}
    for e in events:
        key = (e["ts"], e["t"], e.get("v"), e.get("nick"))
        if key not in seen:
            seen.add(key)
            hist["events"].append(e)
    by_start = {s["start"]: s for s in hist["sessions"]}
    for s in sessions:
        old = by_start.get(s["start"])
        if old:
            old["end"] = max(old["end"], s["end"])
        else:
            by_start[s["start"]] = dict(s)
    hist["sessions"] = sorted(by_start.values(), key=lambda s: s["start"])
    hist["events"].sort(key=lambda e: e["ts"])
    return hist


def _ase_strings(data, i):
    n = data[i]
    return data[i + 1:i + n].decode("utf-8", "replace"), i + n


def query_server(host, port, timeout=4):
    """Status ASE serwera MTA (port gry + 123). Pole score na 4Life: "id/konto/czas wejścia (unix)"."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(b"s", (socket.gethostbyname(host), port + 123))
        data = s.recv(65535)
    finally:
        s.close()
    return parse_ase(data)


def parse_ase(data):
    if data[:4] != b"EYE1":
        raise ValueError("zła odpowiedź serwera")
    i, head = 4, []
    for _ in range(9):  # gra, port, nazwa, tryb, mapa, wersja, hasło, gracze, sloty
        v, i = _ase_strings(data, i)
        head.append(v)
    while data[i] != 1:  # reguły klucz/wartość aż do pustego pola
        _, i = _ase_strings(data, i)
        _, i = _ase_strings(data, i)
    i += 1
    players = []
    while i < len(data):
        flags, i = data[i], i + 1
        p = {}
        if i >= len(data):
            break
        for bit, key in ((1, "nick"), (2, "team"), (4, "skin"), (8, "score"), (16, "ping"), (32, "time")):
            if flags & bit:
                p[key], i = _ase_strings(data, i)
        parts = p.get("score", "").split("/")
        p["id"] = parts[0] if parts else ""
        p["joined"] = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else None
        players.append({k: p.get(k) for k in ("nick", "id", "ping", "joined")})
    return {"name": head[2], "players": int(head[7] or 0), "max": int(head[8] or 0), "list": players}


def scan_places(cache):
    """Punkty z koordynatami ze skryptów w cache MTA. Odczyt na miejscu: nic nie jest kopiowane do aplikacji."""
    out = []
    for path in glob.glob(os.path.join(cache, "*", "**", "*.lua"), recursive=True):
        res = os.path.relpath(path, cache).split(os.sep)[0]
        if res.startswith("shader") or res in SKIP_RES:
            continue  # efekty graficzne, nie miejsca
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            continue
        for m in POINT.finditer(text):
            line_start = text.rfind("\n", 0, m.start()) + 1
            if text[line_start:m.start()].lstrip().startswith("--"):
                continue  # zakomentowany punkt
            x, y = float(m[1]), float(m[2])
            if abs(x) <= 3000 and abs(y) <= 3000 and (x, y) != (0, 0):
                out.append({"layer": res, "x": x, "y": y, "label": (m[4] or "").strip()})
    return out


def map_data_url(path):
    """Obraz mapy jako data URL: okno działa na lokalnym serwerze http i nie może czytać file:// spoza aplikacji."""
    try:
        with open(path, "rb") as f:
            return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    except OSError:
        return None


class Api:
    def history(self):
        hist = load_json(HISTORY_FILE, {"events": [], "sessions": []})
        paths = glob.glob(os.path.join(LOGS, "console.log*"))
        if paths:
            hist = merge_history(hist, *parse_logs(paths))
            save_json(HISTORY_FILE, hist)
        return {"found": bool(paths), "logs": LOGS, **hist}

    def server(self):
        try:
            srv = query_server(*SERVER)
        except Exception as e:
            return {"error": str(e)}
        # liczba graczy co ~5 minut, 14 dni wstecz: wykres godzin szczytu
        hist = load_json(PLAYERS_FILE, [])
        if not hist or time.time() - hist[-1][0] > 290:
            hist = [h for h in hist if h[0] > time.time() - 14 * 86400] + [[round(time.time()), srv["players"]]]
            save_json(PLAYERS_FILE, hist)
        return srv

    def places(self):
        hq = os.path.join(CACHE, "4l-hud", "files", "map", "map_hq.jpg")
        return {"found": os.path.isdir(CACHE), "map": map_data_url(hq),
                "points": scan_places(CACHE) if os.path.isdir(CACHE) else []}

    def prices(self):
        """Ceny surowców z forum: zawsze świeże, a bez sieci ostatnie zapisane (z godziną pobrania)."""
        path = os.path.join(DATA_DIR, "ceny_surowcow.json")
        try:
            data = {"at": time.time(), "items": wiki.fetch_prices()}
            save_json(path, data)
        except Exception:
            data = load_json(path, None)
            return data and {**data, "history": load_json(PRICE_HIST_FILE, [])}
        # historia do wykresu: wpis tylko gdy któraś cena się zmieniła, 30 dni wstecz
        hist = load_json(PRICE_HIST_FILE, [])
        now = {p["id"]: p["price"] for p in data["items"]}
        if not hist or hist[-1]["p"] != now:
            hist = [h for h in hist if h["ts"] > time.time() - 30 * 86400] + [{"ts": data["at"], "p": now}]
            save_json(PRICE_HIST_FILE, hist)
        return {**data, "history": hist}

    def players_history(self):
        return load_json(PLAYERS_FILE, [])

    def market(self):
        return parse_ads(glob.glob(os.path.join(LOGS, "console.log*")))

    def notify(self, title, text):
        """Powiadomienie Windows (toast). Tekst idzie przez zmienne środowiskowe, nie wklejany w polecenie."""
        import subprocess
        ps = ("[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;"
              "$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(1);"
              "$t=$x.GetElementsByTagName('text');"
              "$t.Item(0).AppendChild($x.CreateTextNode($env:FL_T))>$null;$t.Item(1).AppendChild($x.CreateTextNode($env:FL_B))>$null;"
              "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:FL_APP).Show([Windows.UI.Notifications.ToastNotification]::new($x))")
        env = dict(os.environ, FL_T=str(title)[:120], FL_B=str(text)[:240], FL_APP=APP_NAME)
        subprocess.Popen(["powershell", "-NoProfile", "-Command", ps], env=env, creationflags=NO_WINDOW)
        return True

    def open_widget(self):
        """Małe okno zawsze na wierzchu: czas sesji, zarobek, bonus, znajomi. Drugie kliknięcie zamyka."""
        for w in webview.windows[1:]:
            w.destroy()
            return False
        win = webview.create_window(APP_NAME + " · widżet", resource("web", "widget.html"), js_api=self, width=360, height=270,
                                    on_top=True, resizable=True, background_color="#0a1424")
        win.events.shown += lambda: dark_title_bar(win)
        return True

    def wiki(self, kind):
        """Dane z wiki serwera zapamiętane na dysku na dobę; bez sieci zostaje ostatnia wersja."""
        path = os.path.join(DATA_DIR, f"wiki_{kind}.json")
        cached = load_json(path, None)
        if cached and time.time() - cached["at"] < 86400:
            return cached["data"]
        try:
            data = wiki.FETCH[kind]()
            save_json(path, {"at": time.time(), "data": data})
            return data
        except Exception:
            return cached["data"] if cached else None

    def wiki_img(self, path):
        """Ikona/obrazek z wiki: pobierany raz do %APPDATA%, potem czytany z dysku."""
        # dozwolone tylko ścieżki z wiki albo ikony surowców z forum
        if not isinstance(path, str) or ".." in path:
            return None
        if path.startswith(wiki.FORUM_ICONS):
            url, rel = path, "forum/" + path[len(wiki.FORUM_ICONS):]
        elif wiki.IMG_PATH.match(path):
            url, rel = wiki.WIKI + path, path.strip("/")
        else:
            return None
        if not wiki.IMG_PATH.match("/" + rel):
            return None
        local = os.path.join(DATA_DIR, "wiki_img", *rel.split("/"))
        if not os.path.isfile(local):
            try:
                data = wiki.get(url, binary=True)
            except Exception:
                return None
            os.makedirs(os.path.dirname(local), exist_ok=True)
            with open(local, "wb") as f:
                f.write(data)
        ext = path.rsplit(".", 1)[1].replace("jpg", "jpeg")
        with open(local, "rb") as f:
            return f"data:image/{ext};base64," + base64.b64encode(f.read()).decode()

    # ---------- aktualizacje z wydań na GitHubie ----------
    def check_update(self):
        try:
            rel = json.loads(wiki.get(f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"))
        except Exception:
            return {"current": APP_VERSION, "error": "Nie udało się sprawdzić aktualizacji"}
        tag = str(rel.get("tag_name", "")).lstrip("vV")
        asset = next((a.get("browser_download_url", "") for a in rel.get("assets", []) if a.get("name") == EXE_NAME), "")
        return {"current": APP_VERSION, "latest": tag, "newer": version_tuple(tag) > version_tuple(APP_VERSION),
                "notes": (rel.get("body") or "")[:1500], "canInstall": bool(asset) and getattr(sys, "frozen", False), "asset": asset}

    def install_update(self):
        """Pobiera nowy .exe; skrypt czeka na zamknięcie aplikacji, podmienia plik i uruchamia nową wersję."""
        import subprocess
        import threading
        info = self.check_update()
        if not info.get("newer") or not info.get("canInstall"):
            return {"ok": False, "error": "Brak nowszej wersji do zainstalowania"}
        if not info["asset"].startswith(f"https://github.com/{GITHUB_REPO}/releases/download/"):
            return {"ok": False, "error": "Nieznane źródło aktualizacji"}
        tmp = os.path.join(os.environ.get("TEMP", DATA_DIR), "mta_companion_update")
        os.makedirs(tmp, exist_ok=True)
        new_exe = os.path.join(tmp, EXE_NAME)
        try:
            data = wiki.get(info["asset"], binary=True)
        except Exception:
            return {"ok": False, "error": "Nie udało się pobrać aktualizacji"}
        if data[:2] != b"MZ":  # to musi być program Windows, nie strona błędu
            return {"ok": False, "error": "Pobrany plik nie jest aplikacją"}
        with open(new_exe, "wb") as f:
            f.write(data)
        exe = sys.executable
        name = os.path.basename(exe)  # instalacje 1.0.0 mają jeszcze plik MTACompanion.exe
        bat = os.path.join(tmp, "aktualizuj.bat")
        with open(bat, "w", encoding="mbcs") as f:
            # ping zamiast timeout: bez konsoli timeout kończy się od razu
            f.write(f"""@echo off
set n=0
:wait
tasklist /fi "imagename eq {name}" | find /i "{name}" >nul || goto copy
set /a n+=1
if %n% geq 40 taskkill /f /im {name} >nul 2>&1
ping -n 2 127.0.0.1 >nul
goto wait
:copy
copy /y "{exe}" "{exe}.poprzednia" >nul
set k=0
:retry
copy /y "{new_exe}" "{exe}" >nul && goto run
set /a k+=1
if %k% geq 15 goto run
ping -n 2 127.0.0.1 >nul
goto retry
:run
start "" "{exe}"
""")
        # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: skrypt przeżywa zamknięcie aplikacji
        subprocess.Popen(["cmd", "/c", bat], creationflags=0x00000008 | 0x00000200 | NO_WINDOW, close_fds=True)
        threading.Timer(0.8, lambda: [w.destroy() for w in webview.windows]).start()
        threading.Timer(5, os._exit, (0,)).start()  # na pewno zamknij proces, inaczej skrypt czeka
        return {"ok": True, "version": info["latest"]}

    def app_version(self):
        return APP_VERSION

    def load(self):
        return load_json(USER_FILE, {})

    def save(self, data):
        save_json(USER_FILE, data)
        return True


def _selftest():
    ev = classify("✔ Otrzymujesz wypłatę w wysokości 1 234.50 PLN.")
    assert ev == {"t": "pay", "v": 1234.5}, ev
    assert classify("Twój znajomy Kalli_Bsk opuszcza grę.") == {"t": "friend", "nick": "Kalli_Bsk", "on": False}
    assert classify("✔ Poświęcony czas: 3 min. 20 sek.")["v"] == 200
    assert classify("* Rozpocząłeś pracę w magazynie.") == {"t": "job", "v": "w magazynie"}
    assert AD.match("GO> Kn1vx (220): SPRZEDAM MSK-1000 2.2").groups() == ("Kn1vx", "220", "SPRZEDAM MSK-1000 2.2")
    h = merge_history({"events": [], "sessions": []}, [{"t": "pay", "v": 1, "ts": 5}], [{"start": 1, "end": 5}])
    h = merge_history(h, [{"t": "pay", "v": 1, "ts": 5}], [{"start": 1, "end": 9}])
    assert len(h["events"]) == 1 and h["sessions"] == [{"start": 1, "end": 9}]
    pkt = b"EYE1" + b"".join(bytes([len(x) + 1]) + x for x in [b"mta", b"22110", b"S", b"RPG", b"None", b"1.6", b"0", b"2", b"10"])
    pkt += b"\x01" + b"?" + b"\x04Ala\x01\x01\x0f1/2/1700000000\x0312\x01"
    q = parse_ase(pkt)
    assert q["players"] == 2 and q["list"] == [{"nick": "Ala", "id": "1", "ping": "12", "joined": 1700000000}], q
    wiki.selftest()
    assert version_tuple("v1.10.0") > version_tuple("1.9.3") and version_tuple("1.0") == (1, 0)
    print("selftest ok")


def dark_title_bar(window):
    """Ciemny pasek tytułu Windows zamiast białego. Okno zostaje zwykłe: przesuwanie, zmiana rozmiaru, przyciąganie."""
    import ctypes
    try:
        hwnd = window.native.Handle.ToInt32()
        dwm = ctypes.windll.dwmapi
        on, color = ctypes.c_int(1), ctypes.c_int(0x24140A)  # COLORREF 0x00BBGGRR = #0a1424
        dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(on), 4)  # DWMWA_USE_IMMERSIVE_DARK_MODE (Windows 10/11)
        dwm.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(color), 4)  # DWMWA_CAPTION_COLOR (tylko Windows 11)
    except Exception:
        return  # starszy Windows: zostaje zwykły pasek


def version_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", str(v))[:3])


def main():
    if "--selftest" in sys.argv:
        return _selftest()
    if os.path.isdir(OLD_DATA_DIR) and not os.path.exists(DATA_DIR):
        os.rename(OLD_DATA_DIR, DATA_DIR)
    os.makedirs(DATA_DIR, exist_ok=True)
    win = webview.create_window(APP_NAME, resource("web", "index.html"), js_api=Api(), width=1280, height=820,
                                min_size=(900, 600), background_color="#0a1424")
    win.events.shown += lambda: dark_title_bar(win)
    webview.start(private_mode=False, storage_path=os.path.join(DATA_DIR, "webview"))


if __name__ == "__main__":
    main()
