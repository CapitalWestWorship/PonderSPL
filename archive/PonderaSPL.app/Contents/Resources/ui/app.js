// ==========================================================================
// Pondera SPL - Main Application Logic & Real-Time Canvas Rendering
// ==========================================================================

const state = {
  hero1: { metric: 'LA', window: 'slow' },
  hero2: { metric: 'CA', window: 'slow' },

  offset: 100.0,
  historyTimeSec: 300,

  thresholds: {
    splLow: 60.0,
    splWarn: 85.0,
    splAlert: 95.0,
    caLow: 4.0,
    caWarn: 12.0,
    caAlert: 18.0
  },

  history: [],
  maxHistoryPoints: 900,

  isCalLoaded: false,
  isCalEnabled: true,
  calFileName: '',
  calPoints: [],

  schedules: [],
  logFormat: 'csv',
  logIntervalMs: 3000,
  preventSleep: false,

  rtaBands: new Array(31).fill(30)
};

const RTA_LABELS = [
  '20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160',
  '200', '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k',
  '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k'
];

function postNative(action, payload = {}) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pondera) {
    window.webkit.messageHandlers.pondera.postMessage({ action, ...payload });
  } else {
    console.log('[NativeBridge Mock]', action, payload);
  }
}

// ---------------- DOM ELEMENTS ----------------
const el = {
  deviceSelect: document.getElementById('deviceSelect'),
  channelSelect: document.getElementById('channelSelect'),
  btnOpenHUD: document.getElementById('btnOpenHUD'),
  btnOpenSchedule: document.getElementById('btnOpenSchedule'),
  topScheduleStatus: document.getElementById('topScheduleStatus'),
  topOffsetVal: document.getElementById('topOffsetVal'),
  btnOpenCal: document.getElementById('btnOpenCal'),
  btnOpenThresholds: document.getElementById('btnOpenThresholds'),
  btnToggleLogging: document.getElementById('btnToggleLogging'),
  recText: document.getElementById('recText'),

  // Hero Tile 1
  hero1Metric: document.getElementById('hero1Metric'),
  hero1Window: document.getElementById('hero1Window'),
  hero1Num: document.getElementById('hero1Num'),
  hero1Unit: document.getElementById('hero1Unit'),
  hero1UnitBadge: document.getElementById('hero1UnitBadge'),
  hero1BarFill: document.getElementById('hero1BarFill'),
  hero1Max: document.getElementById('hero1Max'),
  hero1Min: document.getElementById('hero1Min'),
  hero1WindowText: document.getElementById('hero1WindowText'),

  // Hero Tile 2
  hero2Metric: document.getElementById('hero2Metric'),
  hero2Window: document.getElementById('hero2Window'),
  hero2Num: document.getElementById('hero2Num'),
  hero2Unit: document.getElementById('hero2Unit'),
  hero2Badge: document.getElementById('hero2Badge'),
  hero2BalanceContainer: document.getElementById('hero2BalanceContainer'),
  hero2Indicator: document.getElementById('hero2Indicator'),
  hero2Description: document.getElementById('hero2Description'),
  hero2Subtext: document.getElementById('hero2Subtext'),

  // Matrix Elements
  valLAF: document.getElementById('valLAF'),
  valLAS: document.getElementById('valLAS'),
  valLAeq1s: document.getElementById('valLAeq1s'),
  valLAeq1m: document.getElementById('valLAeq1m'),
  valLAeq15m: document.getElementById('valLAeq15m'),
  valLAmax: document.getElementById('valLAmax'),
  valLAmin: document.getElementById('valLAmin'),

  valLCF: document.getElementById('valLCF'),
  valLCS: document.getElementById('valLCS'),
  valLCeq1s: document.getElementById('valLCeq1s'),
  valLCeq1m: document.getElementById('valLCeq1m'),
  valLCeq15m: document.getElementById('valLCeq15m'),
  valLCpeak: document.getElementById('valLCpeak'),

  valLZF: document.getElementById('valLZF'),
  valLZS: document.getElementById('valLZS'),
  valLZeq1s: document.getElementById('valLZeq1s'),
  valLZeq1m: document.getElementById('valLZeq1m'),
  valLZeq15m: document.getElementById('valLZeq15m'),
  valLZpeak: document.getElementById('valLZpeak'),

  btnResetStats: document.getElementById('btnResetStats'),

  // Visuals
  historyCanvas: document.getElementById('historyCanvas'),
  rtaCanvas: document.getElementById('rtaCanvas'),
  graphTimeSelect: document.getElementById('graphTimeSelect'),

  // Footer / Logger
  logPulse: document.getElementById('logPulse'),
  logStatusText: document.getElementById('logStatusText'),
  logFormatBadge: document.getElementById('logFormatBadge'),
  logRecordCount: document.getElementById('logRecordCount'),
  logDuration: document.getElementById('logDuration'),
  btnOpenLogFolder: document.getElementById('btnOpenLogFolder'),
  btnConfigureLogger: document.getElementById('btnConfigureLogger'),

  // Modals
  modalSchedule: document.getElementById('modalSchedule'),
  modalCal: document.getElementById('modalCal'),
  modalThresholds: document.getElementById('modalThresholds'),
  modalLogger: document.getElementById('modalLogger'),

  // Scheduler Form
  scheduleListContainer: document.getElementById('scheduleListContainer'),
  schedName: document.getElementById('schedName'),
  schedRecurrence: document.getElementById('schedRecurrence'),
  groupSchedDate: document.getElementById('groupSchedDate'),
  schedDate: document.getElementById('schedDate'),
  groupSchedDays: document.getElementById('groupSchedDays'),
  schedStartTime: document.getElementById('schedStartTime'),
  schedEndTime: document.getElementById('schedEndTime'),
  schedInterval: document.getElementById('schedInterval'),
  schedFormat: document.getElementById('schedFormat'),
  schedPreventSleep: document.getElementById('schedPreventSleep'),
  btnAddScheduleEvent: document.getElementById('btnAddScheduleEvent'),

  // Calibration Form
  calCurrentLAS: document.getElementById('calCurrentLAS'),
  calTargetInput: document.getElementById('calTargetInput'),
  btnMatchReference: document.getElementById('btnMatchReference'),
  manualOffsetInput: document.getElementById('manualOffsetInput'),
  btnOffsetMinus1: document.getElementById('btnOffsetMinus1'),
  btnOffsetMinus01: document.getElementById('btnOffsetMinus01'),
  btnOffsetPlus01: document.getElementById('btnOffsetPlus01'),
  btnOffsetPlus1: document.getElementById('btnOffsetPlus1'),
  calFileName: document.getElementById('calFileName'),
  calFileMeta: document.getElementById('calFileMeta'),
  btnLoadCalFile: document.getElementById('btnLoadCalFile'),
  btnClearCalFile: document.getElementById('btnClearCalFile'),
  calCurveContainer: document.getElementById('calCurveContainer'),
  calCurveCanvas: document.getElementById('calCurveCanvas'),
  calEnabledCheckbox: document.getElementById('calEnabledCheckbox'),

  // Thresholds Form
  threshPresetSelect: document.getElementById('threshPresetSelect'),
  thSplLow: document.getElementById('thSplLow'),
  thSplWarn: document.getElementById('thSplWarn'),
  thSplAlert: document.getElementById('thSplAlert'),
  thCaLow: document.getElementById('thCaLow'),
  thCaWarn: document.getElementById('thCaWarn'),
  thCaAlert: document.getElementById('thCaAlert'),
  btnSaveThresholds: document.getElementById('btnSaveThresholds'),

  // Logger Form
  logFormatSelect: document.getElementById('logFormatSelect'),
  logIntervalSelect: document.getElementById('logIntervalSelect'),
  logDirectoryInput: document.getElementById('logDirectoryInput'),
  btnBrowseLogFolder: document.getElementById('btnBrowseLogFolder'),
  chkManualPreventSleep: document.getElementById('chkManualPreventSleep')
};

