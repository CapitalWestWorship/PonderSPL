// ==========================================================================
// Ponder SPL v2.1 - Customizable Tile Grid + Real-Time DSP Bridge
// ==========================================================================

// ---- NATIVE BRIDGE ----
function postNative(action, payload = {}) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pondera) {
    window.webkit.messageHandlers.pondera.postMessage({ action, ...payload });
  } else {
    console.log('[NativeBridge Mock]', action, payload);
  }
}

// ---- GLOBAL STATE ----
const state = {
  offset: 100.0,
  thresholds: {
    splLow:   60.0,
    splWarn:  85.0,
    splAlert: 95.0,
    caLow:    4.0,
    caWarn:   12.0,
    caAlert:  18.0
  },
  history: [],          // { las, lcs, ca, time }
  rtaBands: new Array(31).fill(30),
  schedules: [],
  tiles: [],            // active tile objects
  isCalLoaded: false,
  isCalEnabled: true,
  calFileName: '',
  calPoints: []
};

// ---- RTA LABELS ----
const RTA_LABELS = [
  '20','25','31.5','40','50','63','80','100','125','160',
  '200','250','315','400','500','630','800','1k','1.25k','1.6k',
  '2k','2.5k','3.15k','4k','5k','6.3k','8k','10k','12.5k','16k','20k'
];

// ---- COLOR HELPERS ----
function getSPLColorClass(val) {
  if (val < state.thresholds.splLow)   return 'color-gray';
  if (val < state.thresholds.splWarn)  return 'color-green';
  if (val < state.thresholds.splAlert) return 'color-yellow';
  return 'color-red';
}
function getCAColorClass(val) {
  if (val < state.thresholds.caLow)   return 'color-gray';
  if (val < state.thresholds.caWarn)  return 'color-green';
  if (val < state.thresholds.caAlert) return 'color-yellow';
  return 'color-red';
}

// ============================================================
//  TILE SYSTEM
// ============================================================

const TILE_TYPES = [
  { key: 'dBA',     label: 'A-Weighted (dBA)' },
  { key: 'dBC',     label: 'C-Weighted (dBC)' },
  { key: 'dBZ',     label: 'Z-Weighted (dBZ)' },
  { key: 'CA',      label: 'C \u2212 A  Sub-Bass Balance' },
  { key: 'Leq',     label: 'Leq (A-Weighted Leq)' },
  { key: 'History', label: 'SPL History Over Time' },
  { key: 'RTA',     label: '1/3-Oct RTA Spectrum' }
];

const DEFAULT_TILES = [
  { type: 'dBA', window: 'slow' },
  { type: 'dBC', window: 'slow' },
  { type: 'CA',  window: 'slow' },
  { type: 'RTA' }
];

// Reusing HUD tile time-setting options and logic
function getWindowsForMetric(m) {
  if (m === 'CA') {
    return [
      { id: 'slow', label: 'Slow (Lcs - Las)' },
      { id: 'fast', label: 'Fast (Lcf - Laf)' },
      { id: '10s',  label: '10 sec (Leq 10s Delta)' },
      { id: '1m',   label: 'Leq 1m Delta' },
      { id: '5m',   label: 'Leq 5m Delta' },
      { id: '15m',  label: 'Leq 15m Delta' }
    ];
  }
  if (m === 'LCpk') {
    return [{ id: 'inst', label: 'Instant Peak' }];
  }
  return [
    { id: 'slow',  label: 'Slow (1000ms)' },
    { id: 'fast',  label: 'Fast (125ms)' },
    { id: '1s',    label: 'Leq 1s' },
    { id: '5s',    label: 'Leq 5s' },
    { id: '10s',   label: 'Leq 10s' },
    { id: '30s',   label: 'Leq 30s' },
    { id: '1m',    label: 'Leq 1 min' },
    { id: '5m',    label: 'Leq 5 min' },
    { id: '10m',   label: 'Leq 10 min' },
    { id: '15m',   label: 'Leq 15 min' },
    { id: 'total', label: 'Leq Cumulative' }
  ];
}

function hasWindowSetting(type) {
  return ['dBA', 'dBC', 'dBZ', 'CA', 'Leq'].includes(type);
}

function buildWindowSelectHTML(type, currentWindow) {
  const metricKey = (type === 'CA') ? 'CA' : (type === 'dBC' ? 'LC' : (type === 'dBZ' ? 'LZ' : 'LA'));
  const wins = getWindowsForMetric(metricKey);
  const activeWin = currentWindow || (type === 'Leq' ? '1m' : 'slow');
  return wins.map(w =>
    `<option value="${w.id}"${w.id === activeWin ? ' selected' : ''}>${w.label}</option>`
  ).join('');
}

function formatWindowLabel(win) {
  if (!win || win === 'slow') return 'SLOW';
  if (win === 'fast') return 'FAST';
  if (win === 'total') return 'TOTAL';
  return win.toUpperCase();
}

function loadTileLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem('ponderTileLayout'));
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch (e) {}
  return DEFAULT_TILES.map(t => ({ ...t }));
}

function saveTileLayout() {
  const toSave = state.tiles.map(t => {
    const o = { type: t.type, window: t.window };
    if (t.type === 'Leq') o.leqWindow = t.window;
    return o;
  });
  localStorage.setItem('ponderTileLayout', JSON.stringify(toSave));
}

function makeTile(cfg) {
  return {
    type: cfg.type || 'dBA',
    window: cfg.window || cfg.leqWindow || (cfg.type === 'Leq' ? '1m' : 'slow'),
    max: -Infinity,
    min:  Infinity,
    lastVal: 0,
    id: 'tile_' + Math.random().toString(36).slice(2, 9)
  };
}

// Initialize tiles from storage or defaults
state.tiles = loadTileLayout().map(makeTile);

// ---- HTML BUILDERS ----
function buildTypeSelectHTML(currentType) {
  return TILE_TYPES.map(tt =>
    `<option value="${tt.key}"${tt.key === currentType ? ' selected' : ''}>${tt.label}</option>`
  ).join('');
}

function buildTileBodyHTML(tile) {
  const id = tile.id;
  switch (tile.type) {
    case 'dBA':
    case 'dBC':
    case 'dBZ':
    case 'Leq': {
      const unit = tile.type === 'dBA' ? 'dBA' : tile.type === 'dBC' ? 'dBC' : (tile.type === 'dBZ' ? 'dBZ' : 'dBA');
      return `
        <div class="tile-number color-gray" data-num="${id}">--.-</div>
        <div class="tile-unit-label">${unit}</div>
        <div class="tile-bar-track"><div class="tile-bar-fill" data-bar="${id}"></div></div>
        <div class="tile-stats-row">
          <div class="tile-stat">
            <span class="tile-stat-lbl">MAX</span>
            <span class="tile-stat-val" data-max="${id}">--.-</span>
          </div>
          <div class="tile-stat">
            <span class="tile-stat-lbl">MIN</span>
            <span class="tile-stat-val" data-min="${id}">--.-</span>
          </div>
          <div class="tile-stat">
            <span class="tile-stat-lbl">TIME</span>
            <span class="tile-stat-val" data-time="${id}">${formatWindowLabel(tile.window)}</span>
          </div>
        </div>`;
    }
    case 'CA': {
      return `
        <div class="tile-ca-number color-gray" data-num="${id}">--.-</div>
        <div class="tile-unit-label" style="color:var(--accent-cyan)">C \u2212 A &nbsp;dB delta</div>
        <div class="tile-ca-balance-wrap">
          <div class="tile-ca-balance-track">
            <div class="tile-ca-indicator" data-ca-ind="${id}"></div>
          </div>
          <div class="tile-ca-zone-labels">
            <span>LEAN &lt;4</span>
            <span>BALANCED 4\u201312</span>
            <span>HEAVY 12\u201318</span>
            <span>EXCESS &gt;18</span>
          </div>
        </div>
        <div class="tile-ca-desc" data-ca-desc="${id}">Awaiting audio\u2026</div>`;
    }
    case 'History': {
      return `<div class="tile-canvas-wrap">
        <canvas data-tile-canvas="${id}" data-canvas-type="history"></canvas>
      </div>`;
    }
    case 'RTA': {
      return `<div class="tile-canvas-wrap">
        <canvas data-tile-canvas="${id}" data-canvas-type="rta"></canvas>
      </div>`;
    }
    default:
      return '';
  }
}

function createTileElement(tile) {
  const card = document.createElement('div');
  card.className = 'tile-card';
  card.dataset.tileId = tile.id;
  const showWin = hasWindowSetting(tile.type);
  card.innerHTML = `
    <div class="tile-header">
      <select class="tile-type-select" data-type-sel="${tile.id}">
        ${buildTypeSelectHTML(tile.type)}
      </select>
      ${showWin ? `<select class="tile-window-select" data-win-sel="${tile.id}">${buildWindowSelectHTML(tile.type, tile.window)}</select>` : ''}
      <button class="tile-remove-btn" data-remove="${tile.id}" title="Remove tile">\u00d7</button>
    </div>
    <div class="tile-body" data-body="${tile.id}">${buildTileBodyHTML(tile)}</div>
  `;
  return card;
}

