#!/usr/bin/env python3
"""Trace les murs d'une carte et vérifie le résultat en image. Outil de préparation : l'app n'en
a pas besoin pour tourner. Il faut python3, Pillow, numpy et scipy.

  Premier jet, à partir du contraste entre le sol et le vide autour des pièces :
    python3 tools/map_walls.py trace "../images/carte.jpg" --cols 75 --rows 75 \
        --name "Les Fontaineries" --image "images/carte.jpg" --out maps/fontaineries.json

  Les murs dessinés par-dessus la carte, pour voir ce qui est faux :
    python3 tools/map_walls.py overlay maps/fontaineries.json out.png --vault ..
    python3 tools/map_walls.py overlay maps/fontaineries.json out.png --vault .. --crop 10,10,30,30

Ce que ce traçage ne peut pas décider : ce qui bloque la vue à l'intérieur d'une pièce, cuves,
arbres, buissons. Il ne voit que la limite entre le sol et le vide.
"""
import argparse
import json
import os
import sys
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None


def load_rgb(path, cols, rows, ppc):
    im = Image.open(path).convert("RGB")
    natural = im.size
    im = im.resize((round(cols * ppc), round(rows * ppc)), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32), natural


def stone_mask(rgb, ppc, spec):
    """Les murs de pierre dessinés en gris clair : « 60,140,0.3,2,1.5 » pour luminosité min et max,
    saturation max, ouverture en pixels pour effacer ce qui est fin, surface min en cases."""
    lo, hi, sat, opening, area = (float(v) for v in spec.split(","))
    top = rgb.max(axis=2)
    low = rgb.min(axis=2)
    top = ndi.median_filter(top, size=3)
    m = (top >= lo) & (top <= hi) & ((top - low) <= sat * np.maximum(top, 1))
    if opening:
        m = ndi.binary_opening(m, ndi.generate_binary_structure(2, 1), iterations=int(opening))
    lab, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        keep = np.zeros(n + 1, dtype=bool)
        keep[1:] = sizes >= area * ppc * ppc
        m = keep[lab]
    return m


def void_mask(rgb, ppc, threshold, min_void, min_floor, close_px, stone=""):
    """Vrai là où il n'y a que du vide : très sombre, sur une surface assez grande."""
    bright = rgb.max(axis=2)
    bright = ndi.median_filter(bright, size=3)
    void = bright < threshold
    if close_px:
        # Les étoiles et les petits détails clairs dans le vide disparaissent.
        s = ndi.generate_binary_structure(2, 1)
        void = ndi.binary_closing(void, s, iterations=close_px, border_value=1)
    # Les taches sombres sur le sol ne sont pas du vide ; les miettes de sol dans le vide non plus.
    area = ppc * ppc
    lab, n = ndi.label(void)
    if n:
        sizes = ndi.sum(void, lab, range(1, n + 1))
        keep = np.zeros(n + 1, dtype=bool)
        keep[1:] = sizes >= min_void * area
        void = keep[lab]
    if stone:
        void = void | stone_mask(rgb, ppc, stone)
    lab, n = ndi.label(~void)
    if n:
        sizes = ndi.sum(~void, lab, range(1, n + 1))
        drop = np.zeros(n + 1, dtype=bool)
        drop[1:] = sizes < min_floor * area
        void = void | drop[lab]
    return void


def tile_void_mask(image_path, tiles_x, tiles_y, threshold):
    """Pour une carte dessinée sur des tuiles régulières : chaque tuile est du sol ou du vide.
    Beaucoup plus propre qu'au pixel près, car les détails du sol ne comptent plus."""
    im = Image.open(image_path).convert("RGB")
    a = np.asarray(im, dtype=np.float32).max(axis=2)
    th, tw = a.shape[0] / tiles_y, a.shape[1] / tiles_x
    out = np.zeros((tiles_y, tiles_x), dtype=bool)
    for j in range(tiles_y):
        for i in range(tiles_x):
            c = a[int((j + 0.15) * th):int((j + 0.85) * th), int((i + 0.15) * tw):int((i + 0.85) * tw)]
            out[j, i] = np.median(c) < threshold
    return out