// ---------------- COLOR DETERMINATION ----------------
function getSPLColorClass(val) {
  if (val < state.thresholds.splLow) return 'color-gray';
  if (val < state.thresholds.splWarn) return 'color-green';
  if (val < state.thresholds.splAlert) return 'color-yellow';
  return 'color-red';
}

function getCAColorClass(val) {
  if (val < state.thresholds.caLow) return 'color-gray';
  if (val < state.thresholds.caWarn) return 'color-green';
  if (val < state.thresholds.caAlert) return 'color-yellow';
  return 'color-red';
}

// ---------------- INITIAL STATE HANDLER ----------------
window.onInitialState = function(data) {
  if (data.devices) {
    el.deviceSelect.innerHTML = '';
    data.devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.uid;
      opt.textContent = `${d.name} (${d.channels} ch, ${Math.round(d.sampleRate)} Hz)`;
      if (d.uid === data.currentDeviceUID) opt.selected = true;
      el.deviceSelect.appendChild(opt);
    });
  }

  if (data.currentChannel !== undefined) {
    el.channelSelect.value = String(data.currentChannel);
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
    state.isCalLoaded = true;
    state.isCalEnabled = data.isCalEnabled;
    state.calFileName = data.calFileName;
    state.calPoints = data.calPoints || [];

    el.calFileName.textContent = data.calFileName;
    el.calFileMeta.textContent = `${state.calPoints.length} correction points (10Hz - 20kHz)`;
    el.btnClearCalFile.style.display = 'inline-block';
    el.calCurveContainer.style.display = 'flex';
    el.calEnabledCheckbox.checked = state.isCalEnabled;

    drawCalibrationCurve(state.calPoints);
  } else {
    state.isCalLoaded = false;
    el.calFileName.textContent = 'No calibration file loaded';
    el.calFileMeta.textContent = 'Flat uncorrected response';
    el.btnClearCalFile.style.display = 'none';
    el.calCurveContainer.style.display = 'none';
  }

  if (data.defaultLogDir) {
    el.logDirectoryInput.value = data.defaultLogDir;
  }

  if (data.schedules) {
    state.schedules = data.schedules;
    renderScheduleList();
  }
};

