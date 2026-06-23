#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 Ramer–Douglas–Peucker 简化 GeoJSON 边界，显著减少坐标点以提升渲染性能。
   用法: python3 tools/simplify_geojson.py <in.geojson> <out.geojson> [tolerance] [precision]
"""
import json, sys, math

def rdp(points, eps):
    if len(points) < 3:
        return points
    # 找离首尾连线最远的点
    start, end = points[0], points[-1]
    dmax, idx = 0.0, 0
    x1, y1 = start; x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    seg2 = dx*dx + dy*dy
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if seg2 == 0:
            d = math.hypot(px - x1, py - y1)
        else:
            t = ((px - x1)*dx + (py - y1)*dy) / seg2
            t = max(0, min(1, t))
            projx, projy = x1 + t*dx, y1 + t*dy
            d = math.hypot(px - projx, py - projy)
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        left = rdp(points[:idx+1], eps)
        right = rdp(points[idx:], eps)
        return left[:-1] + right
    return [start, end]

def simp_ring(ring, eps, prec):
    r = rdp(ring, eps)
    if len(r) < 4:               # 太小的环丢弃
        return None
    out = [[round(x, prec), round(y, prec)] for x, y in r]
    if out[0] != out[-1]:        # 闭合
        out.append(out[0])
    return out

def simp_geom(geom, eps, prec):
    t = geom["type"]; c = geom["coordinates"]
    if t == "Polygon":
        rings = [r for r in (simp_ring(ring, eps, prec) for ring in c) if r]
        return {"type":"Polygon","coordinates":rings} if rings else None
    if t == "MultiPolygon":
        polys = []
        for poly in c:
            rings = [r for r in (simp_ring(ring, eps, prec) for ring in poly) if r]
            if rings:
                polys.append(rings)
        return {"type":"MultiPolygon","coordinates":polys} if polys else None
    return geom

def count(g):
    n=0
    def cnt(c):
        nonlocal n
        if isinstance(c,list):
            if c and isinstance(c[0],(int,float)): n+=1
            else:
                for x in c: cnt(x)
    for ft in g["features"]: cnt(ft["geometry"]["coordinates"])
    return n

def main(inp, outp, eps, prec):
    g = json.load(open(inp))
    before = count(g)
    feats=[]
    for ft in g["features"]:
        ng = simp_geom(ft["geometry"], eps, prec)
        if ng:
            feats.append({"type":"Feature","properties":ft["properties"],"geometry":ng})
    g["features"] = feats
    json.dump(g, open(outp,"w"), ensure_ascii=False, separators=(",",":"))
    after = count(g)
    print(f"{inp}: {before} -> {after} 点 ({after/before*100:.0f}%)")

if __name__ == "__main__":
    inp, outp = sys.argv[1], sys.argv[2]
    eps = float(sys.argv[3]) if len(sys.argv) > 3 else 0.02
    prec = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    main(inp, outp, eps, prec)