def trace_loops(mask):
    """Contours fermés de la limite entre vrai et faux, le long des bords de pixels."""
    h, w = mask.shape
    m = np.zeros((h + 2, w + 2), dtype=bool)
    m[1:-1, 1:-1] = mask
    nxt = defaultdict(list)
    # Arêtes orientées : le masque reste à gauche du sens de marche.
    ys, xs = np.nonzero(m[:-1, :] != m[1:, :])
    for y, x in zip(ys.tolist(), xs.tolist()):
        if m[y, x]:
            nxt[(x + 1, y + 1)].append((x, y + 1))
        else:
            nxt[(x, y + 1)].append((x + 1, y + 1))
    ys, xs = np.nonzero(m[:, :-1] != m[:, 1:])
    for y, x in zip(ys.tolist(), xs.tolist()):
        if m[y, x]:
            nxt[(x + 1, y)].append((x + 1, y + 1))
        else:
            nxt[(x + 1, y + 1)].append((x + 1, y))
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop = [start]
        cur = start
        prev_dir = None
        while True:
            options = nxt[cur]
            if len(options) == 1 or prev_dir is None:
                step = options.pop(0)
            else:
                # Deux pixels qui se touchent par un coin : on tourne pour ne pas croiser.
                def turn(o):
                    d = (o[0] - cur[0], o[1] - cur[1])
                    return prev_dir[0] * d[1] - prev_dir[1] * d[0]
                options.sort(key=turn, reverse=True)
                step = options.pop(0)
            if not options:
                del nxt[cur]
            prev_dir = (step[0] - cur[0], step[1] - cur[1])
            cur = step
            if cur == start:
                break
            loop.append(cur)
        loops.append(np.array(loop, dtype=np.float64) - 1)
    return loops


def simplify_closed(pts, tol):
    """Douglas-Peucker sur un contour fermé."""
    n = len(pts)
    if n < 4:
        return pts
    a = 0
    b = int(np.argmax(((pts - pts[0]) ** 2).sum(axis=1)))
    if b == 0:
        return pts[:1]

    def dp(lo, hi, out):
        stack = [(lo, hi)]
        keep = {lo, hi}
        while stack:
            i, j = stack.pop()
            if j <= i + 1:
                continue
            seg = pts[j] - pts[i]
            ln = np.hypot(*seg)
            rel = pts[i + 1:j] - pts[i]
            if ln == 0:
                d = np.hypot(rel[:, 0], rel[:, 1])
            else:
                d = np.abs(rel[:, 0] * seg[1] - rel[:, 1] * seg[0]) / ln
            k = int(np.argmax(d))
            if d[k] > tol:
                m = i + 1 + k
                keep.add(m)
                stack.append((i, m))
                stack.append((m, j))
        out.update(keep)

    keep = set()
    dp(a, b, keep)
    roll = np.vstack([pts, pts[:1]])
    pts_full = roll
    # Seconde moitié du contour, de b à la fin puis retour au départ.
    idx = list(range(b, n)) + [n]
    sub = pts_full[idx]
    keep2 = set()
    saved = pts
    pts = sub
    dp(0, len(sub) - 1, keep2)
    pts = saved
    result = sorted(keep | {idx[i] % n for i in keep2})
    return saved[result]


