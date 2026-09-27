const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAY_SHORT = ['S','M','T','W','T','F','S'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function pad2(n){ return String(n).padStart(2,'0'); }
function fmtDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function todayStr(){ return fmtDate(new Date()); }
function parseDate(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(dateStr, n){ const d = parseDate(dateStr); d.setDate(d.getDate()+n); return fmtDate(d); }
function vibrate(pattern){ if (navigator.vibrate) navigator.vibrate(pattern); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtDuration(secs) {
  const s = Math.round(secs);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${pad2(r)}s` : `${r}s`;
}
function parseDuration(str) {
  const mMatch = str.match(/(\d+)\s*m/);
  const sMatch = str.match(/(\d+)\s*s/);
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  const s = sMatch ? parseInt(sMatch[1]) : 0;
  return m * 60 + s;
}

/* One icon language for the whole app (stroke icons, styled by CSS) */
const ICONS = {
  check:  '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  star:   '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  bolt:   '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
  x:      '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  dash:   '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  plus:   '<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  up:     '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>',
  down:   '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  moon:   '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  trash:  '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  grip:   '<svg viewBox="0 0 24 24"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
  swap:   '<svg viewBox="0 0 24 24"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>',
  revert: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
};

/* MD3 snackbar */
function showSnackbar(msg, variant) {
  const el = document.getElementById('snackbar');
  if (!el) return;
  el.textContent = msg;
  el.className = 'snackbar show' + (variant ? ' ' + variant : '');
  clearTimeout(showSnackbar._t);
  showSnackbar._t = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------- View routing ---------- */
document.querySelectorAll('.dock-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
document.getElementById('brandLogo').addEventListener('click', () => switchView('today'));
document.getElementById('brandLogo').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchView('today'); }
});
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelector(`.dock-btn[data-view="${name}"]`).classList.add('active');
  if (name === 'today') renderToday();
  if (name === 'plans') { collapseAllPlans(); renderPlans(); renderPlanSwitcherCard(); refreshRecords(); }
  if (name === 'streak') { resetCalendarToCurrentMonth(); renderStreak(); renderGreeting(); }
}

/* ================= TODAY ================= */
async function getActivePlan() {
  const plans = await DB.getAll('plans');
  return plans.find(p => p.isActive) || null;
}

let _todayRenderId = 0;
async function renderToday() {
  const rid = ++_todayRenderId;
  const now = new Date();
  const dayName = WEEKDAY_NAMES[now.getDay()];
  const statusBar = document.getElementById('todayStatusBar');
  const list = document.getElementById('exerciseList');
  const empty = document.getElementById('emptyToday');
  const emptyTitle = document.getElementById('emptyTodayTitle');
  const emptySub = document.getElementById('emptyTodaySub');

  const setStatus = (chipHtml) => {
    statusBar.innerHTML = `<span class="today-day">${dayName}</span>${chipHtml || ''}`;
  };
  /* Split pill + swap button; a "Revert Split" chip appears when today is overridden */
  const splitStatus = (label, rest, swapped) => `
    <div class="today-chip-row">
      <span class="today-chip${rest ? ' rest' : ''}">${label}</span>
      <button class="icon-btn split-swap-btn" aria-label="Swap today's split">${ICONS.swap}</button>
      ${swapped ? `<button class="revert-split-chip" aria-label="Revert to the default split">${ICONS.revert} Revert Split</button>` : ''}
    </div>`;
  const showEmpty = (title, sub) => {
    list.replaceChildren();
    if (emptyTitle) emptyTitle.textContent = title;
    if (emptySub) emptySub.textContent = sub;
    empty.hidden = false;
  };

  const plan = await getActivePlan();
  if (rid !== _todayRenderId) return;
  if (!plan) {
    setStatus('');
    showEmpty('No active plan', 'Create a plan in Plans and give today a split to start logging.');
    return;
  }

  const planDays = await DB.getAllByIndex('planDays', 'planId', plan.id);
  if (rid !== _todayRenderId) return;
  const defaultDay = planDays.find(pd => pd.weekday === now.getDay());
  const swapDay = resolveDaySwap(planDays);          // daily override, if valid
  const day = swapDay || defaultDay;

  if (!day) {
    setStatus(splitStatus(`${ICONS.moon} Rest day`, true, false));
    showEmpty('Rest day', `${plan.name} has nothing on ${dayName}s. Recover, or add a split in Plans.`);
    return;
  }
  setStatus(splitStatus(escapeHtml(day.label || 'Session'), false, !!swapDay));

  let exercises = await DB.getAllByIndex('exercises', 'planDayId', day.id);
  exercises = exercises.sort((a,b) => (a.order||0) - (b.order||0));
  if (rid !== _todayRenderId) return;
  if (exercises.length === 0) {
    showEmpty('No exercises yet', `Add exercises to ${day.label || 'this split'} in Plans.`);
    return;
  }

  const today = todayStr();
  const cards = [];
  for (const ex of exercises) {
    const displayName = ex.name;
    const displayReps = ex.targetReps;
    const displaySets = ex.targetSets;
    const displayType = ex.type || 'reps';
    const logs = await DB.getAllByIndex('logEntries', 'exerciseId', ex.id);
    const last = logs.sort((a,b) => b.ts - a.ts)[0];
    const doneToday = logs.some(l => l.date === today);
    const initial = escapeHtml((displayName.trim()[0] || '?').toUpperCase());

    /* Ghost cue: previous session metrics */
    let ghostHtml = '';
    if (last && !doneToday) {
      if (displayType === 'time') {
        const secs = last.reps || 0;
        ghostHtml = `<div class="exercise-ghost">Prev: ${fmtDuration(secs)}${last.weight > 0 ? ' @ ' + last.weight + 'kg' : ''}</div>`;
      } else {
        ghostHtml = `<div class="exercise-ghost">Prev: ${last.weight > 0 ? last.weight + 'kg' : 'BW'} × ${last.reps}</div>`;
      }
    }

    /* Overload detection: all target sets logged today AND reps >= target */
    let overload = false;
    if (!doneToday && last) {
      const todayLogs = logs.filter(l => l.date === today);
      if (displayType === 'time') {
        overload = todayLogs.length >= displaySets && (last.reps || 0) >= (displayReps || 0);
      } else {
        overload = todayLogs.length >= displaySets && last.reps >= displayReps;
      }
    }

    const card = document.createElement('div');
    card.className = 'exercise-card' + (doneToday ? ' logged-today' : '');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.exId = ex.id;

    const targetLabel = displayType === 'time'
      ? `${displaySets} × ${fmtDuration(displayReps)}`
      : `${displaySets} × ${displayReps}`;

    const lastLabel = displayType === 'time'
      ? (!last ? '--' : fmtDuration(last.reps || 0))
      : (!last ? '--' : (last.weight > 0 ? last.weight : 'BW'));
    const lastSub = displayType === 'time'
      ? (!last ? 'no log' : (last.weight > 0 ? 'kg hold' : 'bodyweight'))
      : (!last ? 'no log' : (last.weight > 0 ? 'kg last' : 'bodyweight'));

    card.innerHTML = `
      <div class="exercise-avatar">${doneToday ? ICONS.check : initial}</div>
      <div class="exercise-main">
        <div class="exercise-name">${escapeHtml(displayName)}</div>
        <div class="exercise-meta">${targetLabel} target</div>
        ${ghostHtml}
      </div>
      <div class="exercise-actions">
        <div class="exercise-lastlog${last ? '' : ' muted'}">
          <span class="ll-num">${lastLabel}</span>
          <span class="ll-lbl">${lastSub}</span>
        </div>
      </div>`;
    card.addEventListener('click', () => {
      openLogSheet(ex, last, { displayName, displayReps, displaySets, displayType });
    });
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLogSheet(ex, last, { displayName, displayReps, displaySets, displayType }); } });

    cards.push(card);
  }
  if (rid !== _todayRenderId) return;
  empty.hidden = true;
  list.replaceChildren(...cards);
}

/* ---------- Log sheet ---------- */
let currentExercise = null;
let currentLastLog = null;
let currentDisplay = null;
let adjustState = { weight: 0, reps: 0, sets: 0 };
const ADJUST_LIMITS = { weight: [0, 500], reps: [1, 7200], sets: [1, 20] };
const WEIGHT_STEP = 2.5;     // kg per ruler tick and per −/+ tap
const WEIGHT_TICK_PX = 24;   // must match the 24px tick spacing in .ruler (css/style.css)

function clampField(field, v) {
  const [lo, hi] = ADJUST_LIMITS[field];
  return Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
}
function fmtKg(n) { return String(Math.round(n * 100) / 100); }

function openLogSheet(ex, last, displayOverride) {
  currentExercise = ex;
  currentLastLog = last || null;
  currentDisplay = displayOverride || null;
  const isTime = (displayOverride ? displayOverride.displayType : (ex.type || 'reps')) === 'time';
  adjustState.weight = last ? last.weight : 0;
  adjustState.reps = isTime
    ? clampField('reps', last ? last.reps : (displayOverride ? displayOverride.displayReps : ex.targetReps))
    : clampField('reps', last ? last.reps : (displayOverride ? displayOverride.displayReps : ex.targetReps));
  adjustState.sets = clampField('sets', last ? last.sets : (displayOverride ? displayOverride.displaySets : ex.targetSets));

  const exName = displayOverride ? displayOverride.displayName : ex.name;
  document.getElementById('logSheetTitle').textContent = exName;

  const repsLabel = document.getElementById('adjustRepsLabel');
  const repsValue = document.getElementById('repsValue');
  const weightModule = document.querySelector('.weight-module');

  if (isTime) {
    if (repsLabel) repsLabel.textContent = 'Duration';
    repsValue.textContent = fmtDuration(adjustState.reps);
    if (weightModule) weightModule.style.display = 'none';
  } else {
    if (repsLabel) repsLabel.textContent = 'Reps';
    repsValue.textContent = adjustState.reps;
    if (weightModule) weightModule.style.display = '';
  }

  updateAdjustDisplay();
  showSheet('logSheet');
}

function updateAdjustDisplay() {
  const w = adjustState.weight;
  const input = document.getElementById('weightInput');
  if (document.activeElement !== input) input.value = fmtKg(w);
  const isTime = currentDisplay && currentDisplay.displayType === 'time';
  const repsValue = document.getElementById('repsValue');
  if (isTime) {
    repsValue.textContent = fmtDuration(adjustState.reps);
  } else {
    repsValue.textContent = adjustState.reps;
  }
  document.getElementById('setsValue').textContent = adjustState.sets;

  /* Ruler indicator: ticks slide with the value (drag right = heavier) */
  document.getElementById('weightTrack').style.setProperty('--rx', `${(w / WEIGHT_STEP) * WEIGHT_TICK_PX}px`);

  /* Change vs the last logged set */
  const chip = document.getElementById('weightDeltaChip');
  if (!currentLastLog) {
    chip.className = 'delta-chip';
    chip.textContent = 'First log for this lift';
    return;
  }
  const d = Math.round((w - currentLastLog.weight) * 100) / 100;
  if (d > 0) {
    chip.className = 'delta-chip up';
    chip.innerHTML = `${ICONS.up} +${fmtKg(d)} kg vs last`;
  } else if (d < 0) {
    chip.className = 'delta-chip down';
    chip.innerHTML = `${ICONS.down} −${fmtKg(-d)} kg vs last`;
  } else {
    chip.className = 'delta-chip';
    chip.textContent = `Same as last (${fmtKg(w)} kg)`;
  }
}

function attachSwipe(trackId, field, stepPx, stepValue) {
  const el = document.getElementById(trackId);
  let startX = 0, startVal = 0, dragging = false, lastSteps = 0;
  const start = (x) => {
    const wi = document.getElementById('weightInput');
    if (document.activeElement === wi) wi.blur();
    dragging = true; startX = x; startVal = adjustState[field]; lastSteps = 0;
    el.classList.add('dragging');
  };
  const move = (x) => {
    if (!dragging) return;
    const steps = Math.round((x - startX) / stepPx);
    if (steps === lastSteps) return;
    lastSteps = steps;
    const next = clampField(field, startVal + steps * stepValue);
    if (next !== adjustState[field]) { adjustState[field] = next; vibrate(5); updateAdjustDisplay(); }
  };
  const onMouseMove = (e) => move(e.clientX);
  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', end);
  };
  el.addEventListener('touchstart', e => start(e.touches[0].clientX), { passive: true });
  el.addEventListener('touchmove', e => move(e.touches[0].clientX), { passive: true });
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
  el.addEventListener('mousedown', e => {
    start(e.clientX);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', end);
  });
}
attachSwipe('weightTrack', 'weight', WEIGHT_TICK_PX, WEIGHT_STEP);
attachSwipe('repsTrack', 'reps', 20, 1);
attachSwipe('setsTrack', 'sets', 20, 1);

/* −/+ buttons (press and hold to repeat) */
document.querySelectorAll('.step-btn').forEach(btn => {
  const field = btn.dataset.stepField;
  const step = Number(btn.dataset.step);
  const isWeight = field === 'weight';
  let holdTimer = null, repeatTimer = null;
  const bump = (overrideStep) => {
    const wi = document.getElementById('weightInput');
    if (document.activeElement === wi) wi.blur();
    const s = overrideStep !== undefined ? overrideStep : step;
    const next = clampField(field, adjustState[field] + s);
    if (next === adjustState[field]) return;
    adjustState[field] = next;
    vibrate(8);
    updateAdjustDisplay();
  };
  const stop = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); };
  btn.addEventListener('pointerdown', () => {
    bump();
    stop();
    if (isWeight) {
      holdTimer = setTimeout(() => { repeatTimer = setInterval(() => bump(step * 2.5), 90); }, 300);
    } else {
      holdTimer = setTimeout(() => { repeatTimer = setInterval(bump, 90); }, 400);
    }
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
  btn.addEventListener('click', e => { if (e.detail === 0) bump(); }); // keyboard activation
});

/* Quick-pill buttons (±2.5 weight jumps) */
document.querySelectorAll('.quick-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const field = btn.dataset.stepField;
    const step = Number(btn.dataset.step);
    const wi = document.getElementById('weightInput');
    if (document.activeElement === wi) wi.blur();
    const next = clampField(field, adjustState[field] + step);
    if (next === adjustState[field]) return;
    adjustState[field] = next;
    vibrate(12);
    updateAdjustDisplay();
  });
});

/* Typed weight */
(function wireWeightInput() {
  const input = document.getElementById('weightInput');
  const parse = () => parseFloat(String(input.value).replace(',', '.'));
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    const v = parse();
    if (!Number.isNaN(v)) { adjustState.weight = clampField('weight', v); updateAdjustDisplay(); }
  });
  const commit = () => {
    const v = parse();
    if (!Number.isNaN(v)) adjustState.weight = clampField('weight', v);
    input.value = fmtKg(adjustState.weight);
    updateAdjustDisplay();
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
})();

async function checkIsPR(exerciseId, weight, reps, isTime) {
  const logs = await DB.getAllByIndex('logEntries', 'exerciseId', exerciseId);
  if (logs.length === 0) return true;
  if (isTime) {
    const bestDuration = Math.max(0, ...logs.map(l => l.reps));
    return reps > bestDuration;
  }
  const maxWeight = Math.max(...logs.map(l => l.weight));
  if (weight > maxWeight) return true;
  if (weight < maxWeight) return false;
  const bestRepsAtMax = Math.max(0, ...logs.filter(l => l.weight === maxWeight).map(l => l.reps));
  return reps > bestRepsAtMax;
}

let _logInFlight = false;
document.getElementById('confirmLogBtn').addEventListener('click', async () => {
  if (!currentExercise || _logInFlight) return;
  const wi = document.getElementById('weightInput');
  if (document.activeElement === wi) wi.blur();   // commits a typed value
  if (adjustState.reps < 1 || adjustState.sets < 1) {
    showSnackbar('Duration/reps and sets need to be at least 1.');
    return;
  }
  _logInFlight = true;
  try {
    const ex = currentExercise;
    const isTime = currentDisplay && currentDisplay.displayType === 'time';
    const isPR = await checkIsPR(ex.id, adjustState.weight, adjustState.reps, isTime);
    await DB.add('logEntries', {
      exerciseId: ex.id, date: todayStr(),
      reps: adjustState.reps, sets: adjustState.sets, weight: adjustState.weight,
      isPR, ts: Date.now(), type: isTime ? 'time' : 'reps'
    });
    vibrate(isPR ? [30,50,30] : [30]);
    hideSheet('logSheet');
    const exName = currentDisplay ? currentDisplay.displayName : ex.name;
    if (isTime) {
      showSnackbar(
        isPR ? `New PR on ${exName}: ${fmtDuration(adjustState.reps)}`
             : `Logged ${exName}`,
        isPR ? 'pr' : ''
      );
    } else {
      showSnackbar(
        isPR ? `New PR on ${exName}: ${fmtKg(adjustState.weight)} kg × ${adjustState.reps}`
             : `Logged ${exName}`,
        isPR ? 'pr' : ''
      );
    }
    renderToday();
    updateStreakPill();
    refreshRecords();
  } finally {
    _logInFlight = false;
  }
});

/* ---------- Sheets ---------- */
const SHEET_BACKDROPS = { logSheet:'logSheetBackdrop', promptSheet:'promptBackdrop', confirmSheet:'confirmBackdrop', editExSheet:'editExBackdrop', profileSheet:'profileBackdrop', aboutSheet:'aboutBackdrop', swapSheet:'swapBackdrop', timerSheet:'timerBackdrop', backupSheet:'backupBackdrop', macroSheet:'macroBackdrop' };
function showSheet(id) {
  document.getElementById(id).classList.add('show');
  document.getElementById(SHEET_BACKDROPS[id]).classList.add('show');
}
function hideSheet(id) {
  document.getElementById(id).classList.remove('show');
  document.getElementById(SHEET_BACKDROPS[id]).classList.remove('show');
}
Object.entries(SHEET_BACKDROPS).forEach(([sheetId, backdropId]) => {
  document.getElementById(backdropId).addEventListener('click', () => hideSheet(sheetId));
});

let confirmCallback = null;
function openConfirm(title, msg, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  confirmCallback = callback;
  showSheet('confirmSheet');
}
document.getElementById('confirmCancelBtn').addEventListener('click', () => hideSheet('confirmSheet'));
document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  hideSheet('confirmSheet');
  if (confirmCallback) await confirmCallback();
});

let promptCallback = null;
function openPrompt(title, placeholder, callback) {
  const input = document.getElementById('promptInput');
  document.getElementById('promptTitle').textContent = title;
  input.placeholder = placeholder;
  input.value = '';
  input.classList.remove('invalid');
  promptCallback = callback;
  showSheet('promptSheet');
  setTimeout(() => input.focus(), 200);
}
function submitPrompt() {
  const input = document.getElementById('promptInput');
  const val = input.value.trim();
  if (!val) {
    input.classList.add('invalid');
    input.focus();
    return;
  }
  input.classList.remove('invalid');
  hideSheet('promptSheet');
  if (promptCallback) promptCallback(val);
}
document.getElementById('promptConfirmBtn').addEventListener('click', submitPrompt);
document.getElementById('promptInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitPrompt(); }
});

/* ================= PROFILE ================= */
const PROFILE_FIELDS = [
  ['pfWeight', 25, 350],
  ['pfHeight', 100, 250],
  ['pfAge', 13, 100]
];
const GENDER_LABELS = { male: 'Male', female: 'Female', other: 'Other' };

async function getProfile() {
  return await DB.get('profileStore', 1);
}

function setProfileMode(edit) {
  document.getElementById('profileView').hidden = edit;
  document.getElementById('profileEdit').hidden = !edit;
  document.getElementById('profileViewActions').hidden = edit;
  document.getElementById('profileEditActions').hidden = !edit;
  document.getElementById('profileSheetTitle').textContent = edit ? 'Edit profile' : 'Your profile';
}

function fillProfileView(p) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    const empty = !val;
    el.textContent = empty ? '--' : val;
    el.classList.toggle('empty', empty);
  };
  const activitySel = document.getElementById('pfActivity');
  const opt = activitySel && activitySel.selectedIndex >= 0 ? activitySel.options[activitySel.selectedIndex] : null;
  set('pvName', p && p.name ? p.name : '');
  set('pvWeight', p && p.weight ? `${p.weight} kg` : '');
  set('pvHeight', p && p.height ? `${p.height} cm` : '');
  set('pvAge', p && p.age ? String(p.age) : '');
  set('pvGender', p && p.gender ? (GENDER_LABELS[p.gender] || p.gender) : '');
  set('pvActivity', p && p.activityLevel ? (opt ? opt.text : String(p.activityLevel)) : '');
}

function fillProfileInputs(p) {
  document.getElementById('pfName').value = p ? (p.name || '') : '';
  document.getElementById('pfWeight').value = p ? p.weight : '';
  document.getElementById('pfHeight').value = p ? p.height : '';
  document.getElementById('pfAge').value = p ? p.age : '';
  document.getElementById('pfGender').value = p ? p.gender : 'male';
  document.getElementById('pfActivity').value = p ? p.activityLevel : '1.55';
  PROFILE_FIELDS.forEach(([id]) => document.getElementById(id).classList.remove('invalid'));
}

async function openProfileSheet(startInEdit) {
  const p = await getProfile();
  fillProfileInputs(p);
  fillProfileView(p);
  const edit = typeof startInEdit === 'boolean' ? startInEdit : !p;
  setProfileMode(edit);
  showSheet('profileSheet');
  if (edit) setTimeout(() => document.getElementById('pfName').focus(), 250);
}

document.getElementById('setupProfileBtn').addEventListener('click', () => openProfileSheet(true));
document.getElementById('profileEditBtn').addEventListener('click', () => {
  setProfileMode(true);
  document.getElementById('pfName').focus();
});
document.getElementById('profileCancelBtn').addEventListener('click', async () => {
  const p = await getProfile();
  fillProfileInputs(p);
  fillProfileView(p);
  setProfileMode(false);
});
document.getElementById('profileSaveBtn').addEventListener('click', async () => {
  let ok = true;
  for (const [id, lo, hi] of PROFILE_FIELDS) {
    const el = document.getElementById(id);
    const v = Number(el.value);
    const bad = !v || v < lo || v > hi;
    el.classList.toggle('invalid', bad);
    if (bad) ok = false;
  }
  if (!ok) {
    showSnackbar('Check weight (25–350 kg), height (100–250 cm) and age (13–100).');
    return;
  }
  const existing = await getProfile();
  const profile = {
    ...(existing || {}),
    id: 1,
    name: document.getElementById('pfName').value.trim(),
    weight: Number(document.getElementById('pfWeight').value),
    height: Number(document.getElementById('pfHeight').value),
    age: Number(document.getElementById('pfAge').value),
    gender: document.getElementById('pfGender').value,
    activityLevel: Number(document.getElementById('pfActivity').value)
  };
  await DB.put('profileStore', profile);
  fillProfileInputs(profile);
  fillProfileView(profile);
  setProfileMode(false);
  showSnackbar('Profile saved');
  renderNutritionCard().catch(() => {});
  renderGreeting(profile);
});

/* ================= GREETING ================= */
async function renderGreeting(profile) {
  const banner = document.getElementById('greetingBanner');
  if (!banner) return;
  const p = profile || await getProfile();
  const logs = await DB.getAll('logEntries');
  const name = p && p.name ? `<span class="greeting-name">${escapeHtml(p.name)}</span>` : '';
  if (logs.length === 0) {
    banner.innerHTML = name ? `Hi, ${name}` : 'Welcome to PRX';
  } else {
    banner.innerHTML = name ? `Welcome back, ${name}` : 'Welcome back';
  }
}

/* ================= MACROCALC (Nutrition Blueprint) ================= */
function calcBMR(profile) {
  const { weight, height, age, gender } = profile;
  const male = 10*weight + 6.25*height - 5*age + 5;
  const female = 10*weight + 6.25*height - 5*age - 161;
  if (gender === 'male') return male;
  if (gender === 'female') return female;
  return (male + female) / 2;
}

/* BMI bands. The gauge draws 4 EQUAL segments, so the needle has to be
   mapped per band — a single linear 15→40 mapping puts a BMI of 22
   (Normal) inside the Underweight segment. */
const BMI_BANDS = [
  { key: 'under',   label: 'Underweight', min: 15,   max: 18.5 },
  { key: 'healthy', label: 'Normal',      min: 18.5, max: 25 },
  { key: 'over',    label: 'Overweight',  min: 25,   max: 30 },
  { key: 'obese',   label: 'Obese',       min: 30,   max: 40 }
];
function bmiCategory(bmi) {
  return BMI_BANDS.find(b => bmi < b.max) || BMI_BANDS[BMI_BANDS.length - 1];
}
function bmiToGaugePct(bmi) {
  const clamped = Math.min(40, Math.max(15, bmi));
  let i = BMI_BANDS.findIndex(b => clamped < b.max);
  if (i === -1) i = BMI_BANDS.length - 1;
  const b = BMI_BANDS[i];
  return (i + (clamped - b.min) / (b.max - b.min)) * (100 / BMI_BANDS.length);
}

async function renderNutritionCard() {
  const profile = await getProfile();
  const noMsg = document.getElementById('noProfileMsg');
  const content = document.getElementById('nutritionContent');
  if (!noMsg || !content) return;
  if (!profile) { noMsg.hidden = false; content.hidden = true; return; }
  noMsg.hidden = true; content.hidden = false;

  const bmi = profile.weight / Math.pow(profile.height/100, 2);

  const bmiValueEl = document.getElementById('bmiValue');
  const bmiNeedleEl = document.getElementById('bmiNeedle');
  const curWeightEl = document.getElementById('curWeightDisplay');
  const tgtSlider = document.getElementById('tgtWeightSlider');
  const weeksSlider = document.getElementById('weeksSlider');
  const tgtLbl = document.getElementById('tgtWeightLbl');
  const weeksLbl = document.getElementById('weeksLbl');
  const targetResultEl = document.getElementById('targetResult');

  if (bmiValueEl) {
    bmiValueEl.textContent = bmi.toFixed(1);
    const cat = bmiCategory(bmi);
    const catEl = document.getElementById('bmiCategory');
    if (catEl) { catEl.textContent = cat.label; catEl.className = `bmi-chip ${cat.key}`; }
    if (bmiNeedleEl) bmiNeedleEl.style.left = `${bmiToGaugePct(bmi)}%`;
  }

  if (curWeightEl) curWeightEl.textContent = profile.weight + ' kg';

  if (!tgtSlider || !weeksSlider || !tgtLbl || !weeksLbl || !targetResultEl) return;

  const sMin = Number(tgtSlider.min), sMax = Number(tgtSlider.max);
  const pctOf = v => ((Math.min(sMax, Math.max(sMin, v)) - sMin) / (sMax - sMin)) * 100;
  const curPct = pctOf(profile.weight);
  tgtSlider.value = profile.weight;          // the browser clamps this to 40–160
  tgtLbl.textContent = tgtSlider.value;
  const marker = document.getElementById('curWeightMarker');
  if (marker) marker.style.setProperty('--cur', `${curPct}%`);
  const deltaChip = document.getElementById('tgtDeltaChip');

  const updateTarget = () => {
    const target = Number(tgtSlider.value);
    const weeks = Number(weeksSlider.value);
    tgtLbl.textContent = target;
    weeksLbl.textContent = weeks;

    /* Track fills */
    const tPct = pctOf(target);
    tgtSlider.style.setProperty('--a', `${Math.min(curPct, tPct)}%`);
    tgtSlider.style.setProperty('--b', `${Math.max(curPct, tPct)}%`);
    const wMin = Number(weeksSlider.min), wMax = Number(weeksSlider.max);
    weeksSlider.style.setProperty('--a', '0%');
    weeksSlider.style.setProperty('--b', `${((weeks - wMin) / (wMax - wMin)) * 100}%`);

    /* Gain / lose indicator */
    const delta = Math.round((target - profile.weight) * 10) / 10;
    tgtSlider.classList.toggle('losing', delta < 0);
    if (deltaChip) {
      if (delta > 0)      { deltaChip.className = 'delta-chip up';   deltaChip.innerHTML = `${ICONS.up} Gain ${delta} kg`; }
      else if (delta < 0) { deltaChip.className = 'delta-chip down'; deltaChip.innerHTML = `${ICONS.down} Lose ${-delta} kg`; }
      else                { deltaChip.className = 'delta-chip';      deltaChip.textContent = 'Maintain'; }
    }

    /* Calories */
    const MIN_KCAL = 1200;
    const dailyDelta = Math.round((delta * 7700) / (weeks * 7));
    const tdee = calcBMR(profile) * profile.activityLevel;
    const rawTarget = Math.round(tdee + dailyDelta);
    const targetCalories = Math.max(MIN_KCAL, rawTarget);
    const weeklyPct = (Math.abs(delta) / weeks) / profile.weight * 100;
    const tooFast = weeklyPct > 1 || rawTarget < MIN_KCAL;
    const detail = dailyDelta === 0
      ? `Maintenance for ${weeks} weeks`
      : `${dailyDelta > 0 ? '+' : '−'}${Math.abs(dailyDelta).toLocaleString()} kcal ${dailyDelta > 0 ? 'surplus' : 'deficit'} for ${weeks} weeks`;
    targetResultEl.classList.toggle('warn', tooFast);
    targetResultEl.innerHTML =
      `<strong>${targetCalories.toLocaleString()} kcal/day</strong>${detail}` +
      (tooFast ? `<span class="tr-warn">That pace is over 1% of body weight a week. Try a longer timeframe.</span>` : '');
  };
  tgtSlider.oninput = updateTarget;
  weeksSlider.oninput = updateTarget;
  updateTarget();
}

/* ================= EXERCISE RECORDS HUB ================= */
function bestLogFrom(logs, isTime) {
  if (!logs || logs.length === 0) return null;
  return logs.reduce((best, l) => {
    if (isTime) {
      if (l.reps !== best.reps) return l.reps > best.reps ? l : best;
      return (l.isPR && !best.isPR) ? l : best;
    }
    if (l.weight !== best.weight) return l.weight > best.weight ? l : best;
    if (l.reps !== best.reps) return l.reps > best.reps ? l : best;
    return (l.isPR && !best.isPR) ? l : best;
  });
}

function formatRecordValue(log, isTime) {
  if (isTime) return fmtDuration(log.reps || 0);
  if (log.weight > 0) return `${fmtKg(log.weight)} kg × ${log.reps} reps`;
  return `BW × ${log.reps} reps`;
}

/* One combined receipt: strength PRs grouped by weekday, then a divider
   and the isometric holds section. Built off-DOM into a fragment and
   committed in one pass, guarded by a render id so overlapping calls
   (view switch + plan change + stopwatch save) never interleave. */
let _recordsRenderId = 0;

function appendReceiptRow(parent, name, value, valueClass) {
  const row = document.createElement('div');
  row.className = 'receipt-row';
  row.innerHTML = `
    <span class="receipt-name">${escapeHtml(name)}</span>
    <span class="receipt-dots"></span>
    <span class="${valueClass || 'receipt-value'}">${escapeHtml(value)}</span>`;
  parent.appendChild(row);
}

function appendRecordsEmpty(parent, message) {
  const el = document.createElement('div');
  el.className = 'records-empty';
  el.textContent = message;
  parent.appendChild(el);
}

async function renderExerciseRecords() {
  const rid = ++_recordsRenderId;
  const body = document.getElementById('receiptBody');
  const summary = document.getElementById('receiptSummary');
  if (!body) return;

  const frag = document.createDocumentFragment();
  let summaryText = '';

  /* --- Section 1: strength PRs, grouped weekday by weekday --- */
  const plan = await getActivePlan();
  if (rid !== _recordsRenderId) return;

  if (!plan) {
    appendRecordsEmpty(frag, 'No active plan yet. Set one in Plans to track records by day.');
  } else {
    const planDays = (await DB.getAllByIndex('planDays', 'planId', plan.id))
      .filter(pd => pd.weekday >= 0 && pd.weekday <= 6)
      .sort((a, b) => a.weekday - b.weekday);

    let total = 0, recorded = 0;
    for (const pd of planDays) {
      const exs = (await DB.getAllByIndex('exercises', 'planDayId', pd.id))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      if (exs.length === 0) continue;
      if (rid !== _recordsRenderId) return;

      const group = document.createElement('div');
      group.className = 'receipt-group';
      group.textContent = WEEKDAY_NAMES[pd.weekday];
      frag.appendChild(group);

      for (const ex of exs) {
        total++;
        const isTime = ex.type === 'time';
        const best = bestLogFrom(await DB.getAllByIndex('logEntries', 'exerciseId', ex.id), isTime);
        if (best) recorded++;
        appendReceiptRow(frag, ex.name, best ? formatRecordValue(best, isTime) : '--');
      }
      if (rid !== _recordsRenderId) return;
    }

    if (total === 0) appendRecordsEmpty(frag, 'No exercises in your active plan yet.');
    else summaryText = `${recorded} of ${total} records`;
  }

  /* --- Divider + Section 2: isometric holds from the stopwatch --- */
  let logs = [];
  try { logs = await DB.getAll('stopwatch_logs'); } catch { logs = []; }
  if (rid !== _recordsRenderId) return;

  const divider = document.createElement('div');
  divider.className = 'receipt-divider';
  frag.appendChild(divider);

  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'receipt-section';
  sectionTitle.textContent = 'Isometric Holds';
  frag.appendChild(sectionTitle);

  const peaks = new Map();
  for (const l of logs) {
    const key = String(l.label || '').trim().toLowerCase();
    if (!key) continue;
    const cur = peaks.get(key);
    if (!cur
        || (l.duration || 0) > (cur.duration || 0)
        || ((l.duration || 0) === (cur.duration || 0) && l.isPR && !cur.isPR)) {
      peaks.set(key, l);
    }
  }
  const holds = [...peaks.values()].sort((a, b) => (b.duration || 0) - (a.duration || 0));

  if (holds.length === 0) {
    appendRecordsEmpty(frag, 'No timed holds saved yet.');
  } else {
    for (const peak of holds) {
      appendReceiptRow(frag, peak.label, fmtTimer(Math.round(peak.duration || 0)), 'hold-time');
    }
  }

  if (rid !== _recordsRenderId) return;
  body.replaceChildren(frag);
  if (summary) summary.textContent = summaryText;
}

function refreshRecords() {
  renderExerciseRecords().catch(() => {});
}

/* ================= STREAK: day-status engine =================
   Pure function of the log history (nothing to persist):
   - Weeks start on Sunday (same as the weekly bar and the calendar).
   - A day with a log = attended (or pr). Streak +1.
   - A day without a log = rest, unless there were already 2+ inactive
     days in the previous 6, then it is missed and the streak resets...
   - ...unless a recharge is available: max 1 per week, from a bank of 3.
     The bank refills to 3 when the previous week had 5+ logged days.
*/
const RECHARGE_BANK = 3;
const RECHARGE_REFILL_DAYS = 5;

function getWeekStartStr(dateStr) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return fmtDate(d);
}

async function computeDayStatuses(throughDateStr) {
  let logs;
  try {
    logs = await DB.getAll('logEntries');
  } catch (err) {
    console.error('[prx] Could not read logEntries:', err);
    return { statuses: {}, streak: 0, firstDate: null, rechargesRemaining: RECHARGE_BANK, rechargeUsedThisWeek: false };
  }
  if (logs.length === 0) {
    return { statuses: {}, streak: 0, firstDate: null, rechargesRemaining: RECHARGE_BANK, rechargeUsedThisWeek: false };
  }
  const byDate = {};
  logs.forEach(l => { (byDate[l.date] ||= []).push(l); });
  const firstDate = Object.keys(byDate).sort()[0];

  const statuses = {};
  const order = [];
  let streak = 0;
  let bank = RECHARGE_BANK;
  let weekStart = getWeekStartStr(firstDate);
  let usedThisWeek = false;
  let loggedDaysThisWeek = 0;

  let cursor = firstDate;
  while (cursor <= throughDateStr) {
    const ws = getWeekStartStr(cursor);
    if (ws !== weekStart) {
      if (loggedDaysThisWeek >= RECHARGE_REFILL_DAYS) bank = RECHARGE_BANK;
      weekStart = ws;
      usedThisWeek = false;
      loggedDaysThisWeek = 0;
    }

    const dayLogs = byDate[cursor];
    let status;
    if (dayLogs && dayLogs.length > 0) {
      status = dayLogs.some(l => l.isPR) ? 'pr' : 'attended';
      streak += 1;
      loggedDaysThisWeek += 1;
    } else if (cursor === throughDateStr) {
      status = 'pending';
    } else {
      let priorInactive = 0;
      for (let i = order.length - 1, seen = 0; i >= 0 && seen < 6; i--, seen++) {
        const s = statuses[order[i]];
        if (s === 'rest' || s === 'missed' || s === 'recharged') priorInactive++;
      }
      if (priorInactive < 2) {
        status = 'rest';
      } else if (!usedThisWeek && bank > 0) {
        status = 'recharged';
        usedThisWeek = true;
        bank -= 1;
        streak += 1;
      } else {
        status = 'missed';
        streak = 0;
      }
    }
    statuses[cursor] = status;
    order.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return {
    statuses, streak, firstDate,
    rechargesRemaining: bank,
    rechargeUsedThisWeek: weekStart === getWeekStartStr(throughDateStr) && usedThisWeek
  };
}

async function updateStreakPill() {
  const data = await computeDayStatuses(todayStr());
  document.getElementById('streakCount').textContent = data.streak;
}

/* ================= STREAK: weekly bar + month calendar ================= */
let calViewYear, calViewMonth;
function resetCalendarToCurrentMonth() {
  const now = new Date();
  calViewYear = now.getFullYear();
  calViewMonth = now.getMonth();
}

document.getElementById('calPrevBtn').addEventListener('click', () => {
  calViewMonth -= 1;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear -= 1; }
  renderStreak();
});
document.getElementById('calNextBtn').addEventListener('click', () => {
  const now = new Date();
  if (calViewYear === now.getFullYear() && calViewMonth === now.getMonth()) return;
  calViewMonth += 1;
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear += 1; }
  renderStreak();
});

async function renderStreak() {
  const today = new Date();
  const todayS = todayStr();
  const data = await computeDayStatuses(todayS);
  document.getElementById('streakCount').textContent = data.streak;

  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  const satEnd = new Date(sunday); satEnd.setDate(sunday.getDate()+6);
  document.getElementById('weekRangeLabel').textContent =
    `${MONTH_NAMES[sunday.getMonth()].slice(0,3)} ${sunday.getDate()} – ${MONTH_NAMES[satEnd.getMonth()].slice(0,3)} ${satEnd.getDate()}`;

  /* Weekday labels */
  const weekLabels = document.getElementById('weekLabels');
  weekLabels.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const span = document.createElement('span');
    span.textContent = WEEKDAY_SHORT[i];
    if (i === today.getDay()) span.className = 'is-today';
    weekLabels.appendChild(span);
  }

  /* Day nodes */
  const NODE_ICON = { attended: ICONS.check, pr: ICONS.star, recharged: ICONS.bolt, missed: ICONS.x, rest: ICONS.dash };
  const NODE_LABEL = {
    attended: 'attended', pr: 'personal record', recharged: 'recharged', missed: 'missed',
    rest: 'rest day', pending: 'no data', future: 'upcoming', 'today-pending': 'today, not logged yet'
  };
  const weekBar = document.getElementById('weekBar');
  weekBar.innerHTML = '';
  const pillBg = document.getElementById('pillBg');
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday); d.setDate(sunday.getDate() + i);
    const dS = fmtDate(d);
    let status;
    if (dS === todayS) {
      const s = data.statuses[dS];
      status = (s && s !== 'pending') ? s : 'today-pending';
    } else if (dS < todayS) {
      status = (data.firstDate && dS >= data.firstDate) ? data.statuses[dS] : 'pending';
    } else {
      status = 'future';
    }
    statuses.push(status);

    const node = document.createElement('div');
    node.className = `streak-node ${status}`;
    node.innerHTML = NODE_ICON[status] || '';
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', `${WEEKDAY_NAMES[i]}: ${NODE_LABEL[status] || status}`);
    weekBar.appendChild(node);
  }

  /* Pill = the streak run that reaches today (rest days inside don't break it) */
  const ACTIVE = new Set(['attended', 'pr', 'recharged']);
  const IN_RUN = new Set(['attended', 'pr', 'recharged', 'rest', 'today-pending']);
  const todayIdx = today.getDay();
  let end = -1;
  for (let i = todayIdx; i >= 0; i--) { if (ACTIVE.has(statuses[i])) { end = i; break; } }
  for (let i = end + 1; end >= 0 && i <= todayIdx; i++) { if (!IN_RUN.has(statuses[i])) end = -1; }
  let start = end;
  for (let i = end - 1; end >= 0 && i >= 0 && IN_RUN.has(statuses[i]); i--) {
    if (ACTIVE.has(statuses[i])) start = i;
  }
  const nodes = weekBar.children;
  if (end >= 0) {
    const pad = 4;
    const left = nodes[start].offsetLeft - pad;
    const width = nodes[end].offsetLeft + nodes[end].offsetWidth - nodes[start].offsetLeft + pad * 2;
    pillBg.style.left = `${left}px`;
    pillBg.style.width = `${width}px`;
  } else {
    pillBg.style.left = '50%';
    pillBg.style.width = '0';
  }
  pillBg.style.right = 'auto';

  /* Recharge icons in bottom row */
  const rechargeRow = document.getElementById('rechargeRow');
  rechargeRow.innerHTML = '';
  const total = 3;
  const remaining = data.rechargesRemaining ?? 3;
  const boltSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>`;
  for (let i = 0; i < total; i++) {
    const icon = document.createElement('div');
    const used = i >= remaining;
    icon.className = `recharge-icon ${used ? 'used' : 'available'}`;
    icon.innerHTML = boltSvg;
    rechargeRow.appendChild(icon);
  }

  /* Month calendar */
  document.getElementById('calMonthLabel').textContent = `${MONTH_NAMES[calViewMonth]} ${calViewYear}`;
  document.getElementById('calNextBtn').disabled =
    (calViewYear === today.getFullYear() && calViewMonth === today.getMonth());

  const grid = document.getElementById('monthGrid');
  grid.innerHTML = '';
  const firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  const firstWeekdaySun = firstOfMonth.getDay();
  for (let i = 0; i < firstWeekdaySun; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-cell blank';
    grid.appendChild(blank);
  }
  const daysInMonth = new Date(calViewYear, calViewMonth+1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(calViewYear, calViewMonth, day);
    const dS = fmtDate(d);
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (dS === todayS ? ' is-today' : '') + (dS > todayS ? ' is-future' : '');
    let dotHtml = '<div class="dot-slot"></div>';
    if (dS <= todayS && data.firstDate && dS >= data.firstDate) {
      const status = data.statuses[dS];
      const dotClass = { attended:'dot-blue', pr:'dot-yellow', rest:'dot-grey', missed:'dot-red', recharged:'dot-green' }[status];
      if (dotClass) dotHtml = `<span class="dot ${dotClass}"></span>`;
    }
    cell.innerHTML = `<span>${day}</span>${dotHtml}`;
    grid.appendChild(cell);
  }
}

/* ================= PLANS ================= */
function collapseAllPlans() {
  document.querySelectorAll('.plan-card').forEach(c => {
    c.classList.remove('is-expanded');
  });
}

async function renderPlanSwitcherCard() {
  const plan = await getActivePlan();
  const card = document.getElementById('planSwitcherCard');
  if (!plan) { card.hidden = true; return; }
  card.hidden = false;
  document.getElementById('planSwitcherName').textContent = plan.name;
}

function planBadgeHtml(isActive) {
  return isActive ? `${ICONS.check} Active` : 'Set active';
}

async function renderPlans() {
  const plans = await DB.getAll('plans');
  const list = document.getElementById('planList');
  list.innerHTML = '';
  if (plans.length === 0) {
    list.innerHTML = '<div class="plan-empty">No plans yet. Tap <span id="inlineNewPlanLink" class="text-link">New plan</span> to build your first split.</div>';
    return;
  }
  for (const p of plans) {
    const card = document.createElement('div');
    card.className = 'plan-card' + (p.isActive ? ' is-active' : '');
    card.dataset.planId = p.id;

    const head = document.createElement('div');
    head.className = 'plan-card-head';
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.innerHTML = `
      <span class="plan-card-name">${escapeHtml(p.name)}</span>
      <div class="plan-card-actions">
        <span class="plan-card-badge">${planBadgeHtml(p.isActive)}</span>
        <button class="icon-btn trash-btn" data-plan-id="${p.id}" aria-label="Delete plan ${escapeHtml(p.name)}">${ICONS.trash}</button>
      </div>
    `;
    head.addEventListener('click', () => togglePlanCard(p, card, plans));
    head.addEventListener('keydown', e => {
      if (e.target === head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); togglePlanCard(p, card, plans); }
    });
    head.querySelector('.trash-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirm('Delete plan?', `"${p.name}" and all its splits and exercises will be removed. Logged history stays intact.`, async () => {
        await deletePlanCascade(p.id);
        collapseAllPlans();
        await renderPlans();
        await renderPlanSwitcherCard();
        renderToday();
        refreshRecords();
      });
    });
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'plan-card-body';
    card.appendChild(body);

    list.appendChild(card);
  }
}