function renderTileGrid() {
  const grid = document.getElementById('tileGrid');
  const addBtn = document.getElementById('btnAddTile');
  grid.innerHTML = '';

  const count = state.tiles.length;
  grid.className = 'tile-grid cols-' + Math.min(6, Math.max(1, count));

  state.tiles.forEach(tile => {
    grid.appendChild(createTileElement(tile));
  });

  // Show/hide add button
  addBtn.style.display = count >= 6 ? 'none' : 'block';

  // Hide remove btn when only 1 tile
  updateRemoveBtns();

  // Bind type select changes
  grid.querySelectorAll('[data-type-sel]').forEach(sel => {
    sel.addEventListener('change', e => {
      const id = e.target.dataset.typeSel;
      const tile = state.tiles.find(t => t.id === id);
      if (!tile) return;
      tile.type = e.target.value;
      tile.max = -Infinity;
      tile.min = Infinity;
      if (tile.type === 'CA') {
        if (!['slow', 'fast', '10s', '1m', '5m', '15m'].includes(tile.window)) {
          tile.window = 'slow';
        }
      } else if (tile.type === 'Leq') {
        if (!tile.window || tile.window === 'slow' || tile.window === 'fast') {
          tile.window = '1m';
        }
      } else if (hasWindowSetting(tile.type)) {
        if (!tile.window) tile.window = 'slow';
      }
      saveTileLayout();
      renderTileGrid();
    });
  });

  // Bind window select changes
  grid.querySelectorAll('[data-win-sel]').forEach(sel => {
    sel.addEventListener('change', e => {
      const id = e.target.dataset.winSel;
      const tile = state.tiles.find(t => t.id === id);
      if (!tile) return;
      tile.window = e.target.value;
      tile.max = -Infinity;
      tile.min = Infinity;
      const timeEl = document.querySelector(`[data-time="${id}"]`);
      if (timeEl) timeEl.textContent = formatWindowLabel(tile.window);
      saveTileLayout();
    });
  });

  // Bind remove buttons
  grid.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.currentTarget.dataset.remove;
      state.tiles = state.tiles.filter(t => t.id !== id);
      saveTileLayout();
      renderTileGrid();
    });
  });
}

function updateRemoveBtns() {
  const btns = document.querySelectorAll('[data-remove]');
  btns.forEach(btn => {
    btn.style.visibility = state.tiles.length <= 1 ? 'hidden' : 'visible';
  });
}

// Add tile button
document.getElementById('btnAddTile').addEventListener('click', () => {
  if (state.tiles.length >= 6) return;
  state.tiles.push(makeTile({ type: 'dBA', window: 'slow' }));
  saveTileLayout();
  renderTileGrid();
});

// Initial render
renderTileGrid();

// ---- LIVE METRICS UPDATE ----
function updateTiles(m) {
  state.tiles.forEach(tile => {
    // Determine value using the same logic as HUD
    let val = null;
    const win = tile.window || (tile.type === 'Leq' ? '1m' : 'slow');

    if (tile.type === 'CA') {
      if (win === 'fast') val = m.CminusA_Fast;
      else if (win === '10s') val = m.CminusA_10s;
      else if (win === '1m') val = m.CminusA_1m;
      else if (win === '5m') val = m.CminusA_5m;
      else if (win === '15m') val = m.CminusA_15m;
      else val = m.CminusA; // slow
    } else if (tile.type === 'dBA' || tile.type === 'dBC' || tile.type === 'dBZ' || tile.type === 'Leq') {
      const prefix = (tile.type === 'dBC') ? 'LC' : ((tile.type === 'dBZ') ? 'LZ' : 'LA');
      if (win === 'slow') val = m[`${prefix}S`];
      else if (win === 'fast') val = m[`${prefix}F`];
      else {
        const prop = `${prefix}eq_${win}`;
        val = m[prop] !== undefined ? m[prop] : m[`${prefix}S`];
      }
    }
    // History / RTA: handled in render loop via canvas

    if (val === null || val === undefined) return;
    tile.lastVal = val;

    if (tile.type === 'CA') {
      // C-A tile
      const numEl  = document.querySelector(`[data-num="${tile.id}"]`);
      const indEl  = document.querySelector(`[data-ca-ind="${tile.id}"]`);
      const descEl = document.querySelector(`[data-ca-desc="${tile.id}"]`);
      const col = getCAColorClass(val);
      if (numEl) {
        numEl.textContent = (val >= 0 ? '+' : '') + val.toFixed(1);
        numEl.className = 'tile-ca-number ' + col;
      }
      if (indEl) {
        const pct = Math.max(2, Math.min(98, (val / 25.0) * 100));
        indEl.style.left = pct + '%';
      }
      if (descEl) {
        if      (val < state.thresholds.caLow)   descEl.textContent = 'Lean \u2014 Sub-bass Attenuated';
        else if (val < state.thresholds.caWarn)  descEl.textContent = 'Balanced Low-End \u2714';
        else if (val < state.thresholds.caAlert) descEl.textContent = 'Heavy Bass Dominance';
        else                                      descEl.textContent = 'Excessive Sub-Bass Rumble!';
      }
    } else if (tile.type !== 'History' && tile.type !== 'RTA') {
      // SPL / Leq number tiles
      if (val > 0) {
        if (val > tile.max) tile.max = val;
        if (val < tile.min) tile.min = val;
      }
      const numEl  = document.querySelector(`[data-num="${tile.id}"]`);
      const barEl  = document.querySelector(`[data-bar="${tile.id}"]`);
      const maxEl  = document.querySelector(`[data-max="${tile.id}"]`);
      const minEl  = document.querySelector(`[data-min="${tile.id}"]`);
      const timeEl = document.querySelector(`[data-time="${tile.id}"]`);
      const col = getSPLColorClass(val);
      if (numEl) {
        numEl.textContent = val > 0 ? val.toFixed(1) : '--.-';
        numEl.className = 'tile-number ' + col;
      }
      if (barEl) {
        const pct = Math.max(0, Math.min(100, ((val - 40.0) / 80.0) * 100.0));
        barEl.style.width = pct + '%';
      }
      if (maxEl && tile.max > -Infinity) maxEl.textContent = tile.max.toFixed(1);
      if (minEl && tile.min <  Infinity) minEl.textContent = tile.min.toFixed(1);
      if (timeEl) timeEl.textContent = formatWindowLabel(tile.window);
    }
  });
}

