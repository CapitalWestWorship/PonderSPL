// ==========================================================================
// ProSPL Meter - Frontend Application Logic & Real-Time Canvas Rendering
// ==========================================================================

// Global State
const state = {
  masterMetric: 'LAS',
  caSpeed: 'slow', // 'slow' or 'fast'
  currentLAS: 0,
  currentLCS: 0,
  currentCminusA: 0,
  offset: 100.0,
  leqWindowSec: 1.0,
  historyTimeSec: 300, // 5 min default

  // Color Thresholds (User Configurable)
  thresholds: {
    splLow: 60.0,     // < 60 = Gray
    splWarn: 85.0,    // 60-85 = Green
    splAlert: 95.0,   // 85-95 = Yellow, >= 95 = Red

    caLow: 4.0,       // < 4 = Gray (Lean)
    caWarn: 12.0,     // 4-12 = Green (Balanced)
    caAlert: 18.0     // 12-18 = Yellow (Heavy), >= 18 = Red (Excessive)
  },

  // Rolling History Buffer (timestamp, LAS, LCS, CminusA)
  history: [],
  maxHistoryPoints: 900, // 30fps downsampled or 1Hz points

  // Calibration Info
  isCalLoaded: false,
  isCalEnabled: true,
  calFileName: '',
  calPoints: [],

  // RTA spectrum
  rtaBands: new Array(31).fill(30)
};

// Standard RTA Center Frequencies
const RTA_LABELS = [
  '20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160',
  '200', '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k',
  '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k'
];

// Send command to native Cocoa bridge
function postNative(action, payload = {}) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.prospl) {
    window.webkit.messageHandlers.prospl.postMessage({ action, ...payload });
  } else {
    console.log('[NativeBridge Mock]', action, payload);
  }
}

// ---------------- DOM ELEMENTS ----------------
const el = {
  deviceSelect: document.getElementById('deviceSelect'),
  channelSelect: document.getElementById('channelSelect'),
  topOffsetVal: document.getElementById('topOffsetVal'),
  topMicStatus: document.getElementById('topMicStatus'),
  btnOpenCal: document.getElementById('btnOpenCal'),
  btnOpenMicCal: document.getElementById('btnOpenMicCal'),
  btnOpenThresholds: document.getElementById('btnOpenThresholds'),
  btnToggleLogging: document.getElementById('btnToggleLogging'),
  recText: document.getElementById('recText'),

  // Master Card
  cardMaster: document.getElementById('cardMaster'),
  masterMetricSelect: document.getElementById('masterMetricSelect'),
  masterSpeedBadge: document.getElementById('masterSpeedBadge'),
  masterUnitBadge: document.getElementById('masterUnitBadge'),
  masterNum: document.getElementById('masterNum'),
  masterUnit: document.getElementById('masterUnit'),
  masterBarFill: document.getElementById('masterBarFill'),
  masterMax: document.getElementById('masterMax'),
  masterMin: document.getElementById('masterMin'),
  masterLeqTime: document.getElementById('masterLeqTime'),

  // C Minus A Card
  cardCminusA: document.getElementById('cardCminusA'),
  btnToggleCASpeed: document.getElementById('btnToggleCASpeed'),
  caSpeedLabel: document.getElementById('caSpeedLabel'),
  caNum: document.getElementById('caNum'),
  caIndicator: document.getElementById('caIndicator'),
  caDescription: document.getElementById('caDescription'),

  // Matrix
  leqWindowSelect: document.getElementById('leqWindowSelect'),
  btnResetStats: document.getElementById('btnResetStats'),
  valLAF: document.getElementById('valLAF'),
  valLAS: document.getElementById('valLAS'),
  valLAeq: document.getElementById('valLAeq'),
  valLAmax: document.getElementById('valLAmax'),
  valLAmin: document.getElementById('valLAmin'),

  valLCF: document.getElementById('valLCF'),
  valLCS: document.getElementById('valLCS'),
  valLCeq: document.getElementById('valLCeq'),
  valLCpeak: document.getElementById('valLCpeak'),

  valLZF: document.getElementById('valLZF'),
  valLZS: document.getElementById('valLZS'),
  valLZeq: document.getElementById('valLZeq'),
  valLZpeak: document.getElementById('valLZpeak'),

  // Visuals
  historyCanvas: document.getElementById('historyCanvas'),
  rtaCanvas: document.getElementById('rtaCanvas'),
  graphTimeSelect: document.getElementById('graphTimeSelect'),

  // Footer / Logging
  logPulse: document.getElementById('logPulse'),
  logStatusText: document.getElementById('logStatusText'),
  logRecordCount: document.getElementById('logRecordCount'),
  logDuration: document.getElementById('logDuration'),
  btnOpenLogFolder: document.getElementById('btnOpenLogFolder'),
  btnConfigureLogger: document.getElementById('btnConfigureLogger'),

  // Modals
  modalCal: document.getElementById('modalCal'),
  modalThresholds: document.getElementById('modalThresholds'),
  modalLogger: document.getElementById('modalLogger'),

  // Cal Modal Elements
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

  // Threshold Modal Elements
  threshPresetSelect: document.getElementById('threshPresetSelect'),
  thSplLow: document.getElementById('thSplLow'),
  thSplWarn: document.getElementById('thSplWarn'),
  thSplAlert: document.getElementById('thSplAlert'),
  thCaLow: document.getElementById('thCaLow'),
  thCaWarn: document.getElementById('thCaWarn'),
  thCaAlert: document.getElementById('thCaAlert'),
  btnSaveThresholds: document.getElementById('btnSaveThresholds'),

  // Logger Modal Elements
  logIntervalSelect: document.getElementById('logIntervalSelect'),
  logDirectoryInput: document.getElementById('logDirectoryInput'),
  btnBrowseLogFolder: document.getElementById('btnBrowseLogFolder')
};