async function togglePlanCard(p, card, plans) {
  if (!p.isActive) {
    /* Activate this plan */
    const deactivatePromises = plans
      .filter(other => other.isActive && other.id !== p.id)
      .map(other => { other.isActive = false; return DB.put('plans', other); });
    await Promise.all(deactivatePromises);
    p.isActive = true;
    await DB.put('plans', p);

    document.querySelectorAll('.plan-card').forEach(c => {
      c.classList.remove('is-active');
      const badge = c.querySelector('.plan-card-badge');
      if (badge) badge.innerHTML = planBadgeHtml(false);
    });
    card.classList.add('is-active');
    const badge = card.querySelector('.plan-card-badge');
    if (badge) badge.innerHTML = planBadgeHtml(true);
    showSnackbar(`${p.name} is now your active plan`);

    await renderPlanSwitcherCard();
    renderToday();
    refreshRecords();
  }

  /* Toggle expansion */
  const wasExpanded = card.classList.contains('is-expanded');
  collapseAllPlans();
  if (!wasExpanded) {
    card.classList.add('is-expanded');
    await renderPlanCardEditor(p, card);
  }
}

async function renderPlanCardEditor(plan, card) {
  const body = card.querySelector('.plan-card-body');
  body.innerHTML = '';

  const planDays = await DB.getAllByIndex('planDays', 'planId', plan.id);
  const grid = document.createElement('div');
  grid.className = 'weekday-grid';
  for (let w = 0; w < 7; w++) {
    const day = planDays.find(pd => pd.weekday === w);
    const cell = document.createElement('button');
    cell.className = 'weekday-cell' + (day ? ' has-exercises' : '');
    cell.textContent = WEEKDAY_SHORT[w];
    cell.setAttribute('aria-label', `${WEEKDAY_NAMES[w]}${day ? ': ' + day.label : ''}`);
    cell.addEventListener('click', () => openDayEditorInline(plan, w, body));
    grid.appendChild(cell);
  }
  body.appendChild(grid);

  const hint = document.createElement('div');
  hint.className = 'plan-hint';
  hint.textContent = 'Tap a day to set its split and exercises';
  body.appendChild(hint);
}

