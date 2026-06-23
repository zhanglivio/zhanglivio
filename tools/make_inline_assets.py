#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 geojson 转成内联 JS（赋值给全局变量），
   这样 file:// 双击 index.html 也能直接用，无需本地服务器 / 联网。"""
import json, os
BASE = os.path.join(os.path.dirname(__file__), "..", "assets")

JOBS = [
    ("europe.geojson", "europe.geojson.js", "__EUROPE_GEOJSON__"),
    ("italy-regions.geojson", "italy-regions.geojson.js", "__IT_REGIONS_GEOJSON__"),
]
for src, out, var in JOBS:
    data = json.load(open(os.path.join(BASE, src), encoding="utf-8"))
    js = "window." + var + "=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
    with open(os.path.join(BASE, out), "w", encoding="utf-8") as f:
        f.write(js)
    print(f"{out}  ({len(js)//1024} KB)  -> window.{var}")
