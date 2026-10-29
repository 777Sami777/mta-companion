"""Instalator 4Life Companion: kopiuje aplikację (domyślnie do %LOCALAPPDATA%\\Programs), tworzy skróty
i wpis „Odinstaluj” w Ustawieniach Windows. Bez uprawnień administratora (tylko bieżący użytkownik).
Okno w stylu aplikacji (pywebview + WebView2); bez WebView2 zostaje proste okno tkinter."""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import winreg

APP = "4Life Companion"
DEFAULT_DEST = os.path.join(os.environ["LOCALAPPDATA"], "Programs", "4LifeCompanion")
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\4LifeCompanion"
NO_WINDOW = 0x08000000


def resource(name):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def new_version():
    try:
        with open(resource("version.txt"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def installed():
    """(wersja, folder) obecnej instalacji z rejestru albo (None, None)."""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as k:
            loc = winreg.QueryValueEx(k, "InstallLocation")[0]
            try:
                ver = winreg.QueryValueEx(k, "DisplayVersion")[0]
            except OSError:
                ver = ""  # instalacje sprzed 2.11 nie zapisywały wersji
            return ver or "?", loc
    except OSError:
        return None, None


def shortcut(path, target):
    # skrót .lnk przez WScript.Shell; ścieżki przez zmienne środowiskowe, żeby nie było problemu z cudzysłowami
    env = {**os.environ, "MC_LNK": path, "MC_TARGET": target, "MC_DIR": os.path.dirname(target)}
    ps = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:MC_LNK);$s.TargetPath=$env:MC_TARGET;$s.WorkingDirectory=$env:MC_DIR;$s.IconLocation=$env:MC_TARGET;$s.Save()"
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], env=env, creationflags=NO_WINDOW, check=False)