function markSelectedWeekday(container, weekday) {
  container.querySelectorAll('.weekday-cell').forEach((c, w) => {
    c.classList.toggle('is-selected', w === weekday);
    c.setAttribute('aria-pressed', w === weekday ? 'true' : 'false');
  });
}

async function openDayEditorInline(plan, weekday, container) {
  /* Always re-read: the grid can be stale right after a split is created */
  const planDays = await DB.getAllByIndex('planDays', 'planId', plan.id);
  const day = planDays.find(pd => pd.weekday === weekday);
  markSelectedWeekday(container, weekday);
  if (day) {
    renderDayExerciseEditorInline(day, plan, container);
    return;
  }
  container.querySelectorAll('.day-exercise-editor').forEach(n => n.remove());
  openPrompt(`Split for ${WEEKDAY_NAMES[weekday]}`, 'e.g. Push day', async (label) => {
    if (!label) return;
    const id = await DB.add('planDays', { planId: plan.id, weekday, label });
    const cell = container.querySelectorAll('.weekday-cell')[weekday];
    if (cell) cell.classList.add('has-exercises');
    renderDayExerciseEditorInline({ id, planId: plan.id, weekday, label }, plan, container);
  });
}

async function renderDayExerciseEditorInline(day, plan, container) {
  let exercises = await DB.getAllByIndex('exercises', 'planDayId', day.id);
  exercises = exercises.sort((a,b) => (a.order||0) - (b.order||0));

  /* Remove any existing day editor in this container */
  container.querySelectorAll('.day-exercise-editor').forEach(n => n.remove());
  markSelectedWeekday(container, day.weekday);

  const count = exercises.length;
  const box = document.createElement('div');
  box.className = 'day-exercise-editor';
  box.innerHTML = `
    <div class="day-editor-head">
      <div>
        <div class="day-editor-title">${escapeHtml(day.label)}</div>
        <div class="day-editor-sub">${count} exercise${count === 1 ? '' : 's'} on ${WEEKDAY_NAMES[day.weekday]}</div>
      </div>
      <button class="icon-btn danger delete-day-split-btn" aria-label="Delete this split">${ICONS.trash}</button>
    </div>`;

  const rowsWrap = document.createElement('div');
  rowsWrap.className = 'day-exercise-rows';
  exercises.forEach(ex => rowsWrap.appendChild(buildExerciseRow(ex, day, plan, rowsWrap)));
  box.appendChild(rowsWrap);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-text add-ex-btn';
  addBtn.innerHTML = `${ICONS.plus} Add exercise`;
  addBtn.addEventListener('click', () => {
    openPrompt('Exercise name', 'e.g. Bench press', async (name) => {
      if (!name) return;
      const current = await DB.getAllByIndex('exercises', 'planDayId', day.id);
      const maxOrder = Math.max(-1, ...current.map(e => e.order || 0));
      await DB.add('exercises', { planDayId: day.id, name, targetReps: 8, targetSets: 3, order: maxOrder + 1 });
      renderDayExerciseEditorInline(day, plan, container);
      refreshRecords();
    });
  });
  box.appendChild(addBtn);

  container.appendChild(box);

  box.querySelector('.delete-day-split-btn').addEventListener('click', () => {
    openConfirm('Delete this split?', `"${day.label}" and its exercises will be removed from ${WEEKDAY_NAMES[day.weekday]}.`, async () => {
      const current = await DB.getAllByIndex('exercises', 'planDayId', day.id);
      for (const ex of current) await DB.delete('exercises', ex.id);
      await DB.delete('planDays', day.id);
      renderPlanCardEditor(plan, container.closest('.plan-card'));
      refreshRecords();
    });
  });
}