// ---------------- COLOR DETERMINATION ----------------
function getSPLColorClass(splVal) {
  if (splVal < state.thresholds.splLow) return 'color-gray';
  if (splVal < state.thresholds.splWarn) return 'color-green';
  if (splVal < state.thresholds.splAlert) return 'color-yellow';
  return 'color-red';
}

function getCAColorClass(caVal) {
  if (caVal < state.thresholds.caLow) return 'color-gray';
  if (caVal < state.thresholds.caWarn) return 'color-green';
  if (caVal < state.thresholds.caAlert) return 'color-yellow';
  return 'color-red';
}

// ---------------- INITIALIZATION FROM NATIVE ----------------
window.onInitialState = function(data) {
  // Populate Devices
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

  // Thresholds from defaults
  if (data.thresholds && typeof data.thresholds === 'object') {
    Object.assign(state.thresholds, data.thresholds);
    populateThresholdInputs();
  }

  // Mic Calibration
  if (data.isCalLoaded) {
    state.isCalLoaded = true;
    state.isCalEnabled = data.isCalEnabled;
    state.calFileName = data.calFileName;
    state.calPoints = data.calPoints || [];

    el.topMicStatus.textContent = data.calFileName.toUpperCase().slice(0, 14);
    el.topMicStatus.classList.remove('status-dim');
    el.topMicStatus.classList.add('status-active');

    el.calFileName.textContent = data.calFileName;
    el.calFileMeta.textContent = `${state.calPoints.length} correction points (10Hz - 20kHz)`;
    el.btnClearCalFile.style.display = 'inline-block';
    el.calCurveContainer.style.display = 'flex';
    el.calEnabledCheckbox.checked = state.isCalEnabled;

    drawCalibrationCurve(state.calPoints);
  } else {
    state.isCalLoaded = false;
    el.topMicStatus.textContent = 'NONE';
    el.topMicStatus.classList.add('status-dim');
    el.calFileName.textContent = 'No calibration file loaded';
    el.calFileMeta.textContent = 'Flat uncorrected response';
    el.btnClearCalFile.style.display = 'none';
    el.calCurveContainer.style.display = 'none';
  }

  if (data.defaultLogDir) {
    el.logDirectoryInput.value = data.defaultLogDir;
  }
};

window.onLogFolderSelected = function(folderPath) {
  el.logDirectoryInput.value = folderPath;
};