def install(dest, opts, report):
    """Właściwa instalacja; report(procent, tekst) pokazuje postęp."""
    exe = os.path.join(dest, "4LifeCompanion.exe")
    report(2, "Zamykam działającą aplikację…")
    subprocess.run(["taskkill", "/IM", "4LifeCompanion.exe", "/F"], creationflags=NO_WINDOW, capture_output=True)
    # Windows zwalnia pliki zamkniętego procesu z opóźnieniem: czekaj, aż zniknie z listy (do 10 s)
    for _ in range(40):
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq 4LifeCompanion.exe", "/NH"], creationflags=NO_WINDOW, capture_output=True, text=True).stdout
        if "4LifeCompanion.exe" not in out:
            break
        time.sleep(0.25)
    os.makedirs(dest, exist_ok=True)
    report(30, "Kopiuję aplikację…")
    for attempt in range(20):  # plik może być jeszcze chwilę zablokowany (antywirus, zamykany proces)
        try:
            shutil.copyfile(resource("4LifeCompanion.exe"), exe)
            break
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.5)
    if opts.get("test"):  # test po zbudowaniu: tylko pliki
        return exe
    report(90, "Tworzę skróty…")
    desktop = os.path.join(os.environ["USERPROFILE"], "Desktop")
    start = os.path.join(os.environ["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs")
    lnk_desk, lnk_start = os.path.join(desktop, APP + ".lnk"), os.path.join(start, APP + ".lnk")
    if opts.get("desktop", True):
        shortcut(lnk_desk, exe)
    if opts.get("start", True):
        shortcut(lnk_start, exe)
    report(95, "Rejestruję w Windows…")
    # odinstalowanie: skrypt usuwa pliki programu i skróty, dane gracza w %APPDATA%\4LifeCompanion zostają
    bat = os.path.join(dest, "odinstaluj.bat")
    with open(bat, "w", encoding="mbcs") as f:
        f.write(f"""@echo off
taskkill /IM 4LifeCompanion.exe /F >nul 2>&1
reg delete "HKCU\\{UNINSTALL_KEY}" /f >nul 2>&1
del "{lnk_desk}" >nul 2>&1
del "{lnk_start}" >nul 2>&1
cd /d "%TEMP%"
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & rmdir /s /q \\"{dest}\\""
""")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as k:
        for name, val in (("DisplayName", APP), ("DisplayIcon", exe), ("Publisher", "777Sami777"), ("InstallLocation", dest),
                          ("DisplayVersion", new_version()), ("UninstallString", f'cmd /c "{bat}"')):
            winreg.SetValueEx(k, name, 0, winreg.REG_SZ, val)
        winreg.SetValueEx(k, "NoModify", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(k, "NoRepair", 0, winreg.REG_DWORD, 1)
    report(100, "Gotowe")
    return exe


PAGE = r"""<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
:root{--bg:#0a1424;--bg2:#0f1d33;--card:#13243f;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.16);--text:#e9eff8;--t2:#b3c0d4;--t3:#8394ae;--acc:#f59e0b;--good:#22c55e;--bad:#ef4444;--ease:cubic-bezier(.16,1,.3,1)}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--text);font:15px/1.5 "Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;user-select:none}
.top{height:44px;display:flex;align-items:center;gap:10px;padding:0 6px 0 16px;border-bottom:1px solid var(--line);background:#0b1628}
.top b{flex:1;font:600 13px Bahnschrift,sans-serif;letter-spacing:.12em}.top b span{color:var(--acc)}
.top button{width:40px;height:32px;border:0;background:none;color:var(--t3);border-radius:4px;cursor:pointer;display:grid;place-items:center}
.top button:hover{background:rgba(255,255,255,.08);color:var(--text)}.top button.x:hover{background:var(--bad);color:#fff}
svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
main{position:relative;height:calc(100% - 44px)}
.step{position:absolute;inset:0;padding:34px 40px 28px;display:flex;flex-direction:column;opacity:0;transform:translateX(24px);pointer-events:none;transition:opacity .35s var(--ease),transform .45s var(--ease)}
.step.on{opacity:1;transform:none;pointer-events:auto}.step.out{transform:translateX(-24px)}
.logo{width:64px;height:64px;margin-bottom:18px}.logo path{fill:none;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
h1{margin:0 0 6px;font:700 30px/1.1 Bahnschrift,sans-serif;letter-spacing:.01em}h1 span{color:var(--acc)}
.sub{margin:0;color:var(--t2);max-width:440px}
.badge{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:6px 12px;border:1px solid var(--line2);border-radius:5px;font:600 12px Bahnschrift,sans-serif;letter-spacing:.08em;color:var(--t2);align-self:flex-start}
.badge i{width:7px;height:7px;border-radius:50%;background:var(--good);box-shadow:0 0 0 3px rgba(34,197,94,.2)}
.feat{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;margin:22px 0 0;padding:0;list-style:none;color:var(--t2);font-size:13.5px}
.feat li::before{content:"";display:inline-block;width:6px;height:6px;margin-right:9px;background:var(--acc);transform:rotate(45deg) translateY(-2px)}
.grow{flex:1}.foot{display:flex;gap:10px;justify-content:flex-end;align-items:center}.foot small{flex:1;color:var(--t3);font-size:12px}
.btn{height:42px;padding:0 22px;border-radius:6px;border:1px solid var(--line2);background:transparent;color:var(--text);font:600 14px Bahnschrift,sans-serif;letter-spacing:.04em;cursor:pointer;transition:transform .25s var(--ease),background .2s}
.btn:hover{background:rgba(255,255,255,.06)}.btn:active{transform:scale(.97)}.btn.pri{background:var(--acc);border-color:var(--acc);color:#111}.btn.pri:hover{background:#d97706}
.btn:focus-visible,input:focus-visible,.opt:focus-within{outline:2px solid var(--acc);outline-offset:2px}
h2{margin:0 0 4px;font:700 22px Bahnschrift,sans-serif}.path{display:flex;gap:8px;margin:18px 0 6px}
.path input{flex:1;min-width:0;height:42px;padding:0 12px;border-radius:6px;border:1px solid var(--line2);background:#070f1c;color:var(--text);font:13px "Segoe UI",sans-serif}
.hint{color:var(--t3);font-size:12.5px;margin:0 0 16px}
.opt{display:flex;gap:12px;align-items:center;padding:11px 14px;border:1px solid var(--line);border-radius:6px;background:var(--card);margin-bottom:8px;cursor:pointer}
.opt b{display:block;font-weight:600;font-size:14px}.opt small{color:var(--t3);font-size:12.5px}.opt>span:first-child{flex:1}
.tog{position:relative;width:40px;height:22px;flex:none}.tog input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.tog i{position:absolute;inset:0;border-radius:11px;background:#25334d;transition:background .2s}.tog i::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .3s var(--ease)}
.tog input:checked+i{background:var(--acc)}.tog input:checked+i::after{transform:translateX(18px)}
.bar{height:8px;border-radius:4px;background:#1a2a45;overflow:hidden;margin:26px 0 10px}.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#f59e0b,#fbbf24);transition:width .3s var(--ease)}
.pct{font:700 44px/1 Bahnschrift,sans-serif;font-variant-numeric:tabular-nums}.ptxt{color:var(--t3);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ok{width:64px;height:64px;border-radius:50%;background:rgba(34,197,94,.14);display:grid;place-items:center;margin-bottom:18px;color:var(--good)}.ok svg{width:30px;height:30px;stroke-width:2.6}
.err{color:#fca5a5;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);padding:10px 12px;border-radius:6px;font-size:13px;margin-top:14px;white-space:pre-wrap}
@media (prefers-reduced-motion:reduce){.step,.bar i,.btn,.tog i::after{transition:none}}
</style></head><body>
<div class="top pywebview-drag-region"><b>4LIFE <span>COMPANION</span> · INSTALATOR</b>
<button onclick="api().minimize()" title="Minimalizuj" aria-label="Minimalizuj"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
<button class="x" onclick="api().close()" title="Zamknij" aria-label="Zamknij instalator"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
<main>
<section class="step on" id="s1">
  <h1>4Life <span>Companion</span></h1>
  <p class="sub" id="lead">Pomocnik gracza 4Life MTA: sesje, zarobki, znajomi, mapa z giełdami, pojazdy, tuning i prace dorywcze w jednym oknie.</p>
  <div class="badge"><i></i><span id="ver">WERSJA</span></div>
  <ul class="feat"><li>Nie dotyka gry, czyta tylko logi MTA</li><li>Dane zostają na Twoim komputerze</li><li>Bez uprawnień administratora</li><li>Aktualizacje jednym kliknięciem</li></ul>
  <div class="grow"></div>
  <div class="foot"><small>Darmowy projekt fanowski, niezwiązany z 4Life MTA.</small><button class="btn pri" id="go1" onclick="to(2)">Dalej</button></div>
</section>
<section class="step" id="s2">
  <h2>Gdzie i jak zainstalować</h2>
  <div class="path"><input id="dest" aria-label="Folder instalacji" spellcheck="false"><button class="btn" onclick="pick()">Zmień…</button></div>
  <p class="hint">Twoja historia, znajomi i ustawienia zostają bez zmian (są w osobnym folderze).</p>
  <label class="opt"><span><b>Skrót na pulpicie</b></span><span class="tog"><input type="checkbox" id="o-desk" checked><i></i></span></label>
  <label class="opt"><span><b>Skrót w menu Start</b></span><span class="tog"><input type="checkbox" id="o-start" checked><i></i></span></label>
  <div class="grow"></div>
  <div class="foot"><button class="btn" onclick="to(1)">Wstecz</button><button class="btn pri" id="go2" onclick="run()">Zainstaluj</button></div>
</section>
<section class="step" id="s3" aria-live="polite">
  <h2 id="h3">Instaluję…</h2><p class="sub">To potrwa kilka sekund.</p>
  <div class="bar"><i id="bar"></i></div>
  <div class="pct" id="pct">0%</div><div class="ptxt" id="ptxt">Przygotowuję…</div>
  <div id="err"></div><div class="grow"></div>
  <div class="foot" id="f3" hidden><button class="btn" onclick="to(2)">Wstecz</button><button class="btn pri" onclick="run()">Spróbuj ponownie</button></div>
</section>
<section class="step" id="s4">
  <div class="ok"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
  <h1 id="h4">Gotowe</h1>
  <p class="sub">4Life Companion jest zainstalowany. Znajdziesz go na pulpicie i w menu Start.</p>
  <label class="opt" style="margin-top:22px;max-width:360px"><span><b>Uruchom teraz</b></span><span class="tog"><input type="checkbox" id="o-run" checked><i></i></span></label>
  <div class="grow"></div>
  <div class="foot"><button class="btn pri" id="go4" onclick="finish()">Zakończ</button></div>
</section>
</main>
<script>
const api = () => window.pywebview.api, $ = (s) => document.querySelector(s);
let cur = 1, exe = "";
function to(n) {
  const a = $("#s" + cur), b = $("#s" + n);
  a.classList.remove("on"); a.classList.toggle("out", n > cur); b.classList.remove("out"); b.classList.add("on"); cur = n;
  setTimeout(() => b.querySelector(".btn.pri,input")?.focus(), 60);
}
async function pick() { const d = await api().pick(); if (d) $("#dest").value = d; }
window.__p = (p, t) => { $("#bar").style.width = p + "%"; $("#pct").textContent = Math.round(p) + "%"; $("#ptxt").textContent = t; };
async function run() {
  to(3); $("#err").innerHTML = ""; $("#f3").hidden = true; $("#h3").textContent = "Instaluję…"; $("#s3 .sub").textContent = "To potrwa kilka sekund.";
  const r = await api().install({ dest: $("#dest").value.trim(), desktop: $("#o-desk").checked, start: $("#o-start").checked });
  if (r.ok) { exe = r.exe; setTimeout(() => to(4), 500); }
  else { $("#h3").textContent = "Coś poszło nie tak"; $("#s3 .sub").textContent = "Nic nie zostało zepsute, możesz spróbować ponownie."; $("#err").innerHTML = `<div class="err">${r.error.replace(/</g, "&lt;")}</div>`; $("#f3").hidden = false; }
}
function finish() { api().finish($("#o-run").checked, exe); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && cur !== 3) api().close(); });
window.addEventListener("pywebviewready", async () => {
  const i = await api().info();
  $("#ver").textContent = i.old ? (i.old === "?" ? `AKTUALIZACJA DO ${i.version}` : i.old === i.version ? `PONOWNA INSTALACJA ${i.version}` : `AKTUALIZACJA ${i.old} → ${i.version}`) : "WERSJA " + i.version;
  $("#dest").value = i.dest;
  if (i.old) { $("#go2").textContent = "Aktualizuj"; $("#h4").textContent = "Zaktualizowano"; }
  $("#go1").focus();
});
</script></body></html>"""


class Api:
    def __init__(self):
        self.win = None

    def info(self):
        old, loc = installed()
        return {"version": new_version(), "old": old, "dest": loc or DEFAULT_DEST}

    def pick(self):
        import webview
        r = self.win.create_file_dialog(webview.FOLDER_DIALOG)
        return os.path.join(r[0], "4LifeCompanion") if r else None

    def install(self, opts):
        dest = os.path.abspath(os.path.expandvars(str(opts.get("dest") or DEFAULT_DEST)))
        if len(dest) < 8 or os.path.splitdrive(dest)[1] in ("\\", ""):
            return {"ok": False, "error": "Wybierz konkretny folder, nie cały dysk."}
        report = lambda p, t: self.win.evaluate_js(f"window.__p({p:.1f}, {json.dumps(t)})")
        try:
            return {"ok": True, "exe": install(dest, opts, report)}
        except PermissionError as e:
            return {"ok": False, "error": f"Brak dostępu do pliku: {e.filename}\nZamknij 4Life Companion i spróbuj ponownie."}
        except Exception as e:  # pokazujemy błąd zamiast cichego zamknięcia
            return {"ok": False, "error": f"Instalacja nie powiodła się:\n{e}"}

    def finish(self, run, exe):
        if run and exe and os.path.isfile(exe):
            subprocess.Popen([exe], cwd=os.path.dirname(exe))
        self.close()

    def minimize(self):
        self.win.minimize()

    def close(self):
        threading.Thread(target=self.win.destroy, daemon=True).start()


def tk_main():
    """Zapasowe okno, gdy w systemie brak WebView2."""
    import tkinter as tk
    from tkinter import messagebox, ttk
    root = tk.Tk()
    root.title("Instalator " + APP)
    root.geometry("440x170")
    root.resizable(False, False)
    tk.Label(root, text=APP, font=("Segoe UI", 14, "bold")).pack(pady=(18, 4))
    tk.Label(root, text=f"Instalacja do:\n{DEFAULT_DEST}", font=("Segoe UI", 9), justify="center").pack()
    progress = ttk.Progressbar(root, length=380, mode="determinate")
    progress.pack(pady=14)
    root.update()
    if not messagebox.askyesno(APP, f"Zainstalować {APP}?\n\nPowstaną skróty na pulpicie i w menu Start. Twoje dane zostają bez zmian."):
        root.destroy()
        return

    def report(p, _t):
        progress["value"] = p
        root.update()
    try:
        exe = install(DEFAULT_DEST, {"desktop": True, "start": True}, report)
    except Exception as e:
        messagebox.showerror(APP, f"Instalacja nie powiodła się:\n{e}")
        root.destroy()
        return
    messagebox.showinfo(APP, "Gotowe! Uruchamiam aplikację.")
    subprocess.Popen([exe], cwd=os.path.dirname(exe))
    root.destroy()


def main():
    if "--test" in sys.argv:  # 4LifeCompanionSetup.exe --test FOLDER: instalacja bez okna, kod wyjścia 0/1
        try:
            install(sys.argv[sys.argv.index("--test") + 1], {"test": True}, lambda p, t: None)
            sys.exit(0)
        except Exception:
            sys.exit(1)
    try:
        import webview
        api = Api()
        api.win = webview.create_window("Instalator " + APP, html=PAGE, js_api=api, width=640, height=520,
                                        resizable=False, frameless=True, easy_drag=False, background_color="#0a1424")
        webview.start(gui="edgechromium")
    except Exception:
        tk_main()


if __name__ == "__main__":
    main()
