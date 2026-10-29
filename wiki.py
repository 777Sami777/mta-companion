"""Pobieranie publicznych danych z wiki serwera 4Life (wiki.mta4life.pl).

Wiki to strona Next.js bez API: dane siedzą w paczkach JS (pojazdy, tuning, mapa)
albo w danych strony self.__next_f (prace). Wyciągamy je stąd i zapisujemy lokalnie.
"""
import json
import re
import urllib.request

WIKI = "https://wiki.mta4life.pl"
USER_AGENT = "MTA Companion"
IMG_PATH = re.compile(r"^/[\w/.-]+\.(png|jpe?g|webp)$")
# miejsce w paczce mapy: {x:..,y:..,name:"..",category:"..",type:"..",description:".."}
PLACE = re.compile(r'\{x:(-?[\d.]+),y:(-?[\d.]+),name:"((?:[^"\\]|\\.)*)",category:"(\w+)",type:"(\w+)"(?:,description:"((?:[^"\\]|\\.)*)")?')
JS_TOKEN = re.compile(r"""\s+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|!0|!1|void 0|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_$][\w$]*|[{}\[\],:]""")


def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def js_str(s):
    s = re.sub(r"\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})", lambda m: chr(int(m[1] or m[2], 16)), s)
    return s.replace("\\n", "\n").replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")


def js_literal(src):
    """Obiekt/tablica ze zminifikowanego JS (klucze bez cudzysłowów, 11e3, !0) -> obiekt Pythona."""
    out, pos = [], 0
    while pos < len(src):
        m = JS_TOKEN.match(src, pos)
        if not m:
            raise ValueError(f"nieznany kod JS: {src[pos:pos + 30]!r}")
        t, pos = m[0], m.end()
        is_key = re.match(r"\s*:", src[pos:]) is not None
        if t.isspace():
            continue
        if t[0] in "\"'":
            out.append(json.dumps(js_str(t[1:-1])))
        elif t in ("!0", "!1"):
            out.append("true" if t == "!0" else "false")
        elif t[0].isdigit() or t[0] in "-.":
            v = float(t)
            out.append(json.dumps(t) if is_key else json.dumps(int(v) if v.is_integer() else v))
        elif t[0].isalpha() or t[0] in "_$":
            out.append(json.dumps(t) if is_key else {"true": "true", "false": "false"}.get(t, "null"))
        else:
            out.append(t)
    return json.loads(re.sub(r",\s*([}\]])", r"\1", "".join(out)))


def literal_at(js, start):
    """Wycina literał JS zaczynający się od nawiasu na pozycji start (nawiasy w napisach pomijane)."""
    depth, i, quote = 0, start, None
    while i < len(js):
        c = js[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
            if depth == 0:
                return js[start:i + 1]
        i += 1
    raise ValueError("niedomknięty literał")


def page_chunks(slug):
    """Paczki JS strony wiki, razem z doładowywanymi leniwie (page-*.js -> numery -> nazwy z webpack-*.js)."""
    html = get(f"{WIKI}/{slug}")
    urls = re.findall(r"/_next/static/chunks/[\w/.-]+\.js", html)
    page = next((u for u in urls if f"/app/{slug}/page-" in u), None)
    runtime = next((u for u in urls if "/webpack-" in u), None)
    if page and runtime:
        ids = re.findall(r"n\.e\((\d+)\)", get(WIKI + page))
        names = dict(re.findall(r'(\d+):"([0-9a-f]{8,})"', get(WIKI + runtime)))
        urls += [f"/_next/static/chunks/{i}.{names[i]}.js" for i in reversed(ids) if i in names]
    skip = ("/webpack-", "/main-app-", "/polyfills-", "/app/layout-")
    return [u for u in dict.fromkeys(urls) if not any(k in u for k in skip)]


def chunk(url):
    """Jedna paczka; nazwy z webpack-*.js obejmują też pliki CSS, więc 404 po prostu pomijamy."""
    try:
        return get(WIKI + url)
    except OSError:
        return ""


def parse_places(js):
    icons = {m[1]: m[2] for m in re.finditer(r'(\w+):\{label:"[^"]*",icon:"([^"]+)"\}', js)}
    return [{"x": float(m[1]), "y": float(m[2]), "name": js_str(m[3]), "cat": m[4], "type": m[5],
             "desc": re.sub(r"\s+", " ", js_str(m[6] or "")).strip(), "icon": icons.get(m[5])} for m in PLACE.finditer(js)]


def fetch_places():
    for u in reversed(page_chunks("mapa")):
        places = parse_places(chunk(u))
        if places:
            return places
    raise ValueError("nie znaleziono miejsc na wiki")


def _find_literal(slug, marker, check=""):
    for u in page_chunks(slug):
        js = chunk(u)
        i = js.find(marker)
        if i >= 0 and check in js[i:i + 3000]:
            return js_literal(literal_at(js, i))
    raise ValueError(f"nie znaleziono danych strony /{slug}")


def fetch_vehicles():
    return _find_literal("pojazdy", "[{id:", "engines:")


def fetch_tuning():
    return _find_literal("tuning", "{components:{title:")


def rsc_rows(html):
    """Dane strony Next.js (self.__next_f) jako lista wierszy JSON."""
    text = "".join(json.loads('"' + c + '"') for c in re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html))
    rows = []
    for line in text.split("\n"):
        m = re.match(r"^[0-9a-f]+:([\[{].*)$", line)
        if m:
            try:
                rows.append(json.loads(m[1]))
            except ValueError:
                pass
    return rows