// ---------------- REAL-TIME METRICS STREAM (30 FPS) ----------------
window.onMetrics = function(m) {
  state.currentLAS = m.LAS;
  state.currentLCS = m.LCS;

  // Format 1 decimal place
  const fmt = (val) => (val > 0 ? val.toFixed(1) : '--.-');

  // Master display selection
  let masterValue = m[state.masterMetric] || m.LAS;
  let masterColorClass = (state.masterMetric === 'CminusA') ? getCAColorClass(masterValue) : getSPLColorClass(masterValue);

  el.masterNum.textContent = masterValue > 0 ? masterValue.toFixed(1) : '--.-';
  el.masterNum.className = 'number ' + masterColorClass;

  // Update master unit badge
  if (state.masterMetric === 'CminusA') {
    el.masterUnitBadge.textContent = 'DELTA dB';
    el.masterUnit.textContent = 'dB';
  } else if (state.masterMetric.startsWith('LC')) {
    el.masterUnitBadge.textContent = 'dBC';
    el.masterUnit.textContent = 'dBC';
  } else if (state.masterMetric.startsWith('LZ')) {
    el.masterUnitBadge.textContent = 'dBZ';
    el.masterUnit.textContent = 'dBZ';
  } else {
    el.masterUnitBadge.textContent = 'dBA';
    el.masterUnit.textContent = 'dBA';
  }

  // Level bar (40 dB to 120 dB range)
  let barPct = ((masterValue - 40.0) / 80.0) * 100.0;
  barPct = Math.max(0, Math.min(100, barPct));
  el.masterBarFill.style.width = barPct + '%';

  el.masterMax.textContent = fmt(m.LAmax);
  el.masterMin.textContent = fmt(m.LAmin);

  // ---------------- LIVE C MINUS A DISPLAY (Key Feature) ----------------
  const caValue = (state.caSpeed === 'slow') ? m.CminusA : m.CminusA_Fast;
  state.currentCminusA = caValue;
  const caColorClass = getCAColorClass(caValue);

  el.caNum.textContent = (caValue >= 0 ? '+' : '') + caValue.toFixed(1);
  el.caNum.className = 'number ' + caColorClass;

  // Position indicator on LF Balance gauge (0 dB to 25 dB scale)
  let caPct = (caValue / 25.0) * 100.0;
  caPct = Math.max(2, Math.min(98, caPct));
  el.caIndicator.style.left = caPct + '%';

  // Sub-bass qualitative description
  if (caValue < state.thresholds.caLow) {
    el.caDescription.textContent = 'Lean / Sub-bass Attenuated (Acoustic / Speech)';
  } else if (caValue < state.thresholds.caWarn) {
    el.caDescription.textContent = 'Balanced Low-End (Musical Standard Target)';
  } else if (caValue < state.thresholds.caAlert) {
    el.caDescription.textContent = 'Heavy Bass Dominance (High Sub Energy)';
  } else {
    el.caDescription.textContent = 'Excessive Sub-Bass Rumble (Venue LF Alert!)';
  }

  // ---------------- SIMULTANEOUS MATRIX ----------------
  el.valLAF.textContent = fmt(m.LAF);
  el.valLAF.className = 'row-value ' + getSPLColorClass(m.LAF);

  el.valLAS.textContent = fmt(m.LAS);
  el.valLAS.className = 'row-value ' + getSPLColorClass(m.LAS);

  el.valLAeq.textContent = fmt(m.LAeq);
  el.valLAeq.className = 'row-value ' + getSPLColorClass(m.LAeq);

  el.valLAmax.textContent = fmt(m.LAmax);
  el.valLAmin.textContent = fmt(m.LAmin);

  el.valLCF.textContent = fmt(m.LCF);
  el.valLCF.className = 'row-value ' + getSPLColorClass(m.LCF);

  el.valLCS.textContent = fmt(m.LCS);
  el.valLCS.className = 'row-value ' + getSPLColorClass(m.LCS);

  el.valLCeq.textContent = fmt(m.LCeq);
  el.valLCeq.className = 'row-value ' + getSPLColorClass(m.LCeq);

  el.valLCpeak.textContent = fmt(m.LCpeak);

  el.valLZF.textContent = fmt(m.LZF);
  el.valLZF.className = 'row-value ' + getSPLColorClass(m.LZF);

  el.valLZS.textContent = fmt(m.LZS);
  el.valLZS.className = 'row-value ' + getSPLColorClass(m.LZS);

  el.valLZeq.textContent = fmt(m.LZeq);
  el.valLZeq.className = 'row-value ' + getSPLColorClass(m.LZeq);

  el.valLZpeak.textContent = fmt(m.LZpeak);

  // Update Cal modal live reading
  el.calCurrentLAS.textContent = fmt(m.LAS) + ' dBA';

  // ---------------- CSV LOGGER STATUS ----------------
  if (m.isLogging) {
    el.btnToggleLogging.classList.add('recording-active');
    el.recText.textContent = m.isPaused ? 'REC PAUSED' : 'LOGGING...';
    el.logPulse.className = m.isPaused ? 'status-pulse' : 'status-pulse recording';
    el.logStatusText.textContent = m.isPaused ? 'CSV LOGGER: PAUSED' : 'CSV LOGGER: ACTIVE [REC]';
    el.logRecordCount.textContent = `${m.logRecords.toLocaleString()} rows logged`;

    const sec = m.logElapsed || 0;
    const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const ss = String(Math.floor(sec % 60)).padStart(2, '0');
    el.logDuration.textContent = `${hh}:${mm}:${ss}`;
  } else {
    el.btnToggleLogging.classList.remove('recording-active');
    el.recText.textContent = 'REC CSV';
    el.logPulse.className = 'status-pulse';
    el.logStatusText.textContent = 'CSV LOGGER: IDLE';
    el.logRecordCount.textContent = '0 records';
    el.logDuration.textContent = '00:00:00';
  }

  // Update RTA
  if (m.rta && m.rta.length === 31) {
    state.rtaBands = m.rta;
  }

  // Push to history
  pushHistoryPoint(m.LAS, m.LCS, caValue);
};