window.onLogFolderSelected = function(folderPath) {
  el.logDirectoryInput.value = folderPath;
};

// ---------------- LIVE METRICS STREAM (30 FPS) ----------------
window.onMetrics = function(m) {
  const fmt = (val) => (val > 0 ? val.toFixed(1) : '--.-');

  // Update Hero Tile 1
  renderHeroTile('hero1', state.hero1, m);

  // Update Hero Tile 2
  renderHeroTile('hero2', state.hero2, m);

  // ---------------- MATRIX GRID ----------------
  el.valLAF.textContent = fmt(m.LAF);
  el.valLAF.className = 'row-value ' + getSPLColorClass(m.LAF);

  el.valLAS.textContent = fmt(m.LAS);
  el.valLAS.className = 'row-value ' + getSPLColorClass(m.LAS);

  el.valLAeq1s.textContent = fmt(m.LAeq_1s);
  el.valLAeq1s.className = 'row-value ' + getSPLColorClass(m.LAeq_1s);

  el.valLAeq1m.textContent = fmt(m.LAeq_1m);
  el.valLAeq1m.className = 'row-value ' + getSPLColorClass(m.LAeq_1m);

  el.valLAeq15m.textContent = fmt(m.LAeq_15m);
  el.valLAeq15m.className = 'row-value ' + getSPLColorClass(m.LAeq_15m);

  el.valLAmax.textContent = fmt(m.LAmax);
  el.valLAmin.textContent = fmt(m.LAmin);

  el.valLCF.textContent = fmt(m.LCF);
  el.valLCF.className = 'row-value ' + getSPLColorClass(m.LCF);

  el.valLCS.textContent = fmt(m.LCS);
  el.valLCS.className = 'row-value ' + getSPLColorClass(m.LCS);

  el.valLCeq1s.textContent = fmt(m.LCeq_1s);
  el.valLCeq1s.className = 'row-value ' + getSPLColorClass(m.LCeq_1s);

  el.valLCeq1m.textContent = fmt(m.LCeq_1m);
  el.valLCeq1m.className = 'row-value ' + getSPLColorClass(m.LCeq_1m);

  el.valLCeq15m.textContent = fmt(m.LCeq_15m);
  el.valLCeq15m.className = 'row-value ' + getSPLColorClass(m.LCeq_15m);

  el.valLCpeak.textContent = fmt(m.LCpeak);

  el.valLZF.textContent = fmt(m.LZF);
  el.valLZF.className = 'row-value ' + getSPLColorClass(m.LZF);

  el.valLZS.textContent = fmt(m.LZS);
  el.valLZS.className = 'row-value ' + getSPLColorClass(m.LZS);

  el.valLZeq1s.textContent = fmt(m.LZeq_1s);
  el.valLZeq1s.className = 'row-value ' + getSPLColorClass(m.LZeq_1s);

  el.valLZeq1m.textContent = fmt(m.LZeq_1m);
  el.valLZeq1m.className = 'row-value ' + getSPLColorClass(m.LZeq_1m);

  el.valLZeq15m.textContent = fmt(m.LZeq_15m);
  el.valLZeq15m.className = 'row-value ' + getSPLColorClass(m.LZeq_15m);

  el.valLZpeak.textContent = fmt(m.LZpeak);

  el.calCurrentLAS.textContent = fmt(m.LAS) + ' dBA';

  // ---------------- LOGGER STATUS ----------------
  if (m.isLogging) {
    el.btnToggleLogging.classList.add('recording-active');
    el.recText.textContent = m.isPaused ? 'REC PAUSED' : 'LOGGING...';
    el.logPulse.className = m.isPaused ? 'status-pulse' : 'status-pulse recording';
    el.logStatusText.textContent = m.isPaused ? 'LOGGER: PAUSED' : 'LOGGER: ACTIVE [REC]';
    el.logRecordCount.textContent = `${m.logRecords.toLocaleString()} rows`;
    el.logFormatBadge.textContent = (m.logFormat || 'CSV').toUpperCase();

    const sec = m.logElapsed || 0;
    const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const ss = String(Math.floor(sec % 60)).padStart(2, '0');
    el.logDuration.textContent = `${hh}:${mm}:${ss}`;
  } else {
    el.btnToggleLogging.classList.remove('recording-active');
    el.recText.textContent = 'REC LOG';
    el.logPulse.className = 'status-pulse';
    el.logStatusText.textContent = 'LOGGER: IDLE';
    el.logRecordCount.textContent = '0 records';
    el.logDuration.textContent = '00:00:00';
  }

  if (m.rta && m.rta.length === 31) {
    state.rtaBands = m.rta;
  }

  pushHistoryPoint(m.LAS, m.LCS, m.CminusA);
};