// ---- HISTORY BUFFER ----
let historyThrottle = 0;
function pushHistoryPoint(las, lcs, ca) {
  historyThrottle++;
  if (historyThrottle % 3 !== 0) return;
  state.history.push({ las, lcs, ca, time: Date.now() });
  if (state.history.length > 900) state.history.shift();
}

// ---- CANVAS DRAWING ----
function drawHistoryOnCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1c222d';
  ctx.fillRect(0, 0, w, h);

  const minDB = 30.0, maxDB = 115.0, dbRange = maxDB - minDB;
  ctx.strokeStyle = '#2b3342';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  ctx.fillStyle = '#64748b';

  [40, 60, 80, 85, 95, 105].forEach(db => {
    const y = h - ((db - minDB) / dbRange) * h;
    ctx.beginPath();
    ctx.moveTo(35, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(`${db}`, 5, y + 3);
  });

  if (state.history.length < 2) return;

  const pts = state.history;
  const stepX = (w - 40) / (pts.length - 1);

  function drawLine(prop, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const x = 38 + i * stepX;
      let val = pt[prop];
      if (prop === 'ca') val = 40.0 + pt.ca * 2.5;
      const y = h - ((val - minDB) / dbRange) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawLine('lcs', '#06b6d4', 1.5);
  drawLine('las', '#10b981', 2.0);
  drawLine('ca',  '#f59e0b', 1.5);
}

function drawRTAOnCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#1c222d';
  ctx.fillRect(0, 0, w, h);

  const bands = state.rtaBands;
  const numBands = 31;
  const minDB = 25.0, maxDB = 110.0, range = maxDB - minDB;
  const padLeft = 28, padBottom = 18;
  const chartW = w - padLeft - 8;
  const chartH = h - padBottom - 8;

  ctx.strokeStyle = '#283141';
  ctx.lineWidth = 1;
  ctx.font = '8px monospace';
  ctx.fillStyle = '#64748b';

  [40, 60, 80, 100].forEach(db => {
    const y = 8 + chartH - ((db - minDB) / range) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(w - 8, y);
    ctx.stroke();
    ctx.fillText(`${db}`, 2, y + 3);
  });

  const barW = (chartW / numBands) - 1.5;

  for (let i = 0; i < numBands; i++) {
    const dbVal = bands[i];
    const barH  = Math.max(2, ((dbVal - minDB) / range) * chartH);
    const x = padLeft + i * (barW + 1.5);
    const y = 8 + chartH - barH;

    let col = '#10b981';
    if (dbVal > 85) col = '#f59e0b';
    if (dbVal > 95) col = '#ef4444';
    if (dbVal < 50) col = '#64748b';

    ctx.fillStyle = col;
    ctx.fillRect(x, y, barW, barH);

    if (i % 3 === 0 || i === numBands - 1) {
      ctx.fillStyle = '#8b949e';
      ctx.fillText(RTA_LABELS[i], x - 1, h - 3);
    }
  }
}

// ---- RENDER LOOP (canvas tiles only) ----
function renderGraphicsLoop() {
  state.tiles.forEach(tile => {
    const canvas = document.querySelector(`[data-tile-canvas="${tile.id}"]`);
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }
    if (canvas.dataset.canvasType === 'history') drawHistoryOnCanvas(canvas);
    if (canvas.dataset.canvasType === 'rta')     drawRTAOnCanvas(canvas);
  });
  requestAnimationFrame(renderGraphicsLoop);
}
requestAnimationFrame(renderGraphicsLoop);

// ============================================================
//  NATIVE BRIDGE CALLBACKS
// ============================================================