// ---------------- HISTORY BUFFER & CANVAS ----------------
let historyThrottle = 0;
function pushHistoryPoint(las, lcs, ca) {
  historyThrottle++;
  if (historyThrottle % 3 !== 0) return; // 10 points per sec

  state.history.push({ las, lcs, ca, time: Date.now() });
  if (state.history.length > 900) {
    state.history.shift();
  }
}

function drawHistoryChart() {
  const canvas = el.historyCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.clearRect(0, 0, 0, 0);
  ctx.fillStyle = '#1c222d';
  ctx.fillRect(0, 0, w, h);

  // Grid Lines (40 to 120 dB)
  const minDB = 30.0;
  const maxDB = 115.0;
  const dbRange = maxDB - minDB;

  ctx.strokeStyle = '#2b3342';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  ctx.fillStyle = '#64748b';

  const gridSteps = [40, 60, 80, 85, 95, 105];
  gridSteps.forEach(db => {
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

  // Helper to draw a curve
  function drawCurve(prop, color, lineWidth) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    points.forEach((pt, i) => {
      const x = 38 + i * stepX;
      let val = pt[prop];
      if (prop === 'ca') {
        // Map C-A onto separate lower half scale or baseline
        val = 40.0 + pt.ca * 2.5; // Offset to visually show delta
      }
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

// ---------------- 1/3-OCTAVE RTA SPECTRUM CANVAS ----------------
function drawRTASpectrum() {
  const canvas = el.rtaCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
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

  // Grid
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

    // Gradient bar based on level
    let barColor = '#10b981';
    if (dbVal > 85) barColor = '#f59e0b';
    if (dbVal > 95) barColor = '#ef4444';
    if (dbVal < 50) barColor = '#64748b';

    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, barWidth, barH);

    // X-axis label every 3 bands
    if (i % 3 === 0 || i === numBands - 1) {
      ctx.fillStyle = '#8b949e';
      ctx.fillText(RTA_LABELS[i], x - 2, h - 5);
    }
  }
}

// Continuous render loop for 60fps graph smoothing
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

  // Find min and max dB
  let minDB = -10, maxDB = 10;
  points.forEach(p => {
    if (p.db < minDB) minDB = p.db;
    if (p.db > maxDB) maxDB = p.db;
  });
  minDB = Math.floor(minDB - 2);
  maxDB = Math.ceil(maxDB + 2);
  const dbSpan = maxDB - minDB;

  // Center line (0 dB)
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

  // Plot logarithmic frequency points
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

// Audio Input selection
el.deviceSelect.addEventListener('change', () => {
  postNative('setDevice', {
    deviceUID: el.deviceSelect.value,
    channel: parseInt(el.channelSelect.value)
  });
});

el.channelSelect.addEventListener('change', () => {
  postNative('setChannel', { channel: parseInt(el.channelSelect.value) });
});

// Master Display Selection
el.masterMetricSelect.addEventListener('change', () => {
  state.masterMetric = el.masterMetricSelect.value;
  if (state.masterMetric.endsWith('F')) el.masterSpeedBadge.textContent = 'FAST';
  else if (state.masterMetric.endsWith('eq')) el.masterSpeedBadge.textContent = 'LEQ';
  else if (state.masterMetric === 'CminusA') el.masterSpeedBadge.textContent = 'DELTA';
  else el.masterSpeedBadge.textContent = 'SLOW';
});

// Toggle C - A Speed
el.btnToggleCASpeed.addEventListener('click', () => {
  if (state.caSpeed === 'slow') {
    state.caSpeed = 'fast';
    el.caSpeedLabel.textContent = 'FAST (Lcf - Laf)';
  } else {
    state.caSpeed = 'slow';
    el.caSpeedLabel.textContent = 'SLOW (Lcs - Las)';
  }
});

// Leq Window Change
el.leqWindowSelect.addEventListener('change', () => {
  const sec = parseFloat(el.leqWindowSelect.value);
  state.leqWindowSec = sec;
  el.masterLeqTime.textContent = el.leqWindowSelect.options[el.leqWindowSelect.selectedIndex].text;
  postNative('setLeqWindow', { seconds: sec });
});

// Reset Stats
el.btnResetStats.addEventListener('click', () => {
  postNative('resetStats');
});

// Reference Calibration
el.btnMatchReference.addEventListener('click', () => {
  const target = parseFloat(el.calTargetInput.value);
  if (!isNaN(target) && target > 20 && target < 150) {
    postNative('calibrateToTarget', { target });
  }
});

// Manual Offset Nudges
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

// Microphone Calibration File
el.btnLoadCalFile.addEventListener('click', () => {
  postNative('chooseCalFile');
});

el.btnClearCalFile.addEventListener('click', () => {
  postNative('clearCalFile');
});

el.calEnabledCheckbox.addEventListener('change', () => {
  postNative('setCalEnabled', { enabled: el.calEnabledCheckbox.checked });
});

// Logging Control
el.btnToggleLogging.addEventListener('click', () => {
  if (el.btnToggleLogging.classList.contains('recording-active')) {
    postNative('stopLogging');
  } else {
    const interval = parseInt(el.logIntervalSelect.value);
    const dir = el.logDirectoryInput.value;
    postNative('startLogging', { intervalMs: interval, directory: dir });
  }
});

el.btnBrowseLogFolder.addEventListener('click', () => {
  postNative('chooseLogFolder');
});

el.btnOpenLogFolder.addEventListener('click', () => {
  postNative('revealLogFile');
});

// Modal Open / Close Handlers
el.btnOpenCal.addEventListener('click', () => openModal(el.modalCal));
el.btnOpenMicCal.addEventListener('click', () => openModal(el.modalCal));
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

// ---------------- THRESHOLD CUSTOMIZATION & PRESETS ----------------
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
    state.thresholds.splLow = 65.0;
    state.thresholds.splWarn = 85.0;
    state.thresholds.splAlert = 98.0;
    state.thresholds.caLow = 4.0;
    state.thresholds.caWarn = 12.0;
    state.thresholds.caAlert = 18.0;
  } else if (preset === 'osha') {
    state.thresholds.splLow = 60.0;
    state.thresholds.splWarn = 80.0;
    state.thresholds.splAlert = 85.0;
    state.thresholds.caLow = 3.0;
    state.thresholds.caWarn = 10.0;
    state.thresholds.caAlert = 15.0;
  } else if (preset === 'studio') {
    state.thresholds.splLow = 55.0;
    state.thresholds.splWarn = 75.0;
    state.thresholds.splAlert = 85.0;
    state.thresholds.caLow = 3.0;
    state.thresholds.caWarn = 8.0;
    state.thresholds.caAlert = 14.0;
  } else if (preset === 'club') {
    state.thresholds.splLow = 70.0;
    state.thresholds.splWarn = 95.0;
    state.thresholds.splAlert = 102.0;
    state.thresholds.caLow = 6.0;
    state.thresholds.caWarn = 14.0;
    state.thresholds.caAlert = 20.0;
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

// Request initial state on page load
postNative('getInitialState');