// Render Modular Hero Tile
function renderHeroTile(prefix, config, m) {
  let val = 0;
  let unit = 'dB';
  let isCA = false;

  if (config.metric === 'CA') {
    isCA = true;
    unit = 'DELTA';
    if (config.window === 'fast') val = m.CminusA_Fast;
    else if (config.window === '1m') val = m.CminusA_1m;
    else if (config.window === '5m') val = m.CminusA_5m;
    else if (config.window === '15m') val = m.CminusA_15m;
    else val = m.CminusA;
  } else if (config.metric === 'LCpk') {
    val = m.LCpeak;
    unit = 'dBC';
  } else {
    unit = (config.metric === 'LA') ? 'dBA' : (config.metric === 'LC' ? 'dBC' : 'dBZ');
    if (config.window === 'slow') val = (config.metric === 'LA') ? m.LAS : (config.metric === 'LC' ? m.LCS : m.LZS);
    else if (config.window === 'fast') val = (config.metric === 'LA') ? m.LAF : (config.metric === 'LC' ? m.LCF : m.LZF);
    else {
      const prop = `${config.metric}eq_${config.window}`;
      val = m[prop] !== undefined ? m[prop] : m.LAS;
    }
  }

  const numEl = el[`${prefix}Num`];
  const unitEl = el[`${prefix}Unit`];
  const colorClass = isCA ? getCAColorClass(val) : getSPLColorClass(val);

  if (numEl) {
    numEl.textContent = val > 0 || isCA ? (isCA && val >= 0 ? '+' : '') + val.toFixed(1) : '--.-';
    numEl.className = 'number ' + colorClass;
  }
  if (unitEl) unitEl.textContent = unit;

  if (prefix === 'hero1') {
    let barPct = isCA ? (val / 25.0) * 100.0 : ((val - 40.0) / 80.0) * 100.0;
    barPct = Math.max(0, Math.min(100, barPct));
    el.hero1BarFill.style.width = barPct + '%';
    el.hero1Max.textContent = m.LAmax > 0 ? m.LAmax.toFixed(1) : '--.-';
    el.hero1Min.textContent = m.LAmin < 140 ? m.LAmin.toFixed(1) : '--.-';
    el.hero1WindowText.textContent = config.window.toUpperCase();
    el.hero1UnitBadge.textContent = unit;
  }

  if (prefix === 'hero2') {
    el.hero2Badge.textContent = unit;
    if (isCA) {
      el.hero2BalanceContainer.style.display = 'block';
      let caPct = (val / 25.0) * 100.0;
      caPct = Math.max(2, Math.min(98, caPct));
      el.hero2Indicator.style.left = caPct + '%';

      if (val < state.thresholds.caLow) el.hero2Description.textContent = 'Lean / Sub-bass Attenuated (Acoustic / Speech)';
      else if (val < state.thresholds.caWarn) el.hero2Description.textContent = 'Balanced Low-End (Musical Target Standard)';
      else if (val < state.thresholds.caAlert) el.hero2Description.textContent = 'Heavy Bass Dominance (High Sub Energy)';
      else el.hero2Description.textContent = 'Excessive Sub-Bass Rumble (Venue LF Alert!)';
      el.hero2Subtext.textContent = 'Live delta: C-weight sub energy vs A-weight rolloff';
    } else {
      el.hero2BalanceContainer.style.display = 'none';
      el.hero2Description.textContent = `${config.metric} ${config.window.toUpperCase()}`;
      el.hero2Subtext.textContent = 'Acoustic Sound Pressure Level';
    }
  }
}

