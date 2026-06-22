#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从客户导入 Excel 生成前端 js/data.js（真实数据）。
   用法: python3 tools/xlsx_to_data.py <xlsx路径>
"""
import openpyxl, re, sys, json, os

# ---- 主要城市坐标（够覆盖数据里高频城市；缺的客户会落到国家中心）----
CITY_COORDS = {
    # Italy
    "milano":(45.4642,9.19),"roma":(41.9028,12.4964),"firenze":(43.7696,11.2558),
    "napoli":(40.8518,14.2681),"torino":(45.0703,7.6869),"genova":(44.4056,8.9463),
    "palermo":(38.1157,13.3613),"catania":(37.5079,15.083),"bari":(41.1171,16.8719),
    "bologna":(44.4949,11.3426),"venezia":(45.4408,12.3155),"verona":(45.4384,10.9916),
    "prato":(43.8777,11.0955),"rimini":(44.0678,12.5695),"cagliari":(39.2238,9.1217),
    "brescia":(45.5416,10.2118),"padova":(45.4064,11.8768),"verbania":(45.9217,8.5519),
    "tortona":(44.8943,8.8643),"viareggio":(43.8664,10.2503),"civitanova":(43.3074,13.7281),
    "monteprandone":(42.9167,13.8333),"funo di argelato":(44.6333,11.35),"san lazzaro di savena":(44.4716,11.41),
    # France
    "paris":(48.8566,2.3522),"aubervilliers":(48.9131,2.3835),"marseille":(43.2965,5.3698),
    "lyon":(45.764,4.8357),"lille":(50.6292,3.0573),"nice":(43.7102,7.262),
    # Germany
    "neuss":(51.198,6.6917),"dreieich":(50.0236,8.7),"munchen":(48.1351,11.582),
    "münchen":(48.1351,11.582),"berlin":(52.52,13.405),"frankfurt":(50.1109,8.6821),
    "hamburg":(53.5511,9.9937),"dusseldorf":(51.2277,6.7735),"köln":(50.9375,6.9603),
    # Greece
    "athens":(37.9838,23.7275),"athena":(37.9838,23.7275),"thessaloniki":(40.6401,22.9444),
    "patra":(38.2466,21.7346),
    # Spain
    "barcelona":(41.3851,2.1734),"madrid":(40.4168,-3.7038),"badalona":(41.45,2.2475),
    "fuenlabrada madrid":(40.2842,-3.7942),"valencia":(39.4699,-0.3763),
    # Others
    "budapest":(47.4979,19.0402),"wien":(48.2082,16.3738),"zagreb":(45.815,15.9819),
    "split":(43.5081,16.4402),"bucuresti":(44.4268,26.1025),"praha":(50.0755,14.4378),
    "warszawa":(52.2297,21.0122),"lisboa":(38.7223,-9.1393),"vila do conde":(41.3525,-8.7426),
    "bruxelles":(50.8503,4.3517),"amsterdam":(52.3676,4.9041),"sofia":(42.6977,23.3219),
    "lisbon":(38.7223,-9.1393),"porto":(41.1579,-8.6291),
}
# Italy city -> region
IT_REGION = {
    "milano":"Lombardia","brescia":"Lombardia","roma":"Lazio","firenze":"Toscana",
    "prato":"Toscana","viareggio":"Toscana","napoli":"Campania","torino":"Piemonte",
    "tortona":"Piemonte","verbania":"Piemonte","genova":"Liguria","palermo":"Sicilia",
    "catania":"Sicilia","bari":"Puglia","bologna":"Emilia-Romagna","rimini":"Emilia-Romagna",
    "funo di argelato":"Emilia-Romagna","san lazzaro di savena":"Emilia-Romagna",
    "venezia":"Veneto","verona":"Veneto","padova":"Veneto","cagliari":"Sardegna",
    "civitanova":"Marche","monteprandone":"Marche",
}

def norm(s): return re.sub(r"\s+"," ",str(s).strip()).lower()

# ---- 人工修正：有欠款但缺国家的客户，由 Livio 提供 ----
#   key = Excel 中的客户名字（精确匹配）; 值 = {国家, 城市(可选)}
OVERRIDES = {
    "Z group 2022":            {"country":"IT","city":"Padova"},
    "GLORIA FASHION GMBH":     {"country":"DE"},
    "芳芳围巾":                  {"country":"IT","city":"Prato"},
    "GaveLux":                 {"country":"IT","city":"Firenze"},
    "PELLETTERIA ELMAR SRL":   {"country":"IT"},            # 已有城市 Monteprandone
    "GIO TEX":                 {"country":"DE","city":"Neuss"},
    "FASHION MARKET / new dress": {"country":"IT","city":"Roma"},
    "Kay group":               {"country":"IT"},            # 已有城市 Funo di Argelato
    "URBAN CHIC SRL":          {"country":"IT","city":"Roma"},
    "euroingro":               {"country":"IT","city":"Prato"},
    "Leivip":                  {"country":"IT","city":"Firenze"},
    "旭日箱包 Girasole（允浪）":   {"country":"IT","city":"Milano"},
    "verofashion":             {"country":"PL"},   # pologna = 波兰 Poland（Livio 确认）
    "BELLA LEGGENDA DI CHEN LIN": {"country":"IT"},          # 已有城市 Bari
    "MORE BAG":                {"country":"DE","city":"Neuss"},
    "CORTE DEGLI ARANCI":      {"country":"IT"},
    "金华":                     {"country":"GR","city":"Thessaloniki"},  # el saloniki
    "GB":                      {"country":"HR"},             # croatia
    "neshika":                 {"country":"BE"},             # belgio
    "ADDIO MAGRE wtp 现金打posta": {"country":"IT","city":"Napoli"},
    "Gianni samoiedo":         {"country":"IT","city":"Firenze"},
    "- JackyJustin.de 安 张先生": {"country":"DE","city":"Neuss"},
}

def main(path):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)["Sheet1"]
    rows=[r for r in ws.iter_rows(min_row=3, values_only=True) if r and r[0] and str(r[0]).strip()]

    def country(r):
        c=r[18] or r[28]
        if c: return str(c).strip().upper()
        for i in (22,20):           # 税号反推
            v=r[i]
            if v:
                m=re.match(r"\s*([A-Za-z]{2})",str(v))
                if m:
                    cc=m.group(1).upper()
                    return "GR" if cc=="EL" else cc
        return None
    def city(r):
        c=r[17] or r[27]
        return str(c).strip() if c else None
    def debt(r):
        try: return round(float(r[5] or 0),2)
        except: return 0.0

    placed=[]; unplaced=0; unplaced_debt=0.0
    for r in rows:
        co=country(r); name=str(r[0]).strip(); cy=city(r); d=debt(r); sales=(str(r[1]).strip() if r[1] else None)
        ov=OVERRIDES.get(name)
        if ov:
            co=ov.get("country") or co
            cy=ov.get("city") or cy
        if not co:
            unplaced+=1; unplaced_debt+=d; continue
        rec={"company":name,"country":co}
        region=None
        if cy:
            rec["city"]=cy
            key=norm(cy)
            if key in CITY_COORDS:
                lat,lng=CITY_COORDS[key]; rec["lat"]=lat; rec["lng"]=lng
            if co=="IT" and key in IT_REGION:
                region=IT_REGION[key]
        if region: rec["region"]=region
        if d: rec["debt"]=d
        if sales: rec["sales"]=sales
        placed.append(rec)

    # 紧凑 JSON（一行一个客户）
    def line(rec):
        return "  "+json.dumps(rec, ensure_ascii=False, separators=(",",":"))
    body=",\n".join(line(r) for r in placed)
    js = f"""/* =====================================================================
 *  客户数据 —— 由 tools/xlsx_to_data.py 从真实导入表自动生成
 *  共 {len(placed)} 个可定位客户（有国家信息）。
 *  另有 {unplaced} 个客户因缺少国家信息未能上图（其中欠款合计 €{unplaced_debt:,.2f}）。
 *  ⚠ 本表无“最后联系/下单日期”，所以“久未联系”视角暂无数据。
 *     要点亮该视角，请提供带日期的导出，再重跑本脚本即可。
 * ===================================================================== */