def to_polylines(loops, ppc, cols, rows, tol_cells, snap, min_len):
    walls = []
    margin = 0.02
    for loop in loops:
        pts = simplify_closed(loop, tol_cells * ppc) / ppc
        if len(pts) < 3:
            continue
        if snap:
            pts = np.round(pts / snap) * snap
        # On enlève les doublons et les segments le long du bord de l'image, qui ne bloquent rien de plus.
        clean = [pts[0]]
        for p in pts[1:]:
            if np.abs(p - clean[-1]).max() > 1e-6:
                clean.append(p)
        if len(clean) >= 2 and np.abs(clean[0] - clean[-1]).max() < 1e-6:
            clean.pop()
        if len(clean) < 3:
            continue
        def on_edge(a, b):
            return (abs(a[0] - b[0]) < 1e-6 and (a[0] <= margin or a[0] >= cols - margin)) or (abs(a[1] - b[1]) < 1e-6 and (a[1] <= margin or a[1] >= rows - margin))
        n = len(clean)
        keep = [not on_edge(clean[i], clean[(i + 1) % n]) for i in range(n)]
        if all(keep):
            poly = clean + [clean[0]]
            walls.append(poly)
        else:
            # Coupe aux segments retirés.
            start = next(i for i in range(n) if not keep[i])
            run = []
            for k in range(n):
                i = (start + 1 + k) % n
                if keep[i]:
                    if not run:
                        run = [clean[i]]
                    run.append(clean[(i + 1) % n])
                elif run:
                    walls.append(run)
                    run = []
            if run:
                walls.append(run)
    out = []
    for w in walls:
        ln = sum(np.hypot(*(w[i + 1] - w[i])) for i in range(len(w) - 1))
        if ln >= min_len:
            out.append({"kind": "wall", "points": [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in w]})
    return out