// ---------------- HERO TILE WINDOW SUB-OPTIONS ----------------
function updateHeroWindowOptions(prefix, metric) {
  const winSelect = el[`${prefix}Window`];
  winSelect.innerHTML = '';

  if (metric === 'CA') {
    const opts = [
      { id: 'slow', text: 'Slow (Lcs - Las)' },
      { id: 'fast', text: 'Fast (Lcf - Laf)' },
      { id: '1m', text: 'Leq 1m Delta' },
      { id: '5m', text: 'Leq 5m Delta' },
      { id: '15m', text: 'Leq 15m Delta' }
    ];
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.text;
      winSelect.appendChild(opt);
    });
  } else if (metric === 'LCpk') {
    const opt = document.createElement('option');
    opt.value = 'inst'; opt.textContent = 'Peak Hold';
    winSelect.appendChild(opt);
  } else {
    const opts = [
      { id: 'slow', text: 'Slow (1000ms)' },
      { id: 'fast', text: 'Fast (125ms)' },
      { id: '1s', text: 'Leq 1s' },
      { id: '5s', text: 'Leq 5s' },
      { id: '10s', text: 'Leq 10s' },
      { id: '30s', text: 'Leq 30s' },
      { id: '1m', text: 'Leq 1m' },
      { id: '5m', text: 'Leq 5m' },
      { id: '10m', text: 'Leq 10m' },
      { id: '15m', text: 'Leq 15m' },
      { id: 'total', text: 'Leq Cumulative' }
    ];
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.text;
      winSelect.appendChild(opt);
    });
  }
}

el.hero1Metric.addEventListener('change', () => {
  state.hero1.metric = el.hero1Metric.value;
  updateHeroWindowOptions('hero1', state.hero1.metric);
  state.hero1.window = el.hero1Window.value;
});
el.hero1Window.addEventListener('change', () => {
  state.hero1.window = el.hero1Window.value;
});

el.hero2Metric.addEventListener('change', () => {
  state.hero2.metric = el.hero2Metric.value;
  updateHeroWindowOptions('hero2', state.hero2.metric);
  state.hero2.window = el.hero2Window.value;
});
el.hero2Window.addEventListener('change', () => {
  state.hero2.window = el.hero2Window.value;
});