const META = {{ unplaced: {unplaced}, unplacedDebt: {round(unplaced_debt,2)} }};

const CUSTOMERS = [
{body}
];

const THRESHOLDS = {{
  contact:    {{ ok: 30, warn: 90 }},
  repurchase: {{ ok: 30, warn: 90 }},
  debt:       {{ ok: 0,  warn: 5000 }},
}};

const MAP_CONFIG = {{
  europeGeoJSON: "assets/europe.geojson",
  regionSources: {{
    IT: {{ url: "assets/italy-regions.geojson", nameProp: "reg_name" }},
  }},
}};
"""
    out=os.path.join(os.path.dirname(__file__),"..","js","data.js")
    with open(out,"w",encoding="utf-8") as fh: fh.write(js)
    print(f"已生成 {out}")
    print(f"可定位客户 {len(placed)} | 未定位 {unplaced} | 未定位欠款 €{unplaced_debt:,.2f}")
    with_coord=sum(1 for r in placed if "lat" in r)
    print(f"其中有精确坐标(可城市打点) {with_coord} 个")

if __name__=="__main__":
    main(sys.argv[1] if len(sys.argv)>1 else
         "/root/.claude/uploads/2193f9bd-9279-5349-b56a-9dd264e1949d/a74d56a2-1782127989377193__.xlsx")
