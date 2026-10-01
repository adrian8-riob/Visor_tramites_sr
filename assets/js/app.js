(() => {
  'use strict';
  const C = window.APP_CONFIG;
  const F = C.fields;
  const $ = id => document.getElementById(id);
  const norm = v => (v ?? '').toString().trim();
  const upper = v => norm(v).toLocaleUpperCase('es');
  const safe = v => norm(v).replace(/[&<>\"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[s]));
  const fmtN = v => Number(v || 0).toLocaleString('es-EC');

  const state = {
    map: null,
    canvasRenderer: null,
    layerDefs: new Map(),
    mapLayers: new Map(),
    data: new Map(),
    filteredFeatures: [],
    heat: null,
    selectionLayer: null,
    charts: {}
  };

  const valueLabelsPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (opts?.display === false || chart.config.type === 'doughnut') return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 10px Segoe UI, Arial, sans-serif';
      ctx.fillStyle = '#514657';
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        if (!chart.isDatasetVisible(datasetIndex)) return;
        const meta = chart.getDatasetMeta(datasetIndex);
        meta.data.forEach((el, i) => {
          const raw = dataset.data[i];
          if (raw === null || raw === undefined || Number.isNaN(Number(raw))) return;
          const text = opts?.suffix ? `${raw}${opts.suffix}` : String(raw);
          if (chart.options.indexAxis === 'y') {
            ctx.textAlign = 'left';
            const x = Math.min(el.x + 5, chart.chartArea.right - 28);
            ctx.fillText(text, x, el.y);
          } else {
            ctx.textAlign = 'center';
            ctx.fillText(text, el.x, Math.max(chart.chartArea.top + 8, el.y - 8));
          }
        });
      });
      ctx.restore();
    }
  };

  function initMap() {
    state.canvasRenderer = L.canvas({ padding: 0.5 });
    state.map = L.map('map', { zoomControl: true, preferCanvas: true }).setView(C.initialView, C.initialZoom);
    L.tileLayer(C.basemap.url, { attribution: C.basemap.attribution, maxZoom: 20 }).addTo(state.map);
  }

  async function loadAll() {
    showMessage('Cargando información territorial…');
    clearOperationalLayers();
    state.data.clear(); state.layerDefs.clear();
    for (const def of C.layers) {
      state.layerDefs.set(def.id, def);
      try { await loadLayer(def); }
      catch (e) { console.error(def.name, e); showMessage(`No se pudo cargar: ${def.name}`); }
    }
    try { enrichProcedureTerritories(); } catch (e) { console.warn('No se pudo completar la asignación territorial:', e); }
    rebuildLayerList();
    rebuildFilters();
    applyFilters(false);
    homeView();
  }

  function clearOperationalLayers() {
    for (const layer of state.mapLayers.values()) if (layer && state.map.hasLayer(layer)) state.map.removeLayer(layer);
    state.mapLayers.clear();
    if (state.heat && state.map.hasLayer(state.heat)) state.map.removeLayer(state.heat);
    if (state.selectionLayer && state.map.hasLayer(state.selectionLayer)) state.map.removeLayer(state.selectionLayer);
    state.heat = null; state.selectionLayer = null;
  }

  async function loadLayer(def) {
    const res = await fetch(def.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const gj = await res.json();
    state.data.set(def.id, gj);
    const layer = createGeoJsonLayer(def, gj);
    state.mapLayers.set(def.id, layer);
    if (def.visible) layer.addTo(state.map);
  }

  function createGeoJsonLayer(def, gj) {
    const isProcedures = def.role === 'procedures';
    return L.geoJSON(gj, {
      renderer: isProcedures ? state.canvasRenderer : undefined,
      style: feature => ({ ...(def.style || {}), ...(typeof def.styleFunction === 'function' ? def.styleFunction(feature) : {}) }),
      pointToLayer: isProcedures ? (feature, latlng) => L.circleMarker(latlng, procedurePointStyle(feature)) : undefined,
      onEachFeature: (feature, layer) => layer.bindPopup(makePopup(def, feature), { maxWidth: 340 })
    });
  }

  function typeColor(value) {
    const t = upper(value) || 'SIN DATO';
    if (C.typeColors[t]) return C.typeColors[t];
    const palette = C.fallbackTypeColors || [C.typeColors.OTRO || '#6C757D'];
    let hash = 0;
    for (let i = 0; i < t.length; i++) hash = ((hash << 5) - hash + t.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length];
  }

  function procedurePointStyle(feature) {
    const t = feature?.properties?.[F.type];
    return { radius: 4.5, color: '#ffffff', weight: 0.8, fillColor: typeColor(t), fillOpacity: 0.88 };
  }

  function makePopup(def, feature) {
    const p = feature.properties || {};
    if (def.role === 'procedures') {
      const days = displayAttentionDays(p);
      return `<div class="popup-title">${safe(p[F.type] || 'Trámite')}</div>
        <span class="popup-status">${safe(p[F.status] || 'SIN DATO')}</span><br>
        <b>N.º trámite:</b> ${safe(getTransactionNumber(p) || 'SIN DATO')}<br>
        <b>Ingreso:</b> ${safe(formatDate(p[F.entryDate]) || 'SIN DATO')}<br>
        <b>Despacho:</b> ${safe(formatDate(p[F.dispatchDate]) || 'SIN DESPACHO')}<br>
        <b>Tiempo:</b> ${safe(days)}<br>
        <b>Plataforma:</b> ${safe(p[F.platform] || 'SIN PLATAFORMA')}<br>
        <b>Parroquia:</b> ${safe(p[F.parish] || 'SIN DATO')}<br>
        <b>Clave catastral:</b> ${safe(p[F.cadastralKey] || 'SIN DATO')}<br>
        <b>Jefatura:</b> ${safe(p[F.office] || 'SIN DATO')}<br>
        <b>Técnico:</b> ${safe(p[F.technician] || 'SIN DATO')}`;
    }
    const pName = p.nombre || p.NOMBRE || p.name || def.name;
    const rows = Object.entries(p).filter(([k]) => k !== 'geometry').slice(0, 8)
      .map(([k, v]) => `<b>${safe(k)}:</b> ${safe(v)}`).join('<br>');
    return `<div class="popup-title">${safe(pName)}</div>${rows}`;
  }

  function getDefByRole(role) { return [...state.layerDefs.values()].find(d => d.role === role); }
  function getDataByRole(role) { const d = getDefByRole(role); return d ? state.data.get(d.id) : null; }

  function rebuildLayerList() {
    const box = $('layerList'); box.innerHTML = '';
    for (const [id, def] of state.layerDefs) {
      const row = document.createElement('label'); row.className = 'layer-item';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.map.hasLayer(state.mapLayers.get(id));
      cb.addEventListener('change', () => toggleLayer(id, cb.checked));
      const sw = document.createElement('span'); sw.className = 'swatch';
      sw.style.background = def.role === 'procedures' ? '#7B2CBF' : (def.style?.fillColor || def.style?.color || '#888');
      row.append(cb, sw, document.createTextNode(def.name)); box.appendChild(row);
    }
    renderLegend();
  }

  function toggleLayer(id, on) {
    const layer = state.mapLayers.get(id); if (!layer) return;
    if (on) layer.addTo(state.map); else state.map.removeLayer(layer);
    renderLegend();
  }

  function geometryBounds(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = coords => {
      if (!Array.isArray(coords)) return;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        minX = Math.min(minX, coords[0]); maxX = Math.max(maxX, coords[0]);
        minY = Math.min(minY, coords[1]); maxY = Math.max(maxY, coords[1]);
        return;
      }
      coords.forEach(walk);
    };
    walk(geometry.coordinates);
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
  }

  function pointInRing(point, ring) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      const intersects = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonCoords(point, polygon) {
    if (!polygon?.length || !pointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) if (pointInRing(point, polygon[i])) return false;
    return true;
  }

  function pointInFeature(point, item) {
    const b = item._bounds;
    if (b && (point[0] < b[0] || point[0] > b[2] || point[1] < b[1] || point[1] > b[3])) return false;
    const g = item.feature.geometry;
    if (!g) return false;
    if (g.type === 'Polygon') return pointInPolygonCoords(point, g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some(poly => pointInPolygonCoords(point, poly));
    return false;
  }

  function enrichProcedureTerritories() {
    const procedures = getDataByRole('procedures')?.features || [];
    const parishFeatures = getDataByRole('parishes')?.features || [];
    const platformFeatures = getDataByRole('platforms')?.features || [];
    const parishByCode = new Map(parishFeatures.map(f => [norm(f.properties?.codigo_dpa), norm(f.properties?.nombre)]).filter(x => x[0]));
    const parishItems = parishFeatures.map(feature => ({ feature, _bounds: geometryBounds(feature.geometry) }));
    const platformItems = platformFeatures.map(feature => ({ feature, _bounds: geometryBounds(feature.geometry) }));

    for (const ft of procedures) {
      const p = ft.properties || (ft.properties = {});
      const point = ft.geometry?.type === 'Point' ? ft.geometry.coordinates : null;
      const key = norm(p[F.cadastralKey]);
      let parish = norm(p[F.parish]);
      if (!parish && key.length >= 6) parish = parishByCode.get(key.slice(0, 6)) || '';
      if (!parish && point) {
        const hit = parishItems.find(item => pointInFeature(point, item));
        parish = norm(hit?.feature?.properties?.nombre);
      }
      p[F.parish] = parish || 'SIN DATO';

      let platform = norm(p[F.platform]);
      if (!platform && point) {
        const hit = platformItems.find(item => pointInFeature(point, item));
        platform = norm(hit?.feature?.properties?.nombre);
      }
      p[F.platform] = platform || 'SIN PLATAFORMA';
    }
  }

  function unique(arr) { return [...new Set(arr.map(norm).filter(Boolean))]; }

  function rebuildFilters() {
    const feats = getDataByRole('procedures')?.features || [];
    fillSelect($('filterTipo'), unique(feats.map(f => norm(f.properties?.[F.type]) || 'SIN DATO')), 'Todos');
    fillSelect($('filterEstado'), unique(feats.map(f => norm(f.properties?.[F.status]) || 'SIN DATO')), 'Todos');
    rebuildTerritorySelect();
  }

  function rebuildTerritorySelect() {
    const feats = getDataByRole('procedures')?.features || [];
    const mode = $('territoryMode').value;
    const field = mode === 'parroquia' ? F.parish : F.platform;
    fillSelect($('filterTerritorio'), unique(feats.map(f => f.properties?.[field])), 'Todos');
    $('territoryChartTitle').textContent = `Trámites por ${mode}`;
  }

  function fillSelect(sel, values, first) {
    const current = sel.value;
    sel.innerHTML = `<option value="">${first}</option>`;
    values.sort((a, b) => a.localeCompare(b, 'es')).forEach(v => {
      const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
    });
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
  }

  function applyFilters(zoomTerritory = false) {
    const feats = getDataByRole('procedures')?.features || [];
    const tipo = $('filterTipo').value;
    const estado = $('filterEstado').value;
    const mode = $('territoryMode').value;
    const territorio = $('filterTerritorio').value;
    const territoryField = mode === 'parroquia' ? F.parish : F.platform;

    state.filteredFeatures = feats.filter(ft => {
      const p = ft.properties || {};
      const currentType = norm(p[F.type]) || 'SIN DATO';
      const currentStatus = norm(p[F.status]) || 'SIN DATO';
      if (tipo && currentType !== tipo) return false;
      if (estado && currentStatus !== estado) return false;
      if (territorio && norm(p[territoryField]) !== territorio) return false;
      return true;
    });

    redrawProcedures();
    updateHeat();
    updateKPIs();
    updateCharts();
    updateTable();
    updateFilterStatus();
    renderLegend();
    updateTerritoryInfo();
    if (zoomTerritory && territorio) zoomToSelectedTerritory();
  }

  function normalizedPositiveNumber(v) {
    const raw = norm(v);
    if (!raw) return '';
    const n = Number(raw);
    if (Number.isFinite(n)) return n > 0 ? String(Math.trunc(n)) : '';
    return raw;
  }

  function getTransactionNumber(p) {
    return normalizedPositiveNumber(p?.[F.transactionNumber]) || normalizedPositiveNumber(p?.[F.transactionNumberAlt]);
  }

  function transactionKey(feature) {
    const p = feature.properties || {};
    return getTransactionNumber(p) || `REG-${norm(p[F.id]) || norm(p.ORIG_FID) || 'SIN-ID'}`;
  }

  function uniqueProcedures(features) {
    const seen = new Set(), out = [];
    for (const f of features) {
      const key = transactionKey(f);
      if (seen.has(key)) continue;
      seen.add(key); out.push(f);
    }
    return out;
  }

  function redrawProcedures() {
    const def = getDefByRole('procedures'); if (!def) return;
    const old = state.mapLayers.get(def.id);
    const visible = old && state.map.hasLayer(old);
    if (old) state.map.removeLayer(old);
    const fc = { type: 'FeatureCollection', features: state.filteredFeatures };
    const layer = createGeoJsonLayer(def, fc);
    state.mapLayers.set(def.id, layer);
    if (visible) layer.addTo(state.map);
  }

  function updateHeat() {
    if (state.heat && state.map.hasLayer(state.heat)) state.map.removeLayer(state.heat);
    state.heat = null;
    if (!$('toggleHeat').checked || typeof L.heatLayer !== 'function') return;
    const pts = state.filteredFeatures.flatMap(f => f.geometry?.type === 'Point' ? [[f.geometry.coordinates[1], f.geometry.coordinates[0], 0.75]] : []);
    state.heat = L.heatLayer(pts, { radius: 25, blur: 20, maxZoom: 17, minOpacity: 0.25 }).addTo(state.map);
  }

  function updateKPIs() {
    const uniqueF = uniqueProcedures(state.filteredFeatures);
    $('kpiTotal').textContent = fmtN(uniqueF.length);
    $('kpiLocations').textContent = fmtN(state.filteredFeatures.length);
    $('kpiProcess').textContent = fmtN(uniqueF.filter(f => upper(f.properties?.[F.status]) === 'EN PROCESO').length);
    $('kpiFinished').textContent = fmtN(uniqueF.filter(f => upper(f.properties?.[F.status]) === 'FINALIZADO').length);
    const durations = uniqueF.map(f => completedAttentionDays(f.properties || {})).filter(v => v !== null);
    $('kpiMedian').textContent = durations.length ? `${median(durations)} días` : '—';
    const topT = topCount(uniqueF.map(f => norm(f.properties?.[F.type]) || 'SIN DATO'));
    $('kpiTopTipo').textContent = topT.key || '—';
    $('kpiTopTipoN').textContent = `${fmtN(topT.count)} trámites`;
  }

  function updateCharts() {
    const uniqueF = uniqueProcedures(state.filteredFeatures);

    const typeCounts = countBy(uniqueF.map(f => norm(f.properties?.[F.type]) || 'SIN DATO'));
    const typeEntries = Object.entries(typeCounts).sort((a,b) => b[1] - a[1]);
    makeHorizontalBar('chartTipo', typeEntries.map(x => x[0]), typeEntries.map(x => x[1]), typeEntries.map(x => typeColor(x[0])), 'Trámites');

    const statusCounts = countBy(uniqueF.map(f => norm(f.properties?.[F.status]) || 'SIN DATO'));
    const statusEntries = Object.entries(statusCounts).sort((a,b) => b[1] - a[1]);
    makeDoughnut('chartEstado', statusEntries.map(x => `${x[0]} · ${fmtN(x[1])}`), statusEntries.map(x => x[1]), statusEntries.map(x => C.statusColors[upper(x[0])] || '#9CA3AF'));

    const mode = $('territoryMode').value;
    const tf = mode === 'parroquia' ? F.parish : F.platform;
    const terrCounts = countUniqueByField(state.filteredFeatures, tf);
    const terrEntries = Object.entries(terrCounts).sort((a,b) => b[1] - a[1]);
    makeVerticalBar('chartTerritorio', terrEntries.map(x => x[0]), terrEntries.map(x => x[1]), '#8A4D9E', 'Trámites');

    const flow = monthlyFlow(uniqueF);
    makeGroupedBars('chartFlujo', flow.labels, flow.entries, flow.dispatches);

    const durationsByType = {};
    uniqueF.forEach(f => {
      const p = f.properties || {}, d = completedAttentionDays(p), t = norm(p[F.type]) || 'SIN DATO';
      if (d !== null) (durationsByType[t] ||= []).push(d);
    });
    const durationEntries = Object.entries(durationsByType).map(([k, vals]) => [k, median(vals)]).sort((a,b) => b[1] - a[1]);
    makeHorizontalBar('chartDuracion', durationEntries.map(x => x[0]), durationEntries.map(x => x[1]), durationEntries.map(x => typeColor(x[0])), 'Días', ' d');
  }

  function makeHorizontalBar(id, labels, data, colors, label, suffix = '') {
    destroyChart(id);
    state.charts[id] = new Chart($(id), {
      type: 'bar',
      data: { labels, datasets: [{ label, data, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 28 } },
        plugins: { legend: { display: false }, valueLabels: { display: true, suffix }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw}${suffix}` } } },
        scales: { x: { beginAtZero: true, grace: '12%', ticks: { precision: 0 } }, y: { ticks: { autoSkip: false, font: { size: 9 } } } }
      },
      plugins: [valueLabelsPlugin]
    });
  }

  function makeVerticalBar(id, labels, data, color, label) {
    destroyChart(id);
    state.charts[id] = new Chart($(id), {
      type: 'bar',
      data: { labels, datasets: [{ label, data, backgroundColor: color, borderRadius: 3 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 15 } },
        plugins: { legend: { display: false }, valueLabels: { display: true } },
        scales: { y: { beginAtZero: true, grace: '14%', ticks: { precision: 0 } }, x: { ticks: { autoSkip: false, maxRotation: 50, minRotation: 0, font: { size: 9 } } } }
      },
      plugins: [valueLabelsPlugin]
    });
  }

  function makeDoughnut(id, labels, data, colors) {
    destroyChart(id);
    state.charts[id] = new Chart($(id), {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, valueLabels: { display: false } } }
    });
  }

  function makeGroupedBars(id, labels, entries, dispatches) {
    destroyChart(id);
    state.charts[id] = new Chart($(id), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Ingresos', data: entries, backgroundColor: '#6B4F9B', borderRadius: 3 },
        { label: 'Despachos', data: dispatches, backgroundColor: '#35A9B7', borderRadius: 3 }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, valueLabels: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { maxRotation: 45, minRotation: 0, font: { size: 9 } } } }
      }
    });
  }

  function destroyChart(id) { if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; } }

  function monthlyFlow(features) {
    const entry = {}, disp = {}, keys = new Set();
    features.forEach(f => {
      const p = f.properties || {};
      const di = parseDate(p[F.entryDate]);
      if (di) { const k = monthKey(di); entry[k] = (entry[k] || 0) + 1; keys.add(k); }
      const dd = parseDate(p[F.dispatchDate]);
      if (dd && (!di || dd >= di)) { const k = monthKey(dd); disp[k] = (disp[k] || 0) + 1; keys.add(k); }
    });
    const labels = [...keys].sort();
    return { labels, entries: labels.map(k => entry[k] || 0), dispatches: labels.map(k => disp[k] || 0) };
  }

  function updateTable() {
    const uniqueF = uniqueProcedures(state.filteredFeatures);
    const rows = [...uniqueF].sort((a,b) => (parseDate(b.properties?.[F.entryDate]) || 0) - (parseDate(a.properties?.[F.entryDate]) || 0)).slice(0, 150);
    $('tableCount').textContent = `${fmtN(uniqueF.length)} trámites`;
    $('tableBody').innerHTML = rows.map(f => {
      const p = f.properties || {};
      const dur = p[F.duration] === null || p[F.duration] === undefined ? '—' : p[F.duration];
      return `<tr><td>${safe(getTransactionNumber(p) || 'SIN DATO')}</td><td>${safe(p[F.type] || 'SIN DATO')}</td><td>${safe(p[F.status] || 'SIN DATO')}</td><td>${safe(formatDate(p[F.entryDate]) || '—')}</td><td>${safe(formatDate(p[F.dispatchDate]) || '—')}</td><td>${safe(dur)}</td><td>${safe(p[F.platform] || 'SIN PLATAFORMA')}</td><td>${safe(p[F.parish] || 'SIN DATO')}</td><td>${safe(p[F.technician] || '—')}</td></tr>`;
    }).join('');
  }

  function updateFilterStatus() {
    const active = [$('filterTipo').value, $('filterEstado').value, $('filterTerritorio').value].filter(Boolean).length;
    $('filterStatus').textContent = active ? `${active} filtro${active > 1 ? 's' : ''}` : 'Sin filtros';
  }

  function renderLegend() {
    const box = $('legend'); box.innerHTML = '';
    const procDef = getDefByRole('procedures');
    const procLayer = procDef ? state.mapLayers.get(procDef.id) : null;
    const uniqueF = uniqueProcedures(state.filteredFeatures);
    const typeCounts = countBy(uniqueF.map(f => norm(f.properties?.[F.type]) || 'SIN DATO'));
    $('legendCount').textContent = `${fmtN(uniqueF.length)} trámites`;

    if (procDef && procLayer && state.map.hasLayer(procLayer)) {
      Object.entries(typeCounts).sort((a,b) => b[1] - a[1]).forEach(([k, n]) => {
        const color = typeColor(k);
        box.insertAdjacentHTML('beforeend', `<div class="legend-row"><span class="legend-circle" style="background:${color}"></span><span>${safe(k)}</span><span class="legend-value">${fmtN(n)}</span></div>`);
      });
    }
    for (const [id, def] of state.layerDefs) {
      const layer = state.mapLayers.get(id);
      if (def.role === 'procedures' || !layer || !state.map.hasLayer(layer)) continue;
      const color = def.style?.color || '#777';
      box.insertAdjacentHTML('beforeend', `<div class="legend-row"><span class="legend-line" style="color:${color}"></span><span>${safe(def.name)}</span></div>`);
    }
  }

  function countUniqueByField(features, field) {
    const groups = {};
    features.forEach(f => {
      const name = norm(f.properties?.[field]) || 'SIN DATO';
      (groups[name] ||= new Set()).add(transactionKey(f));
    });
    return Object.fromEntries(Object.entries(groups).map(([k, set]) => [k, set.size]));
  }

  function zoomToSelectedTerritory() {
    clearSelectionLayer();
    const territory = $('filterTerritorio').value;
    if (!territory) return;
    const mode = $('territoryMode').value;
    const role = mode === 'parroquia' ? 'parishes' : 'platforms';
    const gj = getDataByRole(role);
    const feature = gj?.features?.find(f => norm(f.properties?.nombre) === territory);
    if (feature) {
      state.selectionLayer = L.geoJSON(feature, { style: { color: '#EF9F1A', weight: 5, fillColor: '#F8D77C', fillOpacity: 0.14, dashArray: '5 3' } }).addTo(state.map);
      const b = state.selectionLayer.getBounds(); if (b.isValid()) state.map.fitBounds(b.pad(0.12), { maxZoom: 16 });
      state.selectionLayer.bringToFront();
    } else {
      const pts = state.filteredFeatures.filter(f => f.geometry?.type === 'Point');
      if (pts.length) {
        const l = L.geoJSON({type:'FeatureCollection',features:pts});
        const b = l.getBounds(); if (b.isValid()) state.map.fitBounds(b.pad(0.12), { maxZoom: 16 });
      }
    }
    updateTerritoryInfo();
  }

  function clearSelectionLayer() {
    if (state.selectionLayer && state.map.hasLayer(state.selectionLayer)) state.map.removeLayer(state.selectionLayer);
    state.selectionLayer = null;
  }

  function updateTerritoryInfo() {
    const el = $('territoryInfo');
    const territory = $('filterTerritorio').value;
    if (!territory) { el.classList.add('hidden'); return; }
    const uniqueF = uniqueProcedures(state.filteredFeatures);
    const proc = uniqueF.filter(f => upper(f.properties?.[F.status]) === 'EN PROCESO').length;
    const fin = uniqueF.filter(f => upper(f.properties?.[F.status]) === 'FINALIZADO').length;
    const modeLabel = $('territoryMode').value === 'parroquia' ? 'Parroquia' : 'Plataforma';
    el.innerHTML = `<b>${safe(modeLabel)}: ${safe(territory)}</b>
      <div class="ti-row"><span>Trámites únicos</span><strong>${fmtN(uniqueF.length)}</strong></div>
      <div class="ti-row"><span>Ubicaciones</span><strong>${fmtN(state.filteredFeatures.length)}</strong></div>
      <div class="ti-row"><span>En proceso</span><strong>${fmtN(proc)}</strong></div>
      <div class="ti-row"><span>Finalizados</span><strong>${fmtN(fin)}</strong></div>`;
    el.classList.remove('hidden');
  }

  function homeView() {
    clearSelectionLayer();
    const parDef = getDefByRole('parishes');
    const layer = parDef ? state.mapLayers.get(parDef.id) : null;
    if (layer && layer.getBounds && layer.getBounds().isValid()) state.map.fitBounds(layer.getBounds().pad(0.02));
    else state.map.setView(C.initialView, C.initialZoom);
  }

  function clearFilters() {
    $('filterTipo').value = '';
    $('filterEstado').value = '';
    $('filterTerritorio').value = '';
    applyFilters(false); homeView();
    $('territoryInfo').classList.add('hidden');
  }

  function showMessage(msg) {
    const e = $('mapMessage'); e.textContent = msg; e.classList.remove('hidden');
    clearTimeout(showMessage._t); showMessage._t = setTimeout(() => e.classList.add('hidden'), 2500);
  }

  function parseDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d;
    }
    const text = String(v).trim();
    let m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    m = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function formatDate(v) { const d = parseDate(v); return d ? new Intl.DateTimeFormat('es-EC').format(d) : norm(v); }
  function completedAttentionDays(p) {
    if (upper(p?.[F.status]) !== 'FINALIZADO') return null;
    const start = parseDate(p?.[F.entryDate]), end = parseDate(p?.[F.dispatchDate]);
    if (!start || !end || end < start) return null;
    return Math.round((end - start) / 86400000);
  }
  function displayAttentionDays(p) {
    const completed = completedAttentionDays(p);
    if (completed !== null) return `${completed} días`;
    const raw = Number(p?.[F.duration]);
    if (upper(p?.[F.status]) === 'EN PROCESO' && Number.isFinite(raw) && raw >= 0) return `${Math.round(raw)} días (en proceso)`;
    return '—';
  }
  function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  function countBy(arr) { return arr.reduce((o,k) => { o[k] = (o[k] || 0) + 1; return o; }, {}); }
  function topCount(arr) { const [key,count] = Object.entries(countBy(arr)).sort((a,b) => b[1]-a[1])[0] || ['',0]; return {key,count}; }
  function median(values) { if (!values.length) return null; const a=[...values].sort((x,y)=>x-y), m=Math.floor(a.length/2); const v=a.length%2?a[m]:(a[m-1]+a[m])/2; return Number.isInteger(v)?v:Number(v.toFixed(1)); }

  function wireEvents() {
    $('btnApply').onclick = () => applyFilters(true);
    $('btnClear').onclick = clearFilters;
    $('btnReload').onclick = loadAll;
    $('btnHome').onclick = homeView;
    $('toggleHeat').onchange = updateHeat;
    $('territoryMode').onchange = () => { clearSelectionLayer(); rebuildTerritorySelect(); applyFilters(false); };
    $('filterTerritorio').onchange = () => { applyFilters(false); zoomToSelectedTerritory(); };
  }

  async function boot() {
    $('appTitle').textContent = C.title;
    $('appSubtitle').textContent = C.subtitle;
    initMap(); wireEvents(); await loadAll();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