// ---------------- SCHEDULE LIST & UI ----------------
function renderScheduleList() {
  const container = el.scheduleListContainer;
  container.innerHTML = '';

  if (state.schedules.length === 0) {
    container.innerHTML = '<span class="cal-guide" style="font-style: italic;">No scheduled events yet. Add one below!</span>';
    el.topScheduleStatus.textContent = 'OFF';
    el.topScheduleStatus.classList.add('status-dim');
    return;
  }

  let anyActive = false;

  state.schedules.forEach((ev, idx) => {
    if (ev.enabled) anyActive = true;
    const item = document.createElement('div');
    item.className = 'sched-item' + (ev.enabled ? ' sched-active' : '');

    let meta = '';
    if (ev.recurrence === 'one-off') meta = `One-off on ${ev.date} @ ${ev.startTime} – ${ev.endTime}`;
    else if (ev.recurrence === 'weekly') {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = (ev.days || []).map(d => dayNames[d]).join(', ');
      meta = `Every ${days || 'Week'} @ ${ev.startTime} – ${ev.endTime}`;
    } else {
      meta = `Daily @ ${ev.startTime} – ${ev.endTime}`;
    }
    meta += ` • ${ev.intervalMs / 1000}s • ${(ev.format || 'csv').toUpperCase()}`;
    if (ev.preventSleep) meta += ' • [Sleep Prevent]';

    item.innerHTML = `
      <div class="sched-item-info">
        <span class="sched-item-name">${ev.name}</span>
        <span class="sched-item-meta">${meta}</span>
      </div>
      <div class="sched-item-actions">
        <label class="toggle-switch">
          <input type="checkbox" ${ev.enabled ? 'checked' : ''} data-toggle-idx="${idx}">
          <span class="slider"></span>
        </label>
        <button class="btn-sm btn-danger" data-del-idx="${idx}">&times;</button>
      </div>
    `;
    container.appendChild(item);
  });

  if (anyActive) {
    el.topScheduleStatus.textContent = 'ACTIVE';
    el.topScheduleStatus.classList.remove('status-dim');
  } else {
    el.topScheduleStatus.textContent = 'STANDBY';
    el.topScheduleStatus.classList.add('status-dim');
  }

  // Bind toggle and delete
  container.querySelectorAll('[data-toggle-idx]').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-toggle-idx'));
      state.schedules[idx].enabled = e.target.checked;
      postNative('saveSchedules', { schedules: state.schedules });
      renderScheduleList();
    });
  });

  container.querySelectorAll('[data-del-idx]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-del-idx'));
      state.schedules.splice(idx, 1);
      postNative('saveSchedules', { schedules: state.schedules });
      renderScheduleList();
    });
  });
}

el.schedRecurrence.addEventListener('change', () => {
  const rec = el.schedRecurrence.value;
  if (rec === 'one-off') {
    el.groupSchedDate.style.display = 'flex';
    el.groupSchedDays.style.display = 'none';
  } else if (rec === 'weekly') {
    el.groupSchedDate.style.display = 'none';
    el.groupSchedDays.style.display = 'flex';
  } else {
    el.groupSchedDate.style.display = 'none';
    el.groupSchedDays.style.display = 'none';
  }
});

el.btnAddScheduleEvent.addEventListener('click', () => {
  const name = el.schedName.value.trim() || 'Scheduled Session';
  const rec = el.schedRecurrence.value;
  const startTime = el.schedStartTime.value || '08:30';
  const endTime = el.schedEndTime.value || '12:30';
  const intervalMs = parseInt(el.schedInterval.value) || 3000;
  const format = el.schedFormat.value || 'csv';
  const preventSleep = el.schedPreventSleep.checked;

  const days = [];
  document.querySelectorAll('input[name="schedDay"]:checked').forEach(cb => {
    days.push(parseInt(cb.value));
  });

  const newEvent = {
    id: 'ev_' + Date.now(),
    name,
    enabled: true,
    recurrence: rec,
    days: days.length > 0 ? days : [0],
    date: el.schedDate.value,
    startTime,
    endTime,
    intervalMs,
    format,
    preventSleep
  };

  state.schedules.push(newEvent);
  postNative('saveSchedules', { schedules: state.schedules });
  renderScheduleList();
  el.schedName.value = '';
});

// ---------------- BREAKOUT HUD TRIGGER ----------------
el.btnOpenHUD.addEventListener('click', () => {
  postNative('openHUD');
});

// ---------------- HISTORY BUFFER & CANVAS ----------------
let historyThrottle = 0;
function pushHistoryPoint(las, lcs, ca) {
  historyThrottle++;
  if (historyThrottle % 3 !== 0) return;
  state.history.push({ las, lcs, ca, time: Date.now() });
  if (state.history.length > 900) state.history.shift();
}