window.onInitialState = function(data) {
  if (data.devices) {
    const sel = document.getElementById('deviceSelect');
    sel.innerHTML = '';
    data.devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.uid;
      opt.textContent = `${d.name} (${d.channels} ch, ${Math.round(d.sampleRate)} Hz)`;
      if (d.uid === data.currentDeviceUID) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  if (data.currentChannel !== undefined) {
    document.getElementById('channelSelect').value = String(data.currentChannel);
  }

  if (data.offset !== undefined) {
    state.offset = data.offset;
    updateOffsetDisplay(state.offset);
  }

  if (data.thresholds && typeof data.thresholds === 'object') {
    Object.assign(state.thresholds, data.thresholds);
    populateThresholdInputs();
  }

  if (data.isCalLoaded) {
    state.isCalLoaded   = true;
    state.isCalEnabled  = data.isCalEnabled;
    state.calFileName   = data.calFileName;
    state.calPoints     = data.calPoints || [];
    document.getElementById('calFileName').textContent = data.calFileName;
    document.getElementById('calFileMeta').textContent = `${state.calPoints.length} correction points (10Hz – 20kHz)`;
    document.getElementById('btnClearCalFile').style.display = 'inline-block';
    document.getElementById('calCurveContainer').style.display = 'flex';
    document.getElementById('calEnabledCheckbox').checked = state.isCalEnabled;
    drawCalibrationCurve(state.calPoints);
  } else {
    document.getElementById('calFileName').textContent = 'No calibration file loaded';
    document.getElementById('calFileMeta').textContent = 'Flat uncorrected response';
    document.getElementById('btnClearCalFile').style.display = 'none';
    document.getElementById('calCurveContainer').style.display = 'none';
  }

  if (data.defaultLogDir) {
    document.getElementById('logDirectoryInput').value = data.defaultLogDir;
  }

  if (data.schedules) {
    state.schedules = data.schedules;
    renderScheduleList();
  }
};

window.onLogFolderSelected = function(folderPath) {
  document.getElementById('logDirectoryInput').value = folderPath;
};

// Live metrics at 30 fps
window.onMetrics = function(m) {
  updateTiles(m);

  // Update cal modal live reading
  document.getElementById('calCurrentLAS').textContent =
    (m.LAS > 0 ? m.LAS.toFixed(1) : '--.-') + ' dBA';

  // RTA bands
  if (m.rta && m.rta.length === 31) state.rtaBands = m.rta;

  // Push history
  pushHistoryPoint(m.LAS, m.LCS, m.CminusA);

  // Logger status
  const btnLog   = document.getElementById('btnToggleLogging');
  const recText  = document.getElementById('recText');
  const logPulse = document.getElementById('logPulse');

  if (m.isLogging) {
    btnLog.classList.add('recording-active');
    recText.textContent = m.isPaused ? 'REC PAUSED' : 'LOGGING...';
    logPulse.className  = m.isPaused ? 'status-pulse' : 'status-pulse recording';
    document.getElementById('logStatusText').textContent   = m.isPaused ? 'LOGGER: PAUSED' : 'LOGGER: ACTIVE [REC]';
    document.getElementById('logRecordCount').textContent  = `${(m.logRecords || 0).toLocaleString()} rows`;
    document.getElementById('logFormatBadge').textContent  = (m.logFormat || 'TXT').toUpperCase();
    const sec = m.logElapsed || 0;
    const hh = String(Math.floor(sec / 3600)).padStart(2,'0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2,'0');
    const ss = String(Math.floor(sec % 60)).padStart(2,'0');
    document.getElementById('logDuration').textContent = `${hh}:${mm}:${ss}`;
  } else {
    btnLog.classList.remove('recording-active');
    recText.textContent = 'REC LOG';
    logPulse.className  = 'status-pulse';
    document.getElementById('logStatusText').textContent  = 'LOGGER: IDLE';
    document.getElementById('logRecordCount').textContent = '0 records';
    document.getElementById('logDuration').textContent    = '00:00:00';
  }
};

// ============================================================
//  UI EVENT LISTENERS
// ============================================================

// Device / Channel
document.getElementById('deviceSelect').addEventListener('change', () => {
  postNative('setDevice', {
    deviceUID: document.getElementById('deviceSelect').value,
    channel:   parseInt(document.getElementById('channelSelect').value)
  });
});
document.getElementById('channelSelect').addEventListener('change', () => {
  postNative('setChannel', { channel: parseInt(document.getElementById('channelSelect').value) });
});

// Reset stats — clears tile max/min
document.getElementById('btnResetStats').addEventListener('click', () => {
  state.tiles.forEach(t => { t.max = -Infinity; t.min = Infinity; });
  postNative('resetStats');
});

// HUD
document.getElementById('btnOpenHUD').addEventListener('click', () => postNative('openHUD'));

// Logging
document.getElementById('btnToggleLogging').addEventListener('click', () => {
  const btn = document.getElementById('btnToggleLogging');
  if (btn.classList.contains('recording-active')) {
    postNative('stopLogging');
  } else {
    postNative('startLogging', {
      intervalMs:   parseInt(document.getElementById('logIntervalSelect').value) || 3000,
      format:       document.getElementById('logFormatSelect').value,
      eventName:    'Manual',
      directory:    document.getElementById('logDirectoryInput').value,
      preventSleep: document.getElementById('chkManualPreventSleep').checked
    });
  }
});

document.getElementById('btnBrowseLogFolder').addEventListener('click', () => postNative('chooseLogFolder'));
document.getElementById('btnOpenLogFolder').addEventListener('click',   () => postNative('revealLogFile'));

// Modal open
document.getElementById('btnOpenSchedule').addEventListener('click', () => openModal('modalSchedule'));
document.getElementById('btnOpenCal').addEventListener('click',      () => openModal('modalCal'));
document.getElementById('btnOpenThresholds').addEventListener('click',() => openModal('modalThresholds'));
document.getElementById('btnConfigureLogger').addEventListener('click',() => openModal('modalLogger'));

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('show');
}

// Generic close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    const m = document.getElementById(btn.getAttribute('data-close'));
    if (m) m.classList.remove('show');
  });
});

