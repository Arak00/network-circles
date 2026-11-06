#!/usr/bin/env python3
"""Can people with colour-vision deficiency tell the circle colours apart?  python tests/palette_check.py

Reads PAL and the surface colours from web/, simulates protanopia, deuteranopia and tritanopia (Machado, Oliveira &
Fernandes 2009, severity 1.0, in linear RGB), and reports the closest pair of circle colours by CIEDE2000.
Pairs under MIN_DE are reported as warnings: no 8-colour palette keeps every pair apart under all three deficiencies,
so the viewer must not rely on colour alone (hovering or focusing a circle in the list highlights its members; the
layout test checks that). Fails (exit 1) when a colour is under 3:1 against the canvas surface (WCAG 1.4.11). Stdlib only."""
import json, math, os, re, sys
from itertools import combinations

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_DE = 10.0  # CIEDE2000; ~2 is "just noticeable", ~10 is a safe floor for telling categories apart at a glance
MACHADO = {
    "normal": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    "protanopia": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deuteranopia": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    "tritanopia": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def simulate(h, m):
    v = [lin(c) for c in rgb(h)]
    return [min(1, max(0, sum(m[i][j] * v[j] for j in range(3)))) for i in range(3)]  # linear RGB


def lab(l):  # linear sRGB -> CIELAB (D65)
    x = (0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2]) / 0.95047
    y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
    z = (0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2]) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def de2000(a, b):
    L1, a1, b1 = a
    L2, a2, b2 = b
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    G = 0.5 * (1 - math.sqrt(((C1 + C2) / 2) ** 7 / (((C1 + C2) / 2) ** 7 + 25 ** 7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p, h2p = math.degrees(math.atan2(b1, a1p)) % 360, math.degrees(math.atan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = 0 if C1p * C2p == 0 else (h2p - h1p if abs(h2p - h1p) <= 180 else h2p - h1p - 360 if h2p > h1p else h2p - h1p + 360)
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lm, Cm = (L1 + L2) / 2, (C1p + C2p) / 2
    hm = h1p + h2p if C1p * C2p == 0 else ((h1p + h2p) / 2 if abs(h1p - h2p) <= 180 else (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2)
    T = 1 - 0.17 * math.cos(math.radians(hm - 30)) + 0.24 * math.cos(math.radians(2 * hm)) + 0.32 * math.cos(math.radians(3 * hm + 6)) - 0.20 * math.cos(math.radians(4 * hm - 63))
    SL, SC, SH = 1 + 0.015 * (Lm - 50) ** 2 / math.sqrt(20 + (Lm - 50) ** 2), 1 + 0.045 * Cm, 1 + 0.015 * Cm * T
    RT = -2 * math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)) * math.sin(math.radians(60 * math.exp(-(((hm - 275) / 25) ** 2))))
    return math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH))


def contrast(h1, h2):
    Y = lambda h: sum(w * lin(c) for w, c in zip((0.2126, 0.7152, 0.0722), rgb(h)))
    a, b = sorted((Y(h1), Y(h2)), reverse=True)
    return (a + 0.05) / (b + 0.05)


def main():
    js = open(os.path.join(ROOT, "web", "app.js"), encoding="utf-8").read()
    html = open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    pal = {t: re.findall(r"#[0-9a-f]{6}", re.search(t + r":\s*\[([^\]]+)\]", js).group(1)) for t in ("light", "dark")}
    surf = re.findall(r"--surface:\s*(#[0-9a-f]{6})", html)  # light first, then dark
    flags, warns, report = [], [], {}
    for theme, cols in pal.items():
        bg = surf[0] if theme == "light" else surf[1]
        for vision, m in MACHADO.items():
            labs = [lab(simulate(c, m)) for c in cols]
            d, i, j = min((de2000(labs[i], labs[j]), i, j) for i, j in combinations(range(len(cols)), 2))
            close = [(cols[i], cols[j], round(de2000(labs[i], labs[j]), 1)) for i, j in combinations(range(len(cols)), 2)
                     if de2000(labs[i], labs[j]) < MIN_DE]
            report[f"{theme}/{vision}"] = {"min_de2000": round(d, 1), "pair": [cols[i], cols[j]], "below_floor": close}
            if close:
                warns.append(f"{theme}/{vision}: {len(close)} pairs under dE {MIN_DE}: {close}")
        low = [(c, round(contrast(c, bg), 2)) for c in cols if contrast(c, bg) < 3]
        report[f"{theme}/contrast_vs_surface"] = low
        if low:
            flags.append(f"{theme}: colours under 3:1 against the surface {bg}: {low}")
    for k, v in report.items():
        print(f"{k:28} {v if isinstance(v, list) else 'min dE2000 ' + str(v['min_de2000']) + ' ' + str(v['pair'])}")
    os.makedirs(os.path.join(ROOT, "tests", "report"), exist_ok=True)
    json.dump(report, open(os.path.join(ROOT, "tests", "report", "palette.json"), "w"), indent=1)
    print(f"\n{len(warns)} colour-vision warnings (colour is not the only cue), {len(flags)} failures")
    for w in warns:
        print("  WARN", w)
    for f in flags:
        print("  FAIL", f)
    return 1 if flags else 0


if __name__ == "__main__":
    assert abs(de2000((50, 2.6772, -79.7751), (50, 0, -82.7485)) - 2.0425) < 1e-3  # Sharma et al. test pair 1
    sys.exit(main())