function drawHistoryChart() {
  const canvas = el.historyCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1c222d';
  ctx.fillRect(0, 0, w, h);

  const minDB = 30.0;
  const maxDB = 115.0;
  const dbRange = maxDB - minDB;

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
    ctx.fillText(`${db}dB`, 5, y + 3);
  });

  if (state.history.length < 2) return;

  const points = state.history;
  const stepX = (w - 40) / (points.length - 1);

  function drawCurve(prop, color, lineWidth) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    points.forEach((pt, i) => {
      const x = 38 + i * stepX;
      let val = pt[prop];
      if (prop === 'ca') val = 40.0 + pt.ca * 2.5;
      const y = h - ((val - minDB) / dbRange) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  drawCurve('lcs', '#06b6d4', 1.5);
  drawCurve('las', '#10b981', 2);
  drawCurve('ca', '#f59e0b', 1.5);
}

function drawRTASpectrum() {
  const canvas = el.rtaCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }

  ctx.fillStyle = '#1c222d';
  ctx.fillRect(0, 0, w, h);

  const bands = state.rtaBands;
  const numBands = 31;
  const minDB = 25.0;
  const maxDB = 110.0;
  const range = maxDB - minDB;

  const padLeft = 32;
  const padBottom = 20;
  const chartW = w - padLeft - 10;
  const chartH = h - padBottom - 10;

  ctx.strokeStyle = '#283141';
  ctx.lineWidth = 1;
  ctx.font = '8.5px monospace';
  ctx.fillStyle = '#64748b';

  [40, 60, 80, 100].forEach(db => {
    const y = 10 + chartH - ((db - minDB) / range) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(w - 10, y);
    ctx.stroke();
    ctx.fillText(`${db}`, 8, y + 3);
  });

  const barWidth = (chartW / numBands) - 2;

  for (let i = 0; i < numBands; ++i) {
    const dbVal = bands[i];
    const barH = Math.max(2, ((dbVal - minDB) / range) * chartH);
    const x = padLeft + i * (barWidth + 2);
    const y = 10 + chartH - barH;

    let barColor = '#10b981';
    if (dbVal > 85) barColor = '#f59e0b';
    if (dbVal > 95) barColor = '#ef4444';
    if (dbVal < 50) barColor = '#64748b';

    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, barWidth, barH);

    if (i % 3 === 0 || i === numBands - 1) {
      ctx.fillStyle = '#8b949e';
      ctx.fillText(RTA_LABELS[i], x - 2, h - 5);
    }
  }
}

function renderGraphicsLoop() {
  drawHistoryChart();
  drawRTASpectrum();
  requestAnimationFrame(renderGraphicsLoop);
}
requestAnimationFrame(renderGraphicsLoop);

// ---------------- CALIBRATION CURVE PLOT ----------------
function drawCalibrationCurve(points) {
  const canvas = el.calCurveCanvas;
  if (!canvas || !points || points.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, w, h);

  let minDB = -10, maxDB = 10;
  points.forEach(p => {
    if (p.db < minDB) minDB = p.db;
    if (p.db > maxDB) maxDB = p.db;
  });
  minDB = Math.floor(minDB - 2);
  maxDB = Math.ceil(maxDB + 2);
  const dbSpan = maxDB - minDB;

  const zeroY = h - ((0 - minDB) / dbSpan) * h;
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(w, zeroY);
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '9px monospace';
  ctx.fillText('0 dB', 4, zeroY - 2);

  const minFreq = 10;
  const maxFreq = 20000;
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);

  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 2;
  ctx.beginPath();

  points.forEach((p, i) => {
    const logF = Math.log10(Math.max(minFreq, p.freq));
    const x = ((logF - logMin) / (logMax - logMin)) * w;
    const y = h - ((p.db - minDB) / dbSpan) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ---------------- UI EVENT LISTENERS ----------------
function updateOffsetDisplay(val) {
  state.offset = val;
  el.topOffsetVal.textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + ' dB';
  el.manualOffsetInput.value = val.toFixed(1);
}

el.deviceSelect.addEventListener('change', () => {
  postNative('setDevice', {
    deviceUID: el.deviceSelect.value,
    channel: parseInt(el.channelSelect.value)
  });
});

el.channelSelect.addEventListener('change', () => {
  postNative('setChannel', { channel: parseInt(el.channelSelect.value) });
});

el.btnResetStats.addEventListener('click', () => {
  postNative('resetStats');
});

el.btnMatchReference.addEventListener('click', () => {
  const target = parseFloat(el.calTargetInput.value);
  if (!isNaN(target) && target > 20 && target < 150) {
    postNative('calibrateToTarget', { target });
  }
});

function nudgeOffset(delta) {
  const current = parseFloat(el.manualOffsetInput.value) || state.offset;
  const updated = Math.round((current + delta) * 10) / 10;
  updateOffsetDisplay(updated);
  postNative('setOffset', { offset: updated });
}

el.btnOffsetMinus1.addEventListener('click', () => nudgeOffset(-1.0));
el.btnOffsetMinus01.addEventListener('click', () => nudgeOffset(-0.1));
el.btnOffsetPlus01.addEventListener('click', () => nudgeOffset(0.1));
el.btnOffsetPlus1.addEventListener('click', () => nudgeOffset(1.0));

el.manualOffsetInput.addEventListener('change', () => {
  const val = parseFloat(el.manualOffsetInput.value);
  if (!isNaN(val)) {
    updateOffsetDisplay(val);
    postNative('setOffset', { offset: val });
  }
});

el.btnLoadCalFile.addEventListener('click', () => postNative('chooseCalFile'));
el.btnClearCalFile.addEventListener('click', () => postNative('clearCalFile'));
el.calEnabledCheckbox.addEventListener('change', () => {
  postNative('setCalEnabled', { enabled: el.calEnabledCheckbox.checked });
});

// Logging Control
el.btnToggleLogging.addEventListener('click', () => {
  if (el.btnToggleLogging.classList.contains('recording-active')) {
    postNative('stopLogging');
  } else {
    const interval = parseInt(el.logIntervalSelect.value);
    const format = el.logFormatSelect.value;
    const dir = el.logDirectoryInput.value;
    const preventSleep = el.chkManualPreventSleep.checked;
    postNative('startLogging', {
      intervalMs: interval,
      format,
      eventName: 'Manual',
      directory: dir,
      preventSleep
    });
  }
});

el.btnBrowseLogFolder.addEventListener('click', () => postNative('chooseLogFolder'));
el.btnOpenLogFolder.addEventListener('click', () => postNative('revealLogFile'));

// Modal Controls
el.btnOpenSchedule.addEventListener('click', () => openModal(el.modalSchedule));
el.btnOpenCal.addEventListener('click', () => openModal(el.modalCal));
el.btnOpenThresholds.addEventListener('click', () => openModal(el.modalThresholds));
el.btnConfigureLogger.addEventListener('click', () => openModal(el.modalLogger));

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.getAttribute('data-close');
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
  });
});