// ---- CALIBRATION OFFSET ----
function updateOffsetDisplay(val) {
  state.offset = val;
  document.getElementById('topOffsetVal').textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + ' dB';
  document.getElementById('manualOffsetInput').value  = val.toFixed(1);
}

function nudgeOffset(delta) {
  const cur = parseFloat(document.getElementById('manualOffsetInput').value) || state.offset;
  const updated = Math.round((cur + delta) * 10) / 10;
  updateOffsetDisplay(updated);
  postNative('setOffset', { offset: updated });
}

document.getElementById('btnOffsetMinus1').addEventListener('click',  () => nudgeOffset(-1.0));
document.getElementById('btnOffsetMinus01').addEventListener('click', () => nudgeOffset(-0.1));
document.getElementById('btnOffsetPlus01').addEventListener('click',  () => nudgeOffset( 0.1));
document.getElementById('btnOffsetPlus1').addEventListener('click',   () => nudgeOffset( 1.0));
document.getElementById('manualOffsetInput').addEventListener('change', () => {
  const v = parseFloat(document.getElementById('manualOffsetInput').value);
  if (!isNaN(v)) { updateOffsetDisplay(v); postNative('setOffset', { offset: v }); }
});

document.getElementById('btnMatchReference').addEventListener('click', () => {
  const target = parseFloat(document.getElementById('calTargetInput').value);
  if (!isNaN(target) && target > 20 && target < 150) postNative('calibrateToTarget', { target });
});

document.getElementById('btnLoadCalFile').addEventListener('click',  () => postNative('chooseCalFile'));
document.getElementById('btnClearCalFile').addEventListener('click', () => postNative('clearCalFile'));
document.getElementById('calEnabledCheckbox').addEventListener('change', () => {
  postNative('setCalEnabled', { enabled: document.getElementById('calEnabledCheckbox').checked });
});