async function deletePlanCascade(planId) {
  const planDays = await DB.getAllByIndex('planDays', 'planId', planId);
  for (const day of planDays) {
    const exercises = await DB.getAllByIndex('exercises', 'planDayId', day.id);
    for (const ex of exercises) await DB.delete('exercises', ex.id);
    await DB.delete('planDays', day.id);
  }
  await DB.delete('plans', planId);
}

document.getElementById('newPlanBtn').addEventListener('click', () => {
  openPrompt('New plan', 'e.g. Push Pull Legs', async (name) => {
    if (!name) return;
    const plans = await DB.getAll('plans');
    const isFirst = plans.length === 0;
    await DB.add('plans', { name, isActive: isFirst });
    await renderPlans();
    await renderPlanSwitcherCard();
    refreshRecords();
  });
});

/* Empty-state CTA on Today tab → switch to Plans and open new-plan prompt */
function promptNewPlan() {
  switchView('plans');
  setTimeout(() => {
    openPrompt('New plan', 'e.g. Push Pull Legs', async (name) => {
      if (!name) return;
      const plans = await DB.getAll('plans');
      const isFirst = plans.length === 0;
      await DB.add('plans', { name, isActive: isFirst });
      await renderPlans();
      await renderPlanSwitcherCard();
      refreshRecords();
    });
  }, 150);
}
document.getElementById('emptyTodayCta').addEventListener('click', promptNewPlan);