def detect_doors(rgb, ppc, cols, rows, colors):
    """Traits fins de couleur vive peints sur la carte, pour une carte qui marque ses portes ainsi."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    masks = {
        "bleu": (b > 150) & (b - r > 70) & (b - g > 35),
        "rouge": (r > 170) & (r - g > 110) & (r - b > 110),
        "jaune": (r > 200) & (g > 170) & (b < 110),
    }
    out = []
    for name in colors:
        lab, n = ndi.label(masks[name], structure=np.ones((3, 3)))
        for sl_i, sl in enumerate(ndi.find_objects(lab)):
            h = sl[0].stop - sl[0].start
            w = sl[1].stop - sl[1].start
            if max(w, h) < 0.8 * ppc or min(w, h) > 0.6 * ppc:
                continue
            x0, x1, y0, y1 = sl[1].start / ppc, sl[1].stop / ppc, sl[0].start / ppc, sl[0].stop / ppc
            if w >= h:
                y = (y0 + y1) / 2
                pts = [[round(x0, 3), round(y, 3)], [round(x1, 3), round(y, 3)]]
            else:
                x = (x0 + x1) / 2
                pts = [[round(x, 3), round(y0, 3)], [round(x, 3), round(y1, 3)]]
            out.append({"kind": "door", "open": False, "group": f"levier-{name}", "points": pts})
    return out


def scale_loop(loop, sx, sy):
    return loop * np.array([sx, sy])


def merge_straight(loop):
    """Sur une grille de tuiles, seuls les vrais angles du contour comptent."""
    n = len(loop)
    keep = []
    for i in range(n):
        a, b, c = loop[i - 1], loop[i], loop[(i + 1) % n]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0:
            keep.append(b)
    return np.array(keep)


def tile_polylines(mask, cols, rows):
    tiles_y, tiles_x = mask.shape
    sx, sy = cols / tiles_x, rows / tiles_y
    walls = []
    for loop in trace_loops(mask):
        pts = merge_straight(loop)
        if len(pts) < 3:
            continue
        pts = scale_loop(pts, sx, sy)
        walls.append(pts)
    out = []
    margin = 0.02
    for pts in walls:
        n = len(pts)
        def on_edge(a, b):
            return (abs(a[0] - b[0]) < 1e-6 and (a[0] <= margin or a[0] >= cols - margin)) or (abs(a[1] - b[1]) < 1e-6 and (a[1] <= margin or a[1] >= rows - margin))
        keep = [not on_edge(pts[i], pts[(i + 1) % n]) for i in range(n)]
        polys = []
        if all(keep):
            polys.append(list(pts) + [pts[0]])
        else:
            start = next(i for i in range(n) if not keep[i])
            run = []
            for k in range(n):
                i = (start + 1 + k) % n
                if keep[i]:
                    if not run:
                        run = [pts[i]]
                    run.append(pts[(i + 1) % n])
                elif run:
                    polys.append(run)
                    run = []
            if run:
                polys.append(run)
        for w in polys:
            out.append({"kind": "wall", "points": [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in w]})
    return out


def parse_tiles(spec):
    """« 24-30,32-34 5,3 » : colonnes, rangées. Pour corriger une tuile mal classée."""
    out = []
    for part in (spec or "").split():
        cs, rs = part.split(",")
        c0, c1 = (int(v) for v in (cs.split("-") if "-" in cs else (cs, cs)))
        r0, r1 = (int(v) for v in (rs.split("-") if "-" in rs else (rs, rs)))
        out.append((c0, c1, r0, r1))
    return out


def cmd_trace(a):
    rgb, natural = load_rgb(a.image, a.cols, a.rows, a.ppc)
    if a.tiles:
        tx, ty = (int(v) for v in a.tiles.split("x")) if "x" in a.tiles else (int(a.tiles), int(a.tiles))
        void = tile_void_mask(a.image, tx, ty, a.threshold)
        for value, spec in ((False, a.floor), (True, a.void)):
            for c0, c1, r0, r1 in parse_tiles(spec):
                void[r0:r1 + 1, c0:c1 + 1] = value
        walls = tile_polylines(void, a.cols, a.rows)
    else:
        void = void_mask(rgb, a.ppc, a.threshold, a.min_void, a.min_floor, a.close, a.stone)
        loops = trace_loops(void)
        walls = to_polylines(loops, a.ppc, a.cols, a.rows, a.tol, a.snap, a.min_len)
    doors = detect_doors(rgb, a.ppc, a.cols, a.rows, a.door_colors.split(",")) if a.door_colors else []
    scene = {
        "format": 1, "name": a.name or os.path.splitext(os.path.basename(a.image))[0], "image": a.image_ref or a.image,
        "imageSize": list(natural), "grid": {"cols": a.cols, "rows": a.rows, "feetPerCell": a.feet},
        "walls": walls + doors,
    }
    head = {k: v for k, v in scene.items() if k != "walls"}
    lines = [f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},' for k, v in head.items()]
    lines.append('  "walls": [')
    lines += [f"    {json.dumps(w)}{',' if i < len(scene['walls']) - 1 else ''}" for i, w in enumerate(scene["walls"])]
    lines.append("  ]")
    text = "{\n" + "\n".join(lines) + "\n}\n"
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf8") as f:
            f.write(text)
    segs = sum(len(w["points"]) - 1 for w in walls)
    print(f"{len(walls)} murs, {segs} segments, {len(doors)} portes · vide {void.mean():.0%} de l'image")
    if a.debug_mask:
        Image.fromarray((void * 255).astype(np.uint8)).save(a.debug_mask)


def cmd_overlay(a):
    with open(a.scene, encoding="utf8") as f:
        scene = json.load(f)
    path = scene["image"] if os.path.isabs(scene["image"]) else os.path.join(a.vault, scene["image"])
    im = Image.open(path).convert("RGB")
    cols, rows = scene["grid"]["cols"], scene["grid"]["rows"]
    # Le décalage de la grille : les coordonnées restent celles de la scène.
    ox, oy = scene["grid"].get("offset", [0, 0])
    crop = [float(v) for v in a.crop.split(",")] if a.crop else [-ox, -oy, cols - ox, rows - oy]
    cw, ch = im.size[0] / cols, im.size[1] / rows
    x0, y0, x1, y1 = crop
    im = im.crop((int((x0 + ox) * cw), int((y0 + oy) * ch), int((x1 + ox) * cw), int((y1 + oy) * ch)))
    k = min(a.size / im.size[0], a.size / im.size[1])
    im = im.resize((int(im.size[0] * k), int(im.size[1] * k)), Image.LANCZOS)
    px = im.size[0] / (x1 - x0)
    d = ImageDraw.Draw(im)
    conv = lambda p: ((p[0] - x0) * px, (p[1] - y0) * px)
    if a.grid:
        step = int(a.grid)
        font = ImageFont.load_default()
        for gx in range(int(np.ceil(x0 / step)) * step, int(x1) + 1, step):
            d.line([conv((gx, y0)), conv((gx, y1))], fill=(255, 255, 255), width=1)
            d.text(conv((gx + 0.1, y0 + 0.1)), str(gx), fill=(255, 255, 0), font=font)
        for gy in range(int(np.ceil(y0 / step)) * step, int(y1) + 1, step):
            d.line([conv((x0, gy)), conv((x1, gy))], fill=(255, 255, 255), width=1)
            d.text(conv((x0 + 0.1, gy + 0.1)), str(gy), fill=(255, 255, 0), font=font)
    if a.tiles:
        font = ImageFont.load_default()
        step = cols / a.tiles
        for i in range(a.tiles + 1):
            gx = i * step
            if x0 <= gx <= x1:
                d.line([conv((gx, y0)), conv((gx, y1))], fill=(255, 255, 255), width=1)
                d.text(conv((gx + 0.1, y0 + 0.1)), str(i), fill=(255, 255, 0), font=font)
            gy = i * rows / a.tiles
            if y0 <= gy <= y1:
                d.line([conv((x0, gy)), conv((x1, gy))], fill=(255, 255, 255), width=1)
                d.text(conv((x0 + 0.1, gy + 0.1)), str(i), fill=(255, 255, 0), font=font)
    colors = {"bleu": (70, 160, 255), "rouge": (255, 70, 70), "jaune": (255, 220, 60), "vert": (120, 255, 140)}
    for w in scene["walls"]:
        pts = [conv(p) for p in w["points"]]
        if w.get("kind") == "door":
            g = w.get("group", "")
            c = next((v for k2, v in colors.items() if k2 in g), (120, 255, 140))
            d.line(pts, fill=(0, 0, 0), width=7)
            d.line(pts, fill=c, width=4)
        else:
            d.line(pts, fill=(0, 255, 255), width=2)
            if a.points:
                for p in pts:
                    d.ellipse([p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2], fill=(255, 0, 255))
    im.save(a.out, quality=88)
    print(f"{a.out} : {im.size[0]} × {im.size[1]}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("trace")
    t.add_argument("image")
    t.add_argument("--cols", type=float, required=True)
    t.add_argument("--rows", type=float, required=True)
    t.add_argument("--feet", type=int, default=5)
    t.add_argument("--stone", default="", help="murs en pierre grise : min,max,saturation,ouverture,surface")
    t.add_argument("--floor", default="", help="tuiles à compter comme du sol, « 24-30,32-34 5,3 »")
    t.add_argument("--void", default="", help="tuiles à compter comme du vide")
    t.add_argument("--ppc", type=int, default=16, help="pixels par case pendant l'analyse")
    t.add_argument("--threshold", type=float, default=38, help="luminosité sous laquelle c'est du vide")
    t.add_argument("--tiles", default="", help="carte en tuiles régulières : 40, ou 40x30 pour colonnes x rangées")
    t.add_argument("--min-void", type=float, default=1.0, help="surface minimale d'un vide, en cases")
    t.add_argument("--min-floor", type=float, default=1.0, help="surface minimale d'un morceau de sol, en cases")
    t.add_argument("--close", type=int, default=1, help="fermeture du masque de vide, en pixels")
    t.add_argument("--tol", type=float, default=0.25, help="écart toléré au contour, en cases")
    t.add_argument("--snap", type=float, default=0, help="cale les sommets sur ce pas, en cases")
    t.add_argument("--min-len", type=float, default=0.5, help="longueur minimale d'un mur, en cases")
    t.add_argument("--door-colors", default="", help="bleu,rouge,jaune : traits de couleur à lire comme des portes")
    t.add_argument("--name", default="")
    t.add_argument("--image-ref", "--image", dest="image_ref", default="", help="chemin de l'image, relatif au coffre")
    t.add_argument("--out", default="")
    t.add_argument("--debug-mask", default="")
    t.set_defaults(fn=cmd_trace)
    o = sub.add_parser("overlay")
    o.add_argument("scene")
    o.add_argument("out")
    o.add_argument("--vault", default="..")
    o.add_argument("--crop", default="", help="x0,y0,x1,y1 en cases")
    o.add_argument("--size", type=int, default=1400)
    o.add_argument("--grid", default="", help="trace une grille numérotée tous les N cases")
    o.add_argument("--points", action="store_true", help="montre les sommets")
    o.add_argument("--tiles", type=int, default=0, help="numérote une grille de N tuiles")
    o.set_defaults(fn=cmd_overlay)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