// ---- CALIBRATION CURVE PLOT ----
function drawCalibrationCurve(points) {
  const canvas = document.getElementById('calCurveCanvas');
  if (!canvas || !points || points.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, w, h);

  let minDB = -10, maxDB = 10;
  points.forEach(p => { if (p.db < minDB) minDB = p.db; if (p.db > maxDB) maxDB = p.db; });
  minDB = Math.floor(minDB - 2); maxDB = Math.ceil(maxDB + 2);
  const dbSpan = maxDB - minDB;

  const zeroY = h - ((0 - minDB) / dbSpan) * h;
  ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(w, zeroY); ctx.stroke();
  ctx.fillStyle = '#64748b'; ctx.font = '9px monospace';
  ctx.fillText('0 dB', 4, zeroY - 2);

  const logMin = Math.log10(10), logMax = Math.log10(20000);
  ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const logF = Math.log10(Math.max(10, p.freq));
    const x = ((logF - logMin) / (logMax - logMin)) * w;
    const y = h - ((p.db - minDB) / dbSpan) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ---- THRESHOLDS ----
function populateThresholdInputs() {
  document.getElementById('thSplLow').value   = state.thresholds.splLow.toFixed(1);
  document.getElementById('thSplWarn').value  = state.thresholds.splWarn.toFixed(1);
  document.getElementById('thSplAlert').value = state.thresholds.splAlert.toFixed(1);
  document.getElementById('thCaLow').value    = state.thresholds.caLow.toFixed(1);
  document.getElementById('thCaWarn').value   = state.thresholds.caWarn.toFixed(1);
  document.getElementById('thCaAlert').value  = state.thresholds.caAlert.toFixed(1);
}

document.getElementById('threshPresetSelect').addEventListener('change', () => {
  const p = document.getElementById('threshPresetSelect').value;
  if      (p === 'foh')    { state.thresholds.splLow=65; state.thresholds.splWarn=85; state.thresholds.splAlert=98; state.thresholds.caLow=4; state.thresholds.caWarn=12; state.thresholds.caAlert=18; }
  else if (p === 'osha')   { state.thresholds.splLow=60; state.thresholds.splWarn=80; state.thresholds.splAlert=85; state.thresholds.caLow=3; state.thresholds.caWarn=10; state.thresholds.caAlert=15; }
  else if (p === 'studio') { state.thresholds.splLow=55; state.thresholds.splWarn=75; state.thresholds.splAlert=85; state.thresholds.caLow=3; state.thresholds.caWarn=8;  state.thresholds.caAlert=14; }
  else if (p === 'club')   { state.thresholds.splLow=70; state.thresholds.splWarn=95; state.thresholds.splAlert=102; state.thresholds.caLow=6; state.thresholds.caWarn=14; state.thresholds.caAlert=20; }
  populateThresholdInputs();
});

document.getElementById('btnSaveThresholds').addEventListener('click', () => {
  state.thresholds.splLow   = parseFloat(document.getElementById('thSplLow').value)   || 60.0;
  state.thresholds.splWarn  = parseFloat(document.getElementById('thSplWarn').value)  || 85.0;
  state.thresholds.splAlert = parseFloat(document.getElementById('thSplAlert').value) || 95.0;
  state.thresholds.caLow    = parseFloat(document.getElementById('thCaLow').value)    || 4.0;
  state.thresholds.caWarn   = parseFloat(document.getElementById('thCaWarn').value)   || 12.0;
  state.thresholds.caAlert  = parseFloat(document.getElementById('thCaAlert').value)  || 18.0;
  postNative('saveThresholds', { thresholds: state.thresholds });
});

// ---- SCHEDULE MANAGER ----
let editingScheduleId = null;

function resetScheduleForm() {
  editingScheduleId = null;
  const titleEl = document.getElementById('schedFormTitle');
  if (titleEl) titleEl.textContent = '+ ADD SCHEDULED LOGGING EVENT';
  const saveBtn = document.getElementById('btnAddScheduleEvent');
  if (saveBtn) saveBtn.textContent = 'SAVE TO SCHEDULE';
  const cancelBtn = document.getElementById('btnCancelEditSchedule');
  if (cancelBtn) cancelBtn.style.display = 'none';

  document.getElementById('schedName').value = '';
  document.getElementById('schedRecurrence').value = 'weekly';
  document.getElementById('groupSchedDate').style.display = 'none';
  document.getElementById('groupSchedDays').style.display = 'flex';
  document.getElementById('schedDate').value = '';
  document.querySelectorAll('input[name="schedDay"]').forEach((cb, i) => {
    cb.checked = (i === 0);
  });
  document.getElementById('schedStartTime').value = '08:30';
  document.getElementById('schedEndTime').value = '12:30';
  document.getElementById('schedInterval').value = '3000';
  document.getElementById('schedFormat').value = 'txt';
  document.getElementById('schedPreventSleep').checked = false;
}

function renderScheduleList() {
  const container = document.getElementById('scheduleListContainer');
  const statusEl  = document.getElementById('topScheduleStatus');
  container.innerHTML = '';

  if (state.schedules.length === 0) {
    container.innerHTML = '<span class="cal-guide" style="font-style:italic">No scheduled events yet. Add one below!</span>';
    statusEl.textContent = 'OFF';
    statusEl.classList.add('status-dim');
    return;
  }

  let anyActive = false;
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  state.schedules.forEach((ev, idx) => {
    if (ev.enabled) anyActive = true;
    const item = document.createElement('div');
    item.className = 'sched-item' + (ev.enabled ? ' sched-active' : '');
    let meta = '';
    if (ev.recurrence === 'one-off') meta = `One-off on ${ev.date} @ ${ev.startTime}\u2013${ev.endTime}`;
    else if (ev.recurrence === 'weekly') {
      const days = (ev.days || []).map(d => dayNames[d]).join(', ');
      meta = `Every ${days || 'Week'} @ ${ev.startTime}\u2013${ev.endTime}`;
    } else meta = `Daily @ ${ev.startTime}\u2013${ev.endTime}`;
    meta += ` \u2022 ${ev.intervalMs / 1000}s \u2022 ${(ev.format || 'txt').toUpperCase()}`;
    if (ev.preventSleep) meta += ' \u2022 [Sleep Prevent]';

    item.innerHTML = `
      <div class="sched-item-info">
        <span class="sched-item-name">${ev.name}</span>
        <span class="sched-item-meta">${meta}</span>
      </div>
      <div class="sched-item-actions">
        <button class="btn-sm" data-edit-idx="${idx}" title="Edit schedule">EDIT</button>
        <label class="toggle-switch">
          <input type="checkbox" ${ev.enabled ? 'checked' : ''} data-toggle-idx="${idx}">
          <span class="slider"></span>
        </label>
        <button class="btn-sm btn-danger" data-del-idx="${idx}">\u00d7</button>
      </div>`;
    container.appendChild(item);
  });

  statusEl.textContent = anyActive ? 'ACTIVE' : 'STANDBY';
  anyActive ? statusEl.classList.remove('status-dim') : statusEl.classList.add('status-dim');

  // Edit schedule
  container.querySelectorAll('[data-edit-idx]').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.currentTarget.dataset.editIdx);
      const ev = state.schedules[idx];
      if (!ev) return;
      editingScheduleId = ev.id;
      const titleEl = document.getElementById('schedFormTitle');
      if (titleEl) titleEl.textContent = `\u270e EDIT SCHEDULE: ${ev.name}`;
      const saveBtn = document.getElementById('btnAddScheduleEvent');
      if (saveBtn) saveBtn.textContent = 'UPDATE SCHEDULE';
      const cancelBtn = document.getElementById('btnCancelEditSchedule');
      if (cancelBtn) cancelBtn.style.display = 'inline-block';

      document.getElementById('schedName').value = ev.name || '';
      document.getElementById('schedRecurrence').value = ev.recurrence || 'weekly';
      const rec = ev.recurrence || 'weekly';
      document.getElementById('groupSchedDate').style.display = rec === 'one-off' ? 'flex' : 'none';
      document.getElementById('groupSchedDays').style.display = rec === 'weekly'  ? 'flex' : 'none';
      document.getElementById('schedDate').value = ev.date || '';

      const days = ev.days || [];
      document.querySelectorAll('input[name="schedDay"]').forEach(cb => {
        cb.checked = days.includes(parseInt(cb.value));
      });

      document.getElementById('schedStartTime').value = ev.startTime || '08:30';
      document.getElementById('schedEndTime').value   = ev.endTime || '12:30';
      document.getElementById('schedInterval').value  = String(ev.intervalMs || 3000);
      document.getElementById('schedFormat').value    = ev.format || 'txt';
      document.getElementById('schedPreventSleep').checked = !!ev.preventSleep;

      const addBox = document.querySelector('.add-event-box');
      if (addBox) addBox.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Toggle active
  container.querySelectorAll('[data-toggle-idx]').forEach(input => {
    input.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.toggleIdx);
      state.schedules[idx].enabled = e.target.checked;
      postNative('saveSchedules', { schedules: state.schedules });
      renderScheduleList();
    });
  });

  // Delete
  container.querySelectorAll('[data-del-idx]').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.delIdx);
      if (state.schedules[idx] && state.schedules[idx].id === editingScheduleId) {
        resetScheduleForm();
      }
      state.schedules.splice(idx, 1);
      postNative('saveSchedules', { schedules: state.schedules });
      renderScheduleList();
    });
  });
}