/* Inline "New plan" link inside the Plans empty-state bubble */
document.getElementById('planList').addEventListener('click', (e) => {
  if (e.target && e.target.id === 'inlineNewPlanLink') {
    openPrompt('New plan', 'e.g. Push Pull Legs', async (name) => {
      if (!name) return;
      const plans = await DB.getAll('plans');
      const isFirst = plans.length === 0;
      await DB.add('plans', { name, isActive: isFirst });
      await renderPlans();
      await renderPlanSwitcherCard();
      refreshRecords();
    });
  }
});

let currentEditingPlan = null;

function buildExerciseRow(ex, day, plan, wrap) {
  const row = document.createElement('div');
  row.className = 'day-exercise-row';
  row.dataset.exId = ex.id;
  row.innerHTML = `
    <div class="day-exercise-row-main">
      <span class="drag-handle" aria-hidden="true">${ICONS.grip}</span>
      <span class="ex-row-name">${escapeHtml(ex.name)}</span>
      <span class="ex-row-meta">${ex.targetSets} &times; ${ex.type === 'time' ? fmtDuration(ex.targetReps) : ex.targetReps}</span>
    </div>
    <div class="day-exercise-row-actions">
      <button class="icon-btn edit-pencil" aria-label="Edit ${escapeHtml(ex.name)}">${ICONS.pencil}</button>
      <button class="icon-btn remove-x" aria-label="Remove ${escapeHtml(ex.name)}">${ICONS.x}</button>
    </div>
  `;
  row.querySelector('.edit-pencil').addEventListener('click', (e) => {
    e.stopPropagation();
    openExerciseEditSheet(ex, day, plan);
  });
  row.querySelector('.remove-x').addEventListener('click', (e) => {
    e.stopPropagation();
    openConfirm('Remove exercise?', `"${ex.name}" will be removed from this split.`, async () => {
      await DB.delete('exercises', ex.id);
      const container = row.closest('.plan-card-body');
      if (container) renderDayExerciseEditorInline(day, plan, container);
      refreshRecords();
    });
  });
  attachDragReorder(row, wrap);
  return row;
}

