/* =====================================================================
 *  欧洲客户地图看板 —— 交互逻辑
 *  Europe → 国家 → 大区 → 城市(客户)
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

  let W = stage.clientWidth, H = stage.clientHeight;
  svg.attr("viewBox", `0 0 ${W} ${H}`);

  const projection = d3.geoMercator();
  const path = d3.geoPath(projection);

  // zoom container（所有图层都在里面，统一缩放/平移）
  const gRoot = svg.append("g");
  const gCountries = gRoot.append("g").attr("class", "layer-countries");
  const gRegions   = gRoot.append("g").attr("class", "layer-regions");
  const gCities    = gRoot.append("g").attr("class", "layer-cities");

  let currentK = 1;
  const zoom = d3.zoom()
    .scaleExtent([0.8, 200])
    .on("zoom", (e) => {
      gRoot.attr("transform", e.transform);
      currentK = e.transform.k;
      rescaleCities();
    });
  svg.call(zoom).on("dblclick.zoom", null);

  // ---- 导航栈 ----
  // 每层： { type:'europe'|'country'|'region', label, feature, iso2 }
  let nav = [{ type: "europe", label: "欧洲" }];

  let europeFeatures = [];     // 国家
  let regionFeaturesCache = {}; // iso2 -> 大区 features

  // ===================================================================
  //  客户数据索引
  // ===================================================================
  function custByCountry(iso2) {
    return CUSTOMERS.filter((c) => (c.country || "").toUpperCase() === iso2);
  }
  function custByRegion(region) {
    return CUSTOMERS.filter((c) => normalize(c.region) === normalize(region));
  }
  function custByCity(city) {
    return CUSTOMERS.filter((c) => normalize(c.city) === normalize(city));
  }
  function normalize(s) {
    return (s || "").toString().trim().toLowerCase()
      .replace(/[''`]/g, "'");
  }

  // ===================================================================
  //  颜色 / 等级
  // ===================================================================
  function repurchaseClass(days) {
    if (days <= THRESHOLDS.repurchase.ok) return "good";
    if (days <= THRESHOLDS.repurchase.warn) return "warn";
    return "bad";
  }
  function debtClass(amount) {
    if (amount <= THRESHOLDS.debt.ok) return "good";
    if (amount <= THRESHOLDS.debt.warn) return "warn";
    return "bad";
  }
  function money(amount, cur) {
    return (cur || "€") + Number(amount || 0).toLocaleString("de-DE");
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
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function isoOf(f) {
    const p = f.properties || {};
    return (p.ISO2 || p.iso_a2 || p.ISO_A2 || "").toUpperCase();
  }
  function nameOf(f) {
    const p = f.properties || {};
    return p.NAME || p.name || p.NAME_ENGL || p.admin || "";
  }

  // ===================================================================
  //  LEVEL 0 —— 欧洲（所有国家）
  // ===================================================================
  function renderEurope() {
    nav = [{ type: "europe", label: "欧洲" }];
    clearLayers();
    fitTo(null, 0); // reset zoom to full extent

    const sel = gCountries.selectAll("path")
      .data(europeFeatures, (d) => isoOf(d) || nameOf(d))
      .join("path")
      .attr("class", (d) => "feature" + (custByCountry(isoOf(d)).length ? " has-data" : ""))
      .attr("d", path)
      .on("mousemove", (e, d) => showCountryTooltip(e, d))
      .on("mouseleave", hideTooltip)
      .on("click", (e, d) => enterCountry(d));

    drawLabels(gCountries, europeFeatures.filter((d) => custByCountry(isoOf(d)).length), nameOf);
    syncChrome();
  }

  function showCountryTooltip(e, d) {
    const list = custByCountry(isoOf(d));
    renderTooltip(e, nameOf(d), list);
  }

  // ===================================================================
  //  LEVEL 1 —— 国家（虚化欧洲 → 显示大区）
  // ===================================================================
  function enterCountry(d) {
    const iso = isoOf(d);
    nav.push({ type: "country", label: nameOf(d), feature: d, iso2: iso });
    hideTooltip();
    syncChrome();

    // 虚化非选中国家
    gCountries.selectAll("path").classed("dimmed", (n) => n !== d);
    gCountries.selectAll(".feature-label").remove();
    fitTo(d, 750);

    const cfg = MAP_CONFIG.regionSources[iso];
    if (!cfg) {
      // 没有该国大区数据 → 直接显示城市点
      gRegions.selectAll("*").remove();
      renderCitiesForCountry(iso);
      return;
    }

    const loadRegions = regionFeaturesCache[iso]
      ? Promise.resolve(regionFeaturesCache[iso])
      : fetchJSON(cfg.url).then((geo) => (regionFeaturesCache[iso] = geo.features));

    loadRegions.then((feats) => renderRegions(iso, cfg, feats)).catch((err) => {
      console.error(err);
      renderCitiesForCountry(iso); // 退化为直接打点
    });
  }

  function renderRegions(iso, cfg, feats) {
    gCities.selectAll("*").remove();
    const regName = (f) => f.properties[cfg.nameProp] || nameOf(f);

    const sel = gRegions.selectAll("path")
      .data(feats, regName)
      .join(
        (enter) => enter.append("path")
          .attr("class", (d) => "feature" + (custByRegion(regName(d)).length ? " has-data" : ""))
          .attr("d", path)
          .style("opacity", 0)
          .call((en) => en.transition().duration(500).style("opacity", 1))
      )
      .attr("d", path)
      .on("mousemove", (e, d) => renderTooltip(e, regName(d), custByRegion(regName(d))))
      .on("mouseleave", hideTooltip)
      .on("click", (e, d) => enterRegion(d, regName(d)));

    drawLabels(gRegions, feats.filter((d) => custByRegion(regName(d)).length), regName);
    rescaleCities();
  }

  // ===================================================================
  //  LEVEL 2 —— 大区（显示城市 / 客户点）
  // ===================================================================
  function enterRegion(feature, regionName) {
    nav.push({ type: "region", label: regionName, feature });
    hideTooltip();
    syncChrome();

    gRegions.selectAll("path").classed("dimmed", (n) => n !== feature);
    gRegions.selectAll(".feature-label").remove();
    fitTo(feature, 750);

    renderCities(custByRegion(regionName), feature);
  }

  function renderCitiesForCountry(iso) {
    renderCities(custByCountry(iso), nav[nav.length - 1].feature);
  }

  // 把客户按城市聚合，打点
  function renderCities(custList, parentFeature) {
    gCities.selectAll("*").remove();
    if (!custList.length) return;

    const byCity = d3.group(custList, (c) => c.city || "未知城市");
    const fallback = parentFeature ? path.centroid(parentFeature) : [W / 2, H / 2];

    const cities = Array.from(byCity, ([city, list]) => {
      let xy;
      const withCoord = list.find((c) => c.lat != null && c.lng != null);
      if (withCoord) xy = projection([+withCoord.lng, +withCoord.lat]);
      else xy = fallback;
      return { city, list, x: xy[0], y: xy[1] };
    });

    const g = gCities.selectAll(".city")
      .data(cities, (d) => d.city)
      .join("g")
      .attr("class", "city")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .on("mousemove", (e, d) => renderTooltip(e, d.city, d.list))
      .on("mouseleave", hideTooltip)
      .on("click", (e, d) => openPanel(d.city, d.list));

    g.append("circle").attr("class", "ring");
    g.append("circle").attr("class", "core");
    g.append("text").attr("class", "city-label").text((d) => d.city);

    rescaleCities();
  }

  // 让城市点在任意缩放下保持恒定屏幕大小
  function rescaleCities() {
    const r = 6 / currentK;
    const fz = 11 / currentK;
    const off = 10 / currentK;
    gCities.selectAll(".city .ring")
      .attr("r", r + 4 / currentK)
      .attr("stroke", (d) => markerColor(d.list))
      .attr("stroke-width", 2 / currentK);
    gCities.selectAll(".city .core")
      .attr("r", r)
      .attr("fill", (d) => markerColor(d.list))
      .attr("stroke-width", 1 / currentK);
    gCities.selectAll(".city-label")
      .attr("x", off + 4 / currentK)
      .attr("y", fz / 3)
      .style("font-size", fz + "px");
  }

  // 城市点颜色：取该城市里“最差”的客户状态
  function markerColor(list) {
    const worstDebt = d3.max(list, (c) => +c.debt || 0);
    const worstDays = d3.max(list, (c) => +c.daysSinceRepurchase || 0);
    const cls = worstClass(repurchaseClass(worstDays), debtClass(worstDebt));
    return cls === "bad" ? "#ff5c6c" : cls === "warn" ? "#f5b942" : "#36c98e";
  }
  function worstClass(a, b) {
    const rank = { good: 0, warn: 1, bad: 2 };
    return rank[a] >= rank[b] ? a : b;
  }

  // ===================================================================
  //  Tooltip（悬停弹出客户抬头 + 天数 + 欠款）
  // ===================================================================
  function renderTooltip(event, title, list) {
    if (!list || !list.length) {
      hideTooltip();
      return;
    }
    const shown = list.slice(0, 8);
    const rows = shown.map((c) => {
      const rcls = repurchaseClass(+c.daysSinceRepurchase);
      const dcls = debtClass(+c.debt);
      return `<div class="tt-row">
        <span class="tt-name">${escapeHtml(c.company)}</span>
        <span class="tt-meta">
          <span class="pill repurchase ${rcls === "good" ? "ok" : ""}">${c.daysSinceRepurchase}天未回购</span>
          <span class="pill debt ${(+c.debt) ? "" : "zero"}">欠 ${money(c.debt, c.currency)}</span>
        </span>
      </div>`;
    }).join("");
    const more = list.length > shown.length
      ? `<div class="tt-row" style="justify-content:center;color:var(--muted)">…共 ${list.length} 个客户，点击查看全部</div>`
      : "";

    tooltip.html(
      `<div class="tt-head">${escapeHtml(title)} · <span class="count">${list.length} 个客户</span></div>${rows}${more}`
    );
    tooltip.node().hidden = false;
    positionTooltip(event);
  }

  function positionTooltip(event) {
    const rect = stage.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    tooltip.style("left", x + "px").style("top", y + "px");
  }
  function hideTooltip() { tooltip.node().hidden = true; }

  // ===================================================================
  //  城市客户明细面板
  // ===================================================================
  function openPanel(city, list) {
    panelTitle.textContent = city + " · " + list.length + " 个客户";
    const sorted = list.slice().sort((a, b) =>
      worstScore(b) - worstScore(a));
    panelBody.innerHTML = sorted.map((c) => {
      const rcls = repurchaseClass(+c.daysSinceRepurchase);
      const dcls = debtClass(+c.debt);
      const alert = (rcls === "bad" || dcls === "bad") ? " alert" : "";
      return `<div class="cust-card${alert}">
        <div class="name">${escapeHtml(c.company)}</div>
        <div class="metrics">
          <div class="metric">
            <div class="label">未回购天数</div>
            <div class="value ${rcls}">${c.daysSinceRepurchase}<small style="font-size:12px"> 天</small></div>
          </div>
          <div class="metric">
            <div class="label">欠款</div>
            <div class="value ${dcls}">${money(c.debt, c.currency)}</div>
          </div>
        </div>
        ${c.note ? `<div class="sub">📌 ${escapeHtml(c.note)}</div>` : ""}
      </div>`;
    }).join("");
    panel.hidden = false;
  }
  function worstScore(c) {
    return (+c.debt || 0) + (+c.daysSinceRepurchase || 0) * 50;
  }
  document.getElementById("panelClose").onclick = () => (panel.hidden = true);

  // ===================================================================
  //  缩放到要素 bounds（平滑过渡）
  // ===================================================================
  function fitTo(feature, duration) {
    let t;
    if (!feature) {
      t = d3.zoomIdentity;
    } else {
      const [[x0, y0], [x1, y1]] = path.bounds(feature);
      const dx = x1 - x0, dy = y1 - y0;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const k = Math.min(50, 0.85 / Math.max(dx / W, dy / H));
      t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy);
    }
    svg.transition().duration(duration).call(zoom.transform, t);
  }

  // ===================================================================
  //  返回 / 面包屑
  // ===================================================================
  function goBack() {
    if (nav.length <= 1) return;
    nav.pop();
    panel.hidden = true;
    const top = nav[nav.length - 1];
    if (top.type === "europe") {
      gRegions.selectAll("*").remove();
      gCities.selectAll("*").remove();
      gCountries.selectAll("path").classed("dimmed", false);
      renderEurope();
    } else if (top.type === "country") {
      gCities.selectAll("*").remove();
      gRegions.selectAll("path").classed("dimmed", false);
      // 重新进入国家层（恢复大区视图）
      const f = top.feature, iso = top.iso2;
      gCountries.selectAll("path").classed("dimmed", (n) => n !== f);
      fitTo(f, 600);
      const cfg = MAP_CONFIG.regionSources[iso];
      if (cfg && regionFeaturesCache[iso]) {
        drawLabels(gRegions, regionFeaturesCache[iso]
          .filter((d) => custByRegion(d.properties[cfg.nameProp]).length),
          (f2) => f2.properties[cfg.nameProp]);
      }
    }
    syncChrome();
  }
  backBtn.onclick = goBack;

  function jumpTo(index) {
    while (nav.length - 1 > index) nav.pop();
    const top = nav[index];
    panel.hidden = true;
    if (top.type === "europe") {
      gRegions.selectAll("*").remove();
      gCities.selectAll("*").remove();
      gCountries.selectAll("path").classed("dimmed", false);
      renderEurope();
    } else if (top.type === "country") {
      gCities.selectAll("*").remove();
      gRegions.selectAll("path").classed("dimmed", false);
      gCountries.selectAll("path").classed("dimmed", (n) => n !== top.feature);
      fitTo(top.feature, 600);
    }
    syncChrome();
  }

  function syncChrome() {
    backBtn.hidden = nav.length <= 1;
    breadcrumbEl.innerHTML = "";
    nav.forEach((n, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "sep"; sep.textContent = "›";
        breadcrumbEl.appendChild(sep);
      }
      const c = document.createElement("span");
      c.className = "crumb" + (i === nav.length - 1 ? " active" : "");
      c.textContent = n.label;
      c.onclick = () => jumpTo(i);
      breadcrumbEl.appendChild(c);
    });
  }

  // ===================================================================
  //  工具
  // ===================================================================
  function drawLabels(layer, feats, nameFn) {
    layer.selectAll(".feature-label").remove();
    layer.selectAll(".feature-label")
      .data(feats)
      .join("text")
      .attr("class", "feature-label")
      .attr("transform", (d) => `translate(${path.centroid(d)})`)
      .style("font-size", (11 / currentK) + "px")
      .text(nameFn);
  }

  function clearLayers() {
    gCountries.selectAll("*").remove();
    gRegions.selectAll("*").remove();
    gCities.selectAll("*").remove();
  }

  function escapeHtml(s) {
    return (s || "").toString()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 图例
  document.getElementById("legend").innerHTML =
    `<span><span class="dot" style="background:#36c98e"></span>正常</span>
     <span><span class="dot" style="background:#f5b942"></span>关注</span>
     <span><span class="dot" style="background:#ff5c6c"></span>预警</span>`;

  // 响应窗口缩放
  window.addEventListener("resize", () => {
    W = stage.clientWidth; H = stage.clientHeight;
    svg.attr("viewBox", `0 0 ${W} ${H}`);
  });
})();