function openModal(modal) {
  if (modal) modal.classList.add('show');
}

// Thresholds
function populateThresholdInputs() {
  el.thSplLow.value = state.thresholds.splLow.toFixed(1);
  el.thSplWarn.value = state.thresholds.splWarn.toFixed(1);
  el.thSplAlert.value = state.thresholds.splAlert.toFixed(1);

  el.thCaLow.value = state.thresholds.caLow.toFixed(1);
  el.thCaWarn.value = state.thresholds.caWarn.toFixed(1);
  el.thCaAlert.value = state.thresholds.caAlert.toFixed(1);
}

el.threshPresetSelect.addEventListener('change', () => {
  const preset = el.threshPresetSelect.value;
  if (preset === 'foh') {
    state.thresholds.splLow = 65.0; state.thresholds.splWarn = 85.0; state.thresholds.splAlert = 98.0;
    state.thresholds.caLow = 4.0; state.thresholds.caWarn = 12.0; state.thresholds.caAlert = 18.0;
  } else if (preset === 'osha') {
    state.thresholds.splLow = 60.0; state.thresholds.splWarn = 80.0; state.thresholds.splAlert = 85.0;
    state.thresholds.caLow = 3.0; state.thresholds.caWarn = 10.0; state.thresholds.caAlert = 15.0;
  } else if (preset === 'studio') {
    state.thresholds.splLow = 55.0; state.thresholds.splWarn = 75.0; state.thresholds.splAlert = 85.0;
    state.thresholds.caLow = 3.0; state.thresholds.caWarn = 8.0; state.thresholds.caAlert = 14.0;
  } else if (preset === 'club') {
    state.thresholds.splLow = 70.0; state.thresholds.splWarn = 95.0; state.thresholds.splAlert = 102.0;
    state.thresholds.caLow = 6.0; state.thresholds.caWarn = 14.0; state.thresholds.caAlert = 20.0;
  }
  populateThresholdInputs();
});

el.btnSaveThresholds.addEventListener('click', () => {
  state.thresholds.splLow = parseFloat(el.thSplLow.value) || 60.0;
  state.thresholds.splWarn = parseFloat(el.thSplWarn.value) || 85.0;
  state.thresholds.splAlert = parseFloat(el.thSplAlert.value) || 95.0;

  state.thresholds.caLow = parseFloat(el.thCaLow.value) || 4.0;
  state.thresholds.caWarn = parseFloat(el.thCaWarn.value) || 12.0;
  state.thresholds.caAlert = parseFloat(el.thCaAlert.value) || 18.0;

  postNative('saveThresholds', { thresholds: state.thresholds });
});

postNative('getInitialState');