function attachDragReorder(row, wrap) {
  const handle = row.querySelector('.drag-handle');
  let startY = 0, dragging = false;

  const onMove = (clientY) => {
    if (!dragging) return;
    const before = row.offsetTop;
    const siblings = [...wrap.children].filter(c => c !== row);
    const next = siblings.find(sib => {
      const r = sib.getBoundingClientRect();
      return clientY < r.top + r.height / 2;
    });
    if (next) { if (row.nextElementSibling !== next) wrap.insertBefore(row, next); }
    else if (wrap.lastElementChild !== row) wrap.appendChild(row);
    startY += row.offsetTop - before;           // keep the row under the finger after a swap
    row.style.transform = `translateY(${clientY - startY}px)`;
  };
  const onMouseMove = (e) => onMove(e.clientY);
  const onEnd = async () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onEnd);
    row.classList.remove('dragging');
    row.style.transform = '';
    const ids = [...wrap.children].map(c => Number(c.dataset.exId));
    for (let i = 0; i < ids.length; i++) {
      const exRecord = await DB.get('exercises', ids[i]);
      if (exRecord && exRecord.order !== i) {
        exRecord.order = i;
        await DB.put('exercises', exRecord);
      }
    }
    refreshRecords();
  };
  const begin = (y) => { dragging = true; startY = y; row.classList.add('dragging'); vibrate(10); };

  handle.addEventListener('touchstart', e => begin(e.touches[0].clientY), { passive: true });
  handle.addEventListener('touchmove', e => onMove(e.touches[0].clientY), { passive: true });
  handle.addEventListener('touchend', onEnd);
  handle.addEventListener('touchcancel', onEnd);
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    begin(e.clientY);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);
  });
}

