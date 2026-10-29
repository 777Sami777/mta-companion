"""Sieć dróg San Andreas z plików gry (models/gta3.img -> nodes0..63.dat) i wyznaczanie trasy (A*).

Czytamy tylko pliki GTA SA z dysku, tak jak każdy edytor map. Gra i jej pamięć nie są dotykane.
Format nodes*.dat: nagłówek 5×uint32, węzły po 28 B (najpierw drogi dla aut), węzły nawigacji po 14 B,
połączenia po 4 B (obszar, węzeł). Pozycje zapisane jako int16 / 8.
"""
import heapq
import math
import struct

SECTOR = 2048


def read_nodes_files(img_path):
    """Zawartość nodes0..63.dat z archiwum IMG v2 (nagłówek VER2 + wpisy po 32 B)."""
    out = {}
    with open(img_path, "rb") as f:
        if f.read(4) != b"VER2":
            raise ValueError("nieznany format gta3.img")
        count = struct.unpack("<I", f.read(4))[0]
        entries = [struct.unpack("<IHH24s", f.read(32)) for _ in range(count)]
        for offset, size, size2, raw in entries:
            name = raw.split(b"\0")[0].decode("ascii", "replace").lower()
            if name.startswith("nodes") and name.endswith(".dat"):
                f.seek(offset * SECTOR)
                out[int(name[5:-4])] = f.read((size or size2) * SECTOR)
    return out


def parse_area(data):
    """Węzły dróg dla aut jednego obszaru: [(x, y, [(obszar, węzeł), ...])]."""
    n_nodes, n_veh, _n_ped, n_navi, n_links = struct.unpack_from("<5I", data, 0)
    links_at = 20 + n_nodes * 28 + n_navi * 14
    links = [struct.unpack_from("<HH", data, links_at + i * 4) for i in range(n_links)]
    nodes = []
    for i in range(n_veh):
        x, y, _z, _h, link_id, _area, _node, _w, _ff, flags = struct.unpack_from("<3hhHHHBBI", data, 20 + i * 28 + 8)
        nodes.append((x / 8, y / 8, links[link_id:link_id + (flags & 0xF)]))
    return nodes


def build_graph(img_path):
    """Graf dróg: punkty [[x, y]] i sąsiedzi [[indeks, ...]] (tylko połączenia między drogami dla aut)."""
    areas = {a: parse_area(d) for a, d in read_nodes_files(img_path).items()}
    index, pts = {}, []
    for a in sorted(areas):
        for i, (x, y, _) in enumerate(areas[a]):
            index[(a, i)] = len(pts)
            pts.append([round(x, 1), round(y, 1)])
    adj = [[] for _ in pts]
    for a in sorted(areas):
        for i, (_, _, links) in enumerate(areas[a]):
            for la, ln in links:
                j = index.get((la, ln))  # połączenia do ścieżek pieszych nie mają indeksu: pomijamy
                if j is not None and j != index[(a, i)]:
                    adj[index[(a, i)]].append(j)
    return {"pts": pts, "adj": adj}


def main_network(graph):
    """Indeksy największej spójnej części sieci: odcięte kawałki (doki, place) dawały "brak trasy"."""
    if "main" not in graph:
        adj, seen, best = graph["adj"], set(), set()
        for s in range(len(adj)):
            if s in seen or not adj[s]:
                continue
            comp, stack = {s}, [s]
            while stack:
                for n in adj[stack.pop()]:
                    if n not in comp:
                        comp.add(n)
                        stack.append(n)
            seen |= comp
            best = max(best, comp, key=len)
        graph["main"] = best
    return graph["main"]


def nearest(graph, x, y):
    pts = graph["pts"]
    return min(main_network(graph), key=lambda i: (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2)


def route(graph, start, goal):
    """A* od najbliższego węzła drogi przy starcie do najbliższego przy celu. Zwraca [[x, y], ...] albo []."""
    pts, adj = graph["pts"], graph["adj"]
    s, g = nearest(graph, *start), nearest(graph, *goal)
    dist = lambda a, b: math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
    best, prev, todo = {s: 0.0}, {}, [(dist(s, g), s)]
    while todo:
        _, cur = heapq.heappop(todo)
        if cur == g:
            path = [cur]
            while cur in prev:
                cur = prev[cur]
                path.append(cur)
            return [pts[i] for i in reversed(path)]
        for nxt in adj[cur]:
            d = best[cur] + dist(cur, nxt)
            if d < best.get(nxt, math.inf):
                best[nxt], prev[nxt] = d, cur
                heapq.heappush(todo, (d + dist(nxt, g), nxt))
    return []


def directions(path, min_turn=35):
    """Wskazówki: [{at: [x, y], dist: metry od poprzedniej, turn: "lewo"/"prawo"}] dla zakrętów powyżej min_turn stopni."""
    out, since = [], 0.0
    for i in range(1, len(path) - 1):
        (x0, y0), (x1, y1), (x2, y2) = path[i - 1], path[i], path[i + 1]
        since += math.hypot(x1 - x0, y1 - y0)
        a = math.degrees(math.atan2(y2 - y1, x2 - x1) - math.atan2(y1 - y0, x1 - x0))
        a = (a + 180) % 360 - 180  # w układzie gry oś Y rośnie na północ: dodatni kąt = skręt w lewo
        if abs(a) >= min_turn and since > 15:
            out.append({"at": path[i], "dist": round(since), "turn": "lewo" if a > 0 else "prawo"})
            since = 0.0
    return out


def selftest():
    # kwadrat 0-1-2-3 z przekątną 0-2: najkrótsza trasa z (0,0) do (100,100) idzie przekątną
    g = {"pts": [[0, 0], [100, 0], [100, 100], [0, 100]], "adj": [[1, 3, 2], [0, 2], [1, 3, 0], [2, 0]]}
    assert route(g, (1, 1), (99, 99)) == [[0, 0], [100, 100]]
    # odcięty kawałek (2 węzły) przy starcie: trasa zaczyna się od najbliższego punktu głównej sieci (3 węzły)
    g2 = {"pts": [[0, 0], [10, 0], [500, 0], [600, 0], [700, 0]], "adj": [[1], [0], [3], [2, 4], [3]]}
    assert route(g2, (0, 0), (700, 0)) == [[500, 0], [600, 0], [700, 0]]
    # jazda na północ (0,0)->(0,100), potem na zachód (-100,100): skręt w lewo
    assert directions([[0, 0], [0, 100], [-100, 100]]) == [{"at": [0, 100], "dist": 100, "turn": "lewo"}]
    assert directions([[0, 0], [0, 100], [100, 100]])[0]["turn"] == "prawo"