document.getElementById('schedRecurrence').addEventListener('change', () => {
  const rec = document.getElementById('schedRecurrence').value;
  document.getElementById('groupSchedDate').style.display = rec === 'one-off' ? 'flex' : 'none';
  document.getElementById('groupSchedDays').style.display = rec === 'weekly'  ? 'flex' : 'none';
});

document.getElementById('btnCancelEditSchedule').addEventListener('click', () => {
  resetScheduleForm();
});

document.getElementById('btnAddScheduleEvent').addEventListener('click', () => {
  const name = document.getElementById('schedName').value.trim() || 'Scheduled Session';
  const rec  = document.getElementById('schedRecurrence').value;
  const days = [];
  document.querySelectorAll('input[name="schedDay"]:checked').forEach(cb => days.push(parseInt(cb.value)));
  const dateVal = document.getElementById('schedDate').value;
  const startTime = document.getElementById('schedStartTime').value || '08:30';
  const endTime = document.getElementById('schedEndTime').value   || '12:30';
  const intervalMs = parseInt(document.getElementById('schedInterval').value) || 3000;
  const format = document.getElementById('schedFormat').value || 'txt';
  const preventSleep = document.getElementById('schedPreventSleep').checked;

  if (editingScheduleId) {
    const ev = state.schedules.find(s => s.id === editingScheduleId);
    if (ev) {
      ev.name = name;
      ev.recurrence = rec;
      ev.days = days.length > 0 ? days : [0];
      ev.date = dateVal;
      ev.startTime = startTime;
      ev.endTime = endTime;
      ev.intervalMs = intervalMs;
      ev.format = format;
      ev.preventSleep = preventSleep;
    }
    resetScheduleForm();
  } else {
    const ev = {
      id: 'ev_' + Date.now(),
      name,
      enabled: true,
      recurrence: rec,
      days: days.length > 0 ? days : [0],
      date: dateVal,
      startTime,
      endTime,
      intervalMs,
      format,
      preventSleep
    };
    state.schedules.push(ev);
    resetScheduleForm();
  }

  postNative('saveSchedules', { schedules: state.schedules });
  renderScheduleList();
});

// ---- BOOTSTRAP ----
postNative('getInitialState');