function openExerciseEditSheet(ex, day, plan) {
  const nameEl = document.getElementById('editExName');
  const repsEl = document.getElementById('editExReps');
  const setsEl = document.getElementById('editExSets');
  const typeEl = document.getElementById('editExType');
  nameEl.value = ex.name;
  repsEl.value = ex.targetReps;
  setsEl.value = ex.targetSets;
  typeEl.value = ex.type || 'reps';
  const isTime = typeEl.value === 'time';
  document.getElementById('editExRepsLabel').textContent = isTime ? 'Target duration (seconds)' : 'Target reps';
  [nameEl, repsEl, setsEl].forEach(el => el.classList.remove('invalid'));
  showSheet('editExSheet');
  document.getElementById('editExSaveBtn').onclick = async () => {
    const name = nameEl.value.trim();
    const reps = Math.round(Number(repsEl.value));
    const sets = Math.round(Number(setsEl.value));
    const type = typeEl.value;
    const badName = !name, badReps = !(reps >= 1 && reps <= 7200), badSets = !(sets >= 1 && sets <= 20);
    nameEl.classList.toggle('invalid', badName);
    repsEl.classList.toggle('invalid', badReps);
    setsEl.classList.toggle('invalid', badSets);
    if (badName || badReps || badSets) return;

    const fresh = (await DB.get('exercises', ex.id)) || ex;   // keeps the latest order
    Object.assign(fresh, { name, targetReps: reps, targetSets: sets, type });
    Object.assign(ex, fresh);
    await DB.put('exercises', fresh);
    hideSheet('editExSheet');
    const container = document.querySelector('.plan-card.is-expanded .plan-card-body');
    if (container) renderDayExerciseEditorInline(day, plan, container);
    refreshRecords();
  };
}

/* ================= BACKUP / RESTORE ================= */
async function exportAllData() {
  const stores = ['plans', 'planDays', 'exercises', 'logEntries', 'profileStore'];
  const dump = {};
  for (const storeName of stores) {
    dump[storeName] = await DB.getAll(storeName);
  }
  dump._exported = new Date().toISOString();
  dump._version = 1;
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prx-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showSnackbar('Data exported');
}

async function importData(json) {
  const stores = ['plans', 'planDays', 'exercises', 'logEntries', 'profileStore'];
  let imported = 0;
  for (const storeName of stores) {
    const records = json[storeName];
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      await DB.put(storeName, record);
      imported++;
    }
  }
  showSnackbar(`Imported ${imported} records`);
  collapseAllPlans();
  await renderPlans();
  await renderPlanSwitcherCard();
  renderNutritionCard().catch(() => {});
  refreshRecords();
  renderToday();
  updateStreakPill();
  renderStreak();
  renderGreeting();
}

