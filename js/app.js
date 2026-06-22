/* =====================================================================
 *  欧洲客户经营雷达 —— 交互逻辑
 *  目标：一眼看出「哪里空白(待开发)」「哪里客户变冷(要维护)」
 *  视角(透镜)：客户密度 / 久未联系 / 欠款
 *  下钻：欧洲 → 国家 → 大区 → 城市(客户)
 * ===================================================================== */
(function () {
  "use strict";

  const svg = d3.select("#map");
  const stage = document.getElementById("stage");
  const tooltip = d3.select("#tooltip");
  const loadingEl = document.getElementById("loading");
  const backBtn = document.getElementById("backBtn");
  const breadcrumbEl = document.getElementById("breadcrumb");
  const panel = document.getElementById("panel");
  const panelTitle = document.getElementById("panelTitle");
  const panelBody = document.getElementById("panelBody");
  const insBody = document.getElementById("insBody");
  const insTitle = document.getElementById("insTitle");

  let W = stage.clientWidth, H = stage.clientHeight;
  svg.attr("viewBox", `0 0 ${W} ${H}`);

  const projection = d3.geoMercator();
  const path = d3.geoPath(projection);

  const gRoot = svg.append("g");
  const gCountries = gRoot.append("g").attr("class", "layer-countries");
  const gRegions   = gRoot.append("g").attr("class", "layer-regions");
  const gCities    = gRoot.append("g").attr("class", "layer-cities");

  let currentK = 1;
  const zoom = d3.zoom().scaleExtent([0.8, 300]).on("zoom", (e) => {
    gRoot.attr("transform", e.transform);
    currentK = e.transform.k;
    rescaleCities();
    gRoot.selectAll(".feature-label").style("font-size", (11 / currentK) + "px");
  });
  svg.call(zoom).on("dblclick.zoom", null);

  let activeLens = "density";

  // 导航栈：{ type:'europe'|'country'|'region', label, feature, iso2 }
  let nav = [{ type: "europe", label: "欧洲" }];

  let europeFeatures = [];
  let regionFeaturesCache = {};

  // 当前层的洞察数据与重绘函数（切换视角时复用，不重新缩放）
  let insightItems = [];           // [{ name, list, onClick }]
  let currentRepaint = () => {};

  // ===================================================================
  //  客户索引
  // ===================================================================
  const norm = (s) => (s || "").toString().trim().toLowerCase().replace(/[''`]/g, "'");
  const custByCountry = (iso) => CUSTOMERS.filter((c) => (c.country || "").toUpperCase() === iso);
  const custByRegion  = (r)   => CUSTOMERS.filter((c) => norm(c.region) === norm(r));
  const custByCity    = (c2)  => CUSTOMERS.filter((c) => norm(c.city) === norm(c2));

  // ===================================================================
  //  视角(透镜)定义
  // ===================================================================
  const fmt = (n) => Number(n || 0).toLocaleString("de-DE");
  const money = (n, cur) => (cur || "€") + fmt(n);

  function contactClass(d) {
    if (d == null || Number.isNaN(d)) return "muted";
    if (d <= THRESHOLDS.contact.ok) return "good";
    if (d <= THRESHOLDS.contact.warn) return "warn";
    return "bad";
  }
  // 取一个客户的“未联系天数”：优先联系日期，其次回购；都没有则 null
  function coldDays(c) {
    if (c.daysSinceContact != null) return +c.daysSinceContact;
    if (c.daysSinceRepurchase != null) return +c.daysSinceRepurchase;
    return null;
  }
  function maxCold(list) {
    const vals = list.map(coldDays).filter((v) => v != null && !Number.isNaN(v));
    return vals.length ? Math.max(...vals) : null;
  }
  function debtClass(a) {
    if (a <= THRESHOLDS.debt.ok) return "good";
    if (a <= THRESHOLDS.debt.warn) return "warn";
    return "bad";
  }
  const CLR = { good: "#36c98e", warn: "#f5b942", bad: "#ff5c6c" };

  // 取一组客户的“代表值”和颜色（按当前视角）
  function lensCell(list, densityScale) {
    if (activeLens === "density") {
      const n = list.length;
      if (n === 0) return { value: 0, text: "0", fill: getCss("--gap-fill"), gap: true, cls: "gap" };
      return { value: n, text: String(n), fill: densityScale(n), gap: false, cls: "" };
    }
    if (activeLens === "cold") {
      if (!list.length) return { value: -1, text: "无客户", fill: getCss("--neutral"), gap: false, cls: "muted", empty: true };
      const v = maxCold(list);
      if (v == null) return { value: -1, text: "无日期", fill: getCss("--neutral"), gap: false, cls: "muted", empty: true };
      const cls = contactClass(v);
      return { value: v, text: v + "天", fill: CLR[cls] || getCss("--neutral"), gap: false, cls };
    }
    // debt
    if (!list.length) return { value: -1, text: "无客户", fill: getCss("--neutral"), gap: false, cls: "muted", empty: true };
    const v = d3.sum(list, (c) => +c.debt || 0);
    const cls = debtClass(v);
    return { value: v, text: money(v), fill: CLR[cls] || getCss("--neutral"), gap: false, cls };
  }

  function getCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  // 给一组要素上色（fill 用属性，:hover 才能覆盖）
  function paint(selection, custFn) {
    const feats = selection.data();
    const maxC = d3.max(feats, (f) => custFn(f).length) || 1;
    const dScale = d3.scaleSequential()
      .domain([0, Math.max(2, maxC)])
      .interpolator(d3.interpolateRgb("#23365e", "#4da3ff"));
    selection.each(function (f) {
      const cell = lensCell(custFn(f), dScale);
      d3.select(this).attr("fill", cell.fill).classed("gap", !!cell.gap);
    });
  }

  // ===================================================================
  //  加载欧洲底图
  // ===================================================================
  fetchJSON(MAP_CONFIG.europeGeoJSON)
    .then((geo) => {
      europeFeatures = geo.features;
      projection.fitSize([W, H], geo);
      renderEurope();
      loadingEl.hidden = true;
    })
    .catch((err) => {
      loadingEl.textContent = "地图底图加载失败（检查网络 / CDN）：" + err.message;
      console.error(err);
    });

  function fetchJSON(url) {
    return fetch(url).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function isoOf(f) { const p = f.properties || {}; return (p.ISO2 || p.iso_a2 || p.ISO_A2 || "").toUpperCase(); }
  function nameOf(f) { const p = f.properties || {}; return p.NAME || p.name || p.NAME_ENGL || p.admin || ""; }

  // ===================================================================
  //  LEVEL 0 —— 欧洲（所有国家）
  // ===================================================================
  function renderEurope() {
    nav = [{ type: "europe", label: "欧洲" }];
    clearLayers();
    fitTo(null, 0);

    const sel = gCountries.selectAll("path")
      .data(europeFeatures, (d) => isoOf(d) || nameOf(d))
      .join("path")
      .attr("class", "feature")
      .attr("d", path)
      .on("mousemove", (e, d) => renderTooltip(e, nameOf(d), custByCountry(isoOf(d))))
      .on("mouseleave", hideTooltip)
      .on("click", (e, d) => enterCountry(d));

    const custFn = (d) => custByCountry(isoOf(d));
    currentRepaint = () => {
      paint(sel, custFn);
      drawLabels(gCountries, europeFeatures.filter((d) => custByCountry(isoOf(d)).length), nameOf);
      insightItems = europeFeatures.map((d) => ({
        name: nameOf(d), list: custFn(d), onClick: () => enterCountry(d),
      }));
      buildInsights("欧洲 · 各国");
    };
    currentRepaint();
    syncChrome();
  }

  // ===================================================================
  //  LEVEL 1 —— 国家
  // ===================================================================
  function enterCountry(d) {
    const iso = isoOf(d);
    nav.push({ type: "country", label: nameOf(d), feature: d, iso2: iso });
    hideTooltip();
    syncChrome();

    gCountries.selectAll("path").classed("dimmed", (n) => n !== d);
    gCountries.selectAll(".feature-label").remove();
    fitTo(d, 750);

    const cfg = MAP_CONFIG.regionSources[iso];
    if (!cfg) { gRegions.selectAll("*").remove(); renderCitiesForCountry(iso, d); return; }

    const loadRegions = regionFeaturesCache[iso]
      ? Promise.resolve(regionFeaturesCache[iso])
      : fetchJSON(cfg.url).then((geo) => (regionFeaturesCache[iso] = geo.features));
    loadRegions.then((feats) => renderRegions(iso, cfg, feats))
      .catch((err) => { console.error(err); renderCitiesForCountry(iso, d); });
  }

  function renderRegions(iso, cfg, feats) {
    gCities.selectAll("*").remove();
    const regName = (f) => f.properties[cfg.nameProp] || nameOf(f);

    const sel = gRegions.selectAll("path")
      .data(feats, regName)
      .join((enter) => enter.append("path").attr("class", "feature").attr("d", path)
        .style("opacity", 0).call((en) => en.transition().duration(500).style("opacity", 1)))
      .attr("d", path)
      .on("mousemove", (e, d) => renderTooltip(e, regName(d), custByRegion(regName(d))))
      .on("mouseleave", hideTooltip)
      .on("click", (e, d) => enterRegion(d, regName(d)));

    const custFn = (d) => custByRegion(regName(d));
    currentRepaint = () => {
      paint(sel, custFn);
      drawLabels(gRegions, feats.filter((d) => custFn(d).length), regName);
      insightItems = feats.map((d) => ({ name: regName(d), list: custFn(d), onClick: () => enterRegion(d, regName(d)) }));
      buildInsights(nameOf(nav[1].feature) + " · 各大区");
    };
    currentRepaint();
    rescaleCities();
  }

  // ===================================================================
  //  LEVEL 2 —— 大区 → 城市
  // ===================================================================
  function enterRegion(feature, regionName) {
    nav.push({ type: "region", label: regionName, feature });
    hideTooltip();
    syncChrome();
    gRegions.selectAll("path").classed("dimmed", (n) => n !== feature);
    gRegions.selectAll(".feature-label").remove();
    fitTo(feature, 750);
    renderCities(custByRegion(regionName), feature, regionName + " · 各城市");
  }

  function renderCitiesForCountry(iso, feature) {
    renderCities(custByCountry(iso), feature, nameOf(feature) + " · 各城市");
  }

  function renderCities(custList, parentFeature, insLabel) {
    gCities.selectAll("*").remove();
    const byCity = d3.group(custList, (c) => c.city || "未知城市");
    const fallback = parentFeature ? path.centroid(parentFeature) : [W / 2, H / 2];

    const cities = Array.from(byCity, ([city, list]) => {
      const withCoord = list.find((c) => c.lat != null && c.lng != null);
      const xy = withCoord ? projection([+withCoord.lng, +withCoord.lat]) : fallback;
      return { city, list, x: xy[0], y: xy[1] };
    });

    const g = gCities.selectAll(".city").data(cities, (d) => d.city).join("g")
      .attr("class", "city")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .on("mousemove", (e, d) => renderTooltip(e, d.city, d.list))
      .on("mouseleave", hideTooltip)
      .on("click", (e, d) => openPanel(d.city, d.list));
    g.append("circle").attr("class", "ring");
    g.append("circle").attr("class", "core");
    g.append("text").attr("class", "city-label").text((d) => d.city);

    currentRepaint = () => {
      rescaleCities();
      insightItems = cities.map((c) => ({ name: c.city, list: c.list, onClick: () => openPanel(c.city, c.list) }));
      buildInsights(insLabel || "城市");
    };
    currentRepaint();
  }

  function rescaleCities() {
    const r = 6 / currentK, fz = 11 / currentK, off = 10 / currentK;
    gCities.selectAll(".city .ring").attr("r", r + 4 / currentK)
      .attr("stroke", (d) => markerColor(d.list)).attr("stroke-width", 2 / currentK);
    gCities.selectAll(".city .core").attr("r", r)
      .attr("fill", (d) => markerColor(d.list)).attr("stroke-width", 1 / currentK);
    gCities.selectAll(".city-label").attr("x", off + 4 / currentK).attr("y", fz / 3).style("font-size", fz + "px");
  }

  function markerColor(list) {
    if (!list.length) return getCss("--neutral");
    if (activeLens === "debt") return CLR[debtClass(d3.sum(list, (c) => +c.debt || 0))];
    const worst = maxCold(list);
    if (worst == null) return getCss("--accent"); // 有客户但无日期：中性蓝
    return CLR[contactClass(worst)];
  }

  // ===================================================================
  //  Tooltip
  // ===================================================================
  function renderTooltip(event, title, list) {
    if (!list || !list.length) {
      tooltip.html(`<div class="tt-head">${escapeHtml(title)}</div>
        <div class="tt-sub" style="color:var(--bad)">🕳️ 暂无客户 — 待开发机会</div>`);
      tooltip.node().hidden = false; positionTooltip(event); return;
    }
    const shown = list.slice(0, 8);
    const rows = shown.map((c) => {
      const dc = coldDays(c);
      const ccls = contactClass(dc);
      const coldPill = dc == null
        ? `<span class="pill cold">无联系日期</span>`
        : `<span class="pill cold ${ccls === "good" ? "ok" : ccls === "bad" ? "bad" : ""}">${dc}天未联系</span>`;
      return `<div class="tt-row">
        <span class="tt-name">${escapeHtml(c.company)}</span>
        <span class="tt-meta">
          ${coldPill}
          <span class="pill debt ${(+c.debt) ? "" : "zero"}">欠 ${money(c.debt, c.currency)}</span>
        </span></div>`;
    }).join("");
    const more = list.length > shown.length
      ? `<div class="tt-row" style="justify-content:center;color:var(--muted)">…共 ${list.length} 个，点击查看</div>` : "";
    const totalDebt = d3.sum(list, (c) => +c.debt || 0);
    const mc = maxCold(list);
    const coldTxt = mc == null ? "无联系日期数据" : `最久未联系 ${mc} 天`;
    tooltip.html(`<div class="tt-head">${escapeHtml(title)} · <span class="count">${list.length} 个客户</span></div>
      <div class="tt-sub">${coldTxt} · 合计欠款 ${money(totalDebt)}</div>${rows}${more}`);
    tooltip.node().hidden = false; positionTooltip(event);
  }
  function positionTooltip(event) {
    const rect = stage.getBoundingClientRect();
    tooltip.style("left", (event.clientX - rect.left) + "px").style("top", (event.clientY - rect.top) + "px");
  }
  function hideTooltip() { tooltip.node().hidden = true; }

  // ===================================================================
  //  洞察排行榜
  // ===================================================================
  function buildInsights(title) {
    insTitle.textContent = "洞察 · " + title;
    const withCust = insightItems.filter((it) => it.list.length);
    const empties  = insightItems.filter((it) => !it.list.length);

    const totalCust = d3.sum(insightItems, (it) => it.list.length);
    const totalDebt = d3.sum(insightItems, (it) => d3.sum(it.list, (c) => +c.debt || 0));
    const stat = `<div class="ins-stat">
      <span>区域 <b>${insightItems.length}</b></span>
      <span>客户 <b>${totalCust}</b></span>
      <span>空白 <b style="color:var(--bad)">${empties.length}</b></span>
      <span>欠款 <b>${money(totalDebt)}</b></span></div>`;

    let html = stat;
    // 顶层提示未定位客户
    if (nav.length === 1 && typeof META !== "undefined" && META.unplaced) {
      html += `<div class="ins-stat" style="color:var(--warn)">⚠ 另有 <b>${META.unplaced}</b> 个客户缺国家信息未上图（含欠款 ${money(META.unplacedDebt)}）</div>`;
    }

    if (activeLens === "density") {
      // 空白区（机会）+ 客户最多
      html += section("🕳️ 空白区域 · 待开发", empties.slice(0, 20).map((it) =>
        item(it, `<span class="vv gap">0</span>`)), "全部区域都有客户 🎉");
      const top = withCust.slice().sort((a, b) => b.list.length - a.list.length).slice(0, 8);
      html += section("🏆 客户最多", top.map((it) =>
        item(it, `<span class="vv">${it.list.length}</span>`)));
    } else if (activeLens === "cold") {
      // 最久未联系（要维护）
      const ranked = withCust.map((it) => ({ it, v: maxCold(it.list) }))
        .filter((x) => x.v != null).sort((a, b) => b.v - a.v);
      const emptyMsg = ranked.length ? "" : "本数据没有“最后联系/下单日期”，此视角暂无数据。导入带日期的表后即可点亮。";
      html += section("❄️ 最久未联系 · 去维护", ranked.slice(0, 15).map(({ it, v }) =>
        item(it, `<span class="vv ${contactClass(v)}">${v}天</span>`)), emptyMsg);
    } else {
      // 欠款最高
      const ranked = withCust.map((it) => ({ it, v: d3.sum(it.list, (c) => +c.debt || 0) }))
        .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
      html += section("💰 欠款最高 · 去催收", ranked.slice(0, 15).map(({ it, v }) =>
        item(it, `<span class="vv bad">${money(v)}</span>`)), "暂无欠款");
    }
    insBody.innerHTML = html;
    // 绑定点击
    Array.from(insBody.querySelectorAll(".ins-item")).forEach((el, i) => {
      const idx = +el.dataset.idx;
      el.onclick = () => { const t = insightItems[idx]; if (t && t.onClick) t.onClick(); };
    });
  }
  function section(title, rows, emptyMsg) {
    const body = rows.length ? rows.join("") : `<div class="ins-empty">${emptyMsg || "无"}</div>`;
    return `<div class="ins-section"><h4>${title}</h4>${body}</div>`;
  }
  function item(it, valHtml) {
    const idx = insightItems.indexOf(it);
    return `<div class="ins-item" data-idx="${idx}">
      <span class="nm">${escapeHtml(it.name)}</span>${valHtml}</div>`;
  }

  // ===================================================================
  //  城市客户明细面板
  // ===================================================================
  function openPanel(city, list) {
    panelTitle.textContent = city + " · " + list.length + " 个客户";
    const sorted = list.slice().sort((a, b) => worstScore(b) - worstScore(a));
    panelBody.innerHTML = sorted.map((c) => {
      const dc = coldDays(c);
      const ccls = contactClass(dc), dcls = debtClass(+c.debt || 0);
      const alert = (ccls === "bad" || dcls === "bad") ? " alert" : "";
      const dcTxt = dc == null ? "—" : dc;
      const rpTxt = c.daysSinceRepurchase != null ? c.daysSinceRepurchase : "—";
      return `<div class="cust-card${alert}">
        <div class="name">${escapeHtml(c.company)}</div>
        <div class="metrics">
          <div class="metric"><div class="label">未联系天数</div><div class="value ${ccls}">${dcTxt}<small style="font-size:12px"> 天</small></div></div>
          <div class="metric"><div class="label">未回购天数</div><div class="value ${contactClass(c.daysSinceRepurchase != null ? +c.daysSinceRepurchase : null)}">${rpTxt}<small style="font-size:12px"> 天</small></div></div>
          <div class="metric"><div class="label">欠款</div><div class="value ${dcls}">${money(c.debt, c.currency)}</div></div>
        </div>
        ${c.sales ? `<div class="sub">👤 专属销售：${escapeHtml(c.sales)}</div>` : ""}
        ${c.note ? `<div class="sub">📌 ${escapeHtml(c.note)}</div>` : ""}
      </div>`;
    }).join("");
    panel.hidden = false;
  }
  function worstScore(c) {
    const dc = (c.daysSinceContact != null) ? +c.daysSinceContact : +c.daysSinceRepurchase || 0;
    return (+c.debt || 0) + dc * 50;
  }
  document.getElementById("panelClose").onclick = () => (panel.hidden = true);

  // ===================================================================
  //  缩放到要素
  // ===================================================================
  function fitTo(feature, duration) {
    let t;
    if (!feature) { t = d3.zoomIdentity; }
    else {
      const [[x0, y0], [x1, y1]] = path.bounds(feature);
      const dx = x1 - x0, dy = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const k = Math.min(120, 0.85 / Math.max(dx / W, dy / H));
      t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy);
    }
    svg.transition().duration(duration).call(zoom.transform, t);
  }

  // ===================================================================
  //  导航
  // ===================================================================
  function goBack() {
    if (nav.length <= 1) return;
    nav.pop();
    panel.hidden = true;
    const top = nav[nav.length - 1];
    if (top.type === "europe") {
      gRegions.selectAll("*").remove(); gCities.selectAll("*").remove();
      gCountries.selectAll("path").classed("dimmed", false);
      renderEurope();
    } else if (top.type === "country") {
      gCities.selectAll("*").remove();
      gRegions.selectAll("path").classed("dimmed", false);
      const f = top.feature, iso = top.iso2;
      gCountries.selectAll("path").classed("dimmed", (n) => n !== f);
      fitTo(f, 600);
      const cfg = MAP_CONFIG.regionSources[iso];
      if (cfg && regionFeaturesCache[iso]) renderRegions(iso, cfg, regionFeaturesCache[iso]);
    }
    syncChrome();
  }
  backBtn.onclick = goBack;

  function jumpTo(index) {
    while (nav.length - 1 > index) nav.pop();
    const top = nav[index];
    panel.hidden = true;
    if (top.type === "europe") {
      gRegions.selectAll("*").remove(); gCities.selectAll("*").remove();
      gCountries.selectAll("path").classed("dimmed", false);
      renderEurope();
    } else if (top.type === "country") {
      gCities.selectAll("*").remove();
      gRegions.selectAll("path").classed("dimmed", false);
      gCountries.selectAll("path").classed("dimmed", (n) => n !== top.feature);
      fitTo(top.feature, 600);
      const cfg = MAP_CONFIG.regionSources[top.iso2];
      if (cfg && regionFeaturesCache[top.iso2]) renderRegions(top.iso2, cfg, regionFeaturesCache[top.iso2]);
    }
    syncChrome();
  }

  function syncChrome() {
    backBtn.hidden = nav.length <= 1;
    breadcrumbEl.innerHTML = "";
    nav.forEach((n, i) => {
      if (i > 0) { const s = document.createElement("span"); s.className = "sep"; s.textContent = "›"; breadcrumbEl.appendChild(s); }
      const c = document.createElement("span");
      c.className = "crumb" + (i === nav.length - 1 ? " active" : "");
      c.textContent = n.label; c.onclick = () => jumpTo(i);
      breadcrumbEl.appendChild(c);
    });
  }

  // ===================================================================
  //  工具 / 控件
  // ===================================================================
  function drawLabels(layer, feats, nameFn) {
    layer.selectAll(".feature-label").remove();
    layer.selectAll(".feature-label").data(feats).join("text")
      .attr("class", "feature-label")
      .attr("transform", (d) => `translate(${path.centroid(d)})`)
      .style("font-size", (11 / currentK) + "px").text(nameFn);
  }
  function clearLayers() { gCountries.selectAll("*").remove(); gRegions.selectAll("*").remove(); gCities.selectAll("*").remove(); }
  function escapeHtml(s) { return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // 视角切换
  document.getElementById("lensSwitch").addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if (!btn) return;
    activeLens = btn.dataset.lens;
    Array.from(e.currentTarget.children).forEach((b) => b.classList.toggle("active", b === btn));
    updateLegend();
    currentRepaint();   // 不重新缩放，只重着色 + 刷新洞察
  });

  function updateLegend() {
    const L = document.getElementById("legend");
    if (activeLens === "density") {
      L.innerHTML = `<span><span class="dot" style="background:var(--gap-fill);border:1px dashed var(--bad)"></span>无客户·待开发</span>
        <span><span class="dot" style="background:#23365e"></span>少</span>
        <span><span class="dot" style="background:#4da3ff"></span>多</span>`;
    } else if (activeLens === "cold") {
      L.innerHTML = `<span><span class="dot" style="background:${CLR.good}"></span>≤${THRESHOLDS.contact.ok}天</span>
        <span><span class="dot" style="background:${CLR.warn}"></span>≤${THRESHOLDS.contact.warn}天</span>
        <span><span class="dot" style="background:${CLR.bad}"></span>更久·要维护</span>`;
    } else {
      L.innerHTML = `<span><span class="dot" style="background:${CLR.good}"></span>无欠款</span>
        <span><span class="dot" style="background:${CLR.warn}"></span>≤${fmt(THRESHOLDS.debt.warn)}</span>
        <span><span class="dot" style="background:${CLR.bad}"></span>高欠款</span>`;
    }
  }
  updateLegend();

  // 洞察面板收起/展开
  document.getElementById("insToggle").onclick = () =>
    document.getElementById("insights").classList.toggle("collapsed");

  window.addEventListener("resize", () => {
    W = stage.clientWidth; H = stage.clientHeight;
    svg.attr("viewBox", `0 0 ${W} ${H}`);
  });
})();