def nodes(n, tag=None):
    """Elementy React ["$", typ, klucz, props] w drzewie: wszystkie albo tylko danego typu."""
    if isinstance(n, list):
        if len(n) == 4 and n[0] == "$" and isinstance(n[1], str) and isinstance(n[3], dict):
            if tag in (None, n[1]):
                yield n
            if tag is None or n[1] != tag:
                yield from nodes(n[3].get("children"), tag)
        else:
            for x in n:
                yield from nodes(x, tag)
    elif isinstance(n, dict):
        for x in n.values():
            yield from nodes(x, tag)


def texts(n):
    if isinstance(n, str):
        return [] if n.startswith("$") else [n]
    if isinstance(n, list):
        if len(n) == 4 and n[0] == "$" and isinstance(n[3], dict):
            return texts(n[3].get("children"))
        return [t for x in n for t in texts(x)]
    return []


def job_variants(props):
    """Tabele zarobków: jedna lista [{poziom, lp, xp, premium}] albo kilka wariantów (np. pojazdów) z "options"."""
    for pr in props:
        job = pr.get("job")
        if isinstance(job, list):
            return [{"label": "", "rows": job}]
        if isinstance(job, dict):
            labels = {o["key"]: o["label"] for o in pr.get("options", [])}
            return [{"label": labels.get(k, k), "rows": rows} for k, rows in job.items() if isinstance(rows, list)]
    return []


def parse_jobs(html):
    jobs = []
    for art in (a for row in rsc_rows(html) for a in nodes(row, "article")):
        inner = art[3].get("children")
        txt, props = texts(art), [el[3] for el in nodes(inner)]
        name = next((t for el in nodes(inner, "h3") for t in texts(el)), None)
        if not name:
            continue
        after = lambda label: txt[txt.index(label) + 1] if label in txt[:-1] else ""
        jobs.append({
            "name": name,
            "desc": next((t for el in nodes(inner, "p") for t in texts(el)), ""),
            "img": next((pr["src"] for pr in props if str(pr.get("src", "")).startswith("/")), None),
            "req": after("Podstawowe wymagania"),
            "notes": after("Uwagi"),
            "variants": job_variants(props),
            "link": next((pr["href"] for pr in props if str(pr.get("href", "")).startswith("http")), None),
            "new": any("Nowo" in t for t in txt[:2]),
        })
    return jobs


def fetch_jobs():
    jobs = parse_jobs(get(f"{WIKI}/prace-dorywcze"))
    if not jobs:
        raise ValueError("nie znaleziono prac na wiki")
    return jobs


FETCH = {"places": fetch_places, "vehicles": fetch_vehicles, "tuning": fetch_tuning, "jobs": fetch_jobs}


def selftest():
    w = parse_places(r'a={x:-539,y:12.5,name:"G\xf3rnik",category:"job",type:"miner",description:"Wymagania:\n  • Brak"},b={miner:{label:"G",icon:"/blips/jobs/miner.png"}}')
    assert w == [{"x": -539.0, "y": 12.5, "name": "Górnik", "cat": "job", "type": "miner", "desc": "Wymagania: • Brak",
                  "icon": "/blips/jobs/miner.png"}], w
    js = r'x=[{id:400,name:"Land\xf3",seats:4,ok:!0,no:!1,engines:{"1.4":{stock:134,price:11e3,v:.5}},d:"a[b]"}];'
    lit = js_literal(literal_at(js, js.index("[")))
    assert lit == [{"id": 400, "name": "Landó", "seats": 4, "ok": True, "no": False,
                    "engines": {"1.4": {"stock": 134, "price": 11000, "v": 0.5}}, "d": "a[b]"}], lit
    art = ["$", "article", "1", {"children": [["$", "img", None, {"src": "/jobs/a.png"}], ["$", "h3", None, {"children": "Kurier"}],
           ["$", "p", None, {"children": "Opis"}], ["$", "$L1b", None, {"job": [{"poziom": 1, "lp": 0, "xp": 0, "premium": 1200}]}],
           ["$", "div", None, {"children": ["Podstawowe wymagania", "Brak", "Uwagi", "Nic"]}]]}]
    html = 'self.__next_f.push([1,' + json.dumps("5:" + json.dumps(art) + "\n") + '])'
    j = parse_jobs(html)
    assert j[0]["name"] == "Kurier" and j[0]["img"] == "/jobs/a.png" and j[0]["req"] == "Brak" and j[0]["variants"][0]["rows"][0]["premium"] == 1200, j