document.getElementById('importFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const json = JSON.parse(ev.target.result);
      if (!json._version && !json.plans && !json.logEntries) {
        showSnackbar('Invalid backup file');
        return;
      }
      openConfirm(
        'Import data?',
        'This will merge the backup into your existing data. Existing records with the same ID will be overwritten.',
        async () => { await importData(json); }
      );
    } catch {
      showSnackbar('Could not parse backup file');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ================= TIMER / STOPWATCH ================= */
let timerRunning = false;
let timerElapsed = 0;
let timerInterval = null;

function fmtTimer(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function updateTimerDisplay() {
  const display = document.getElementById('timerDisplay');
  const formatted = fmtTimer(timerElapsed);
  if (display) {
    display.textContent = formatted;
    display.className = 'timer-display' + (timerRunning ? ' running' : (timerElapsed > 0 ? ' paused' : ''));
  }
}

function timerStart() {
  if (timerRunning) return;
  timerRunning = true;
  timerInterval = setInterval(() => { timerElapsed++; updateTimerDisplay(); }, 1000);
  document.getElementById('timerStartBtn').textContent = 'Pause';
  setTimerSaveBar(false);
  updateTimerDisplay();
}

function timerPause() {
  if (!timerRunning) return;
  timerRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;
  document.getElementById('timerStartBtn').textContent = 'Resume';
  updateTimerDisplay();
  if (timerElapsed > 0) setTimerSaveBar(true);
}

function timerReset() {
  timerRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;
  timerElapsed = 0;
  document.getElementById('timerStartBtn').textContent = 'Start';
  setTimerSaveBar(false, true);
  updateTimerDisplay();
}

function setTimerSaveBar(show, clearInput) {
  const bar = document.getElementById('timerSaveBar');
  const input = document.getElementById('timerLabelInput');
  if (!bar) return;
  bar.hidden = !show;
  if (clearInput && input) {
    input.value = '';
    input.classList.remove('invalid');
  }
}

let _stopwatchSaveInFlight = false;
async function saveStopwatchLog() {
  if (_stopwatchSaveInFlight || timerRunning || timerElapsed < 1) return;
  const input = document.getElementById('timerLabelInput');
  const label = input.value.trim();
  if (!label) {
    input.classList.add('invalid');
    input.focus();
    showSnackbar('Add a label for this hold.');
    return;
  }
  input.classList.remove('invalid');
  _stopwatchSaveInFlight = true;
  try {
    const duration = timerElapsed;
    const logs = await DB.getAll('stopwatch_logs');
    const key = label.toLowerCase();
    const prevMax = Math.max(0, ...logs.filter(l => (l.label || '').toLowerCase() === key).map(l => l.duration || 0));
    const isPR = duration > prevMax;
    await DB.add('stopwatch_logs', { duration, ts: Date.now(), label, isPR });
    vibrate(isPR ? [30, 50, 30] : [30]);
    timerReset();
    showSnackbar(isPR ? 'Saved. New PR recorded.' : `Saved ${label}`, isPR ? 'pr' : '');
    refreshRecords();
  } finally {
    _stopwatchSaveInFlight = false;
  }
}
document.getElementById('timerSaveBtn').addEventListener('click', saveStopwatchLog);
document.getElementById('timerLabelInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); saveStopwatchLog(); }
});
document.getElementById('timerLabelInput').addEventListener('input', (e) => {
  e.target.classList.remove('invalid');
});

/* ================= NAVIGATION DRAWER ================= */
function openDrawer() {
  document.getElementById('navDrawer').classList.add('show');
  document.getElementById('drawerBackdrop').classList.add('show');
  const timerDisplay = document.getElementById('timerDisplay');
  const drawerTimerMeta = document.getElementById('drawerTimerMeta');
  if (timerDisplay && drawerTimerMeta) drawerTimerMeta.textContent = timerDisplay.textContent;
}
function closeDrawer() {
  document.getElementById('navDrawer').classList.remove('show');
  document.getElementById('drawerBackdrop').classList.remove('show');
}

document.getElementById('menuBtn').addEventListener('click', openDrawer);
document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);

document.getElementById('drawerProfile').addEventListener('click', () => { closeDrawer(); setTimeout(openProfileSheet, 150); });
document.getElementById('drawerTimer').addEventListener('click', () => { closeDrawer(); setTimeout(() => showSheet('timerSheet'), 150); });
document.getElementById('drawerMacro').addEventListener('click', () => {
  closeDrawer();
  setTimeout(() => {
    showSheet('macroSheet');
    renderNutritionCard().catch(() => {});
  }, 150);
});
document.getElementById('drawerBackup').addEventListener('click', () => { closeDrawer(); setTimeout(() => showSheet('backupSheet'), 150); });
document.getElementById('drawerAbout').addEventListener('click', () => { closeDrawer(); setTimeout(() => showSheet('aboutSheet'), 150); });

/* Backup dialog buttons reuse existing export/import functions */
document.getElementById('drawerExportBtn').addEventListener('click', () => { hideSheet('backupSheet'); exportAllData(); });
document.getElementById('drawerImportBtn').addEventListener('click', () => { hideSheet('backupSheet'); document.getElementById('importFileInput').click(); });
document.getElementById('backupCloseBtn').addEventListener('click', () => hideSheet('backupSheet'));
document.getElementById('timerStartBtn').addEventListener('click', () => {
  if (timerRunning) { timerPause(); } else { timerStart(); }
});
document.getElementById('timerResetBtn').addEventListener('click', timerReset);

/* ================= DAY SPLIT OVERRIDE (daily swap) ================= */
const DAY_SWAP_KEY = 'prx_day_swaps';

function getDaySwaps() {
  try { return JSON.parse(localStorage.getItem(DAY_SWAP_KEY) || '{}'); } catch { return {}; }
}
function setDaySwap(dateStr, planDayId) {
  const swaps = getDaySwaps();
  if (planDayId == null) delete swaps[dateStr];
  else swaps[dateStr] = planDayId;
  localStorage.setItem(DAY_SWAP_KEY, JSON.stringify(swaps));
}
/* Today's override planDay if it still belongs to the active plan; drops stale ids. */
function resolveDaySwap(planDays) {
  const swapId = getDaySwaps()[todayStr()];
  if (swapId == null) return null;
  const found = planDays.find(pd => pd.id === Number(swapId));
  if (!found) { setDaySwap(todayStr(), null); return null; }
  return found;
}

async function openSwapSheet() {
  const container = document.getElementById('swapDayList');
  container.innerHTML = '';
  const plan = await getActivePlan();
  if (!plan) {
    container.innerHTML = '<div class="plan-empty">No active plan</div>';
    showSheet('swapSheet');
    return;
  }
  const planDays = await DB.getAllByIndex('planDays', 'planId', plan.id);
  if (planDays.length === 0) {
    container.innerHTML = '<div class="plan-empty">No splits in this plan yet</div>';
    showSheet('swapSheet');
    return;
  }

  const defaultDay = planDays.find(pd => pd.weekday === new Date().getDay());
  const current = resolveDaySwap(planDays) || defaultDay;   // what the status bar shows
  const choices = planDays
    .filter(pd => !current || pd.id !== current.id)
    .sort((a, b) => a.weekday - b.weekday);

  for (const pd of choices) {
    const item = document.createElement('div');
    item.className = 'swap-item';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    const initial = ((pd.label || '?').trim()[0] || '?').toUpperCase();
    item.innerHTML = `
      <div class="swap-item-avatar">${escapeHtml(initial)}</div>
      <div class="swap-item-name">${escapeHtml(pd.label || 'Session')}</div>
      <div class="swap-item-meta">${WEEKDAY_NAMES[pd.weekday]}</div>`;
    const pick = () => applyDaySwap(pd, !!defaultDay && pd.id === defaultDay.id);
    item.addEventListener('click', pick);
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    container.appendChild(item);
  }
  if (choices.length === 0) {
    container.innerHTML = '<div class="plan-empty">This is the only split in your plan</div>';
  }
  showSheet('swapSheet');
}

function applyDaySwap(planDay, isDefault) {
  setDaySwap(todayStr(), isDefault ? null : planDay.id);
  hideSheet('swapSheet');
  showSnackbar(isDefault ? 'Reverted to the default split' : `${planDay.label || 'Session'} set for today`);
  renderToday();
}

function revertDaySwap() {
  setDaySwap(todayStr(), null);
  showSnackbar('Reverted to the default split');
  renderToday();
}

/* Status bar: swap + revert are delegated so they survive re-renders */
document.getElementById('todayStatusBar').addEventListener('click', (e) => {
  if (e.target.closest('.split-swap-btn')) openSwapSheet();
  else if (e.target.closest('.revert-split-chip')) revertDaySwap();
});

/* ================= ABOUT DIALOG ================= */
document.getElementById('aboutCloseBtn').addEventListener('click', () => hideSheet('aboutSheet'));

/* ================= EXERCISE TYPE TOGGLE (edit sheet) ================= */
document.getElementById('editExType').addEventListener('change', (e) => {
  const isTime = e.target.value === 'time';
  document.getElementById('editExRepsLabel').textContent = isTime ? 'Target duration (seconds)' : 'Target reps';
  document.getElementById('editExReps').placeholder = isTime ? 'e.g. 90' : '';
});

/* ================= Init ================= */
(async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try {
    resetCalendarToCurrentMonth();
    await updateStreakPill();
    await renderStreak();
    await renderGreeting();
    refreshRecords();
  } catch (err) {
    console.error('[prx] init failed:', err);
  }
})();
