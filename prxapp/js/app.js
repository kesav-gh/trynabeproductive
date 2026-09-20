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
  grip:   '<svg viewBox="0 0 24 24"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>'
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
  if (name === 'plans') { collapseAllPlans(); renderPlans(); renderPlanSwitcherCard(); renderNutritionCard().catch(()=>{}); }
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
  const day = planDays.find(pd => pd.weekday === now.getDay());
  if (!day) {
    setStatus(`<span class="today-chip rest">${ICONS.moon} Rest day</span>`);
    showEmpty('Rest day', `${plan.name} has nothing on ${dayName}s. Recover, or add a split in Plans.`);
    return;
  }
  setStatus(`<span class="today-chip">${escapeHtml(day.label || 'Session')}</span>`);

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
    const logs = await DB.getAllByIndex('logEntries', 'exerciseId', ex.id);
    const last = logs.sort((a,b) => b.ts - a.ts)[0];
    const doneToday = logs.some(l => l.date === today);
    const initial = escapeHtml((ex.name.trim()[0] || '?').toUpperCase());
    const card = document.createElement('div');
    card.className = 'exercise-card' + (doneToday ? ' logged-today' : '');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="exercise-avatar">${doneToday ? ICONS.check : initial}</div>
      <div class="exercise-main">
        <div class="exercise-name">${escapeHtml(ex.name)}</div>
        <div class="exercise-meta">${ex.targetSets} × ${ex.targetReps} target</div>
      </div>
      <div class="exercise-lastlog${last ? '' : ' muted'}">
        <span class="ll-num">${!last ? '--' : (last.weight > 0 ? last.weight : 'BW')}</span>
        <span class="ll-lbl">${!last ? 'no log' : (last.weight > 0 ? 'kg last' : 'bodyweight')}</span>
      </div>`;
    card.addEventListener('click', () => openLogSheet(ex, last));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLogSheet(ex, last); } });
    cards.push(card);
  }
  if (rid !== _todayRenderId) return;
  empty.hidden = true;
  list.replaceChildren(...cards);
}

/* ---------- Log sheet ---------- */
let currentExercise = null;
let currentLastLog = null;
let adjustState = { weight: 0, reps: 0, sets: 0 };
const ADJUST_LIMITS = { weight: [0, 500], reps: [1, 100], sets: [1, 20] };
const WEIGHT_STEP = 2.5;     // kg per ruler tick and per −/+ tap
const WEIGHT_TICK_PX = 24;   // must match the 24px tick spacing in .ruler (css/style.css)

function clampField(field, v) {
  const [lo, hi] = ADJUST_LIMITS[field];
  return Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
}
function fmtKg(n) { return String(Math.round(n * 100) / 100); }

function openLogSheet(ex, last) {
  currentExercise = ex;
  currentLastLog = last || null;
  adjustState.weight = last ? last.weight : 0;
  adjustState.reps = clampField('reps', last ? last.reps : ex.targetReps);
  adjustState.sets = clampField('sets', last ? last.sets : ex.targetSets);
  document.getElementById('logSheetTitle').textContent = ex.name;
  updateAdjustDisplay();
  showSheet('logSheet');
}

function updateAdjustDisplay() {
  const w = adjustState.weight;
  const input = document.getElementById('weightInput');
  if (document.activeElement !== input) input.value = fmtKg(w);
  document.getElementById('repsValue').textContent = adjustState.reps;
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
  let holdTimer = null, repeatTimer = null;
  const bump = () => {
    const wi = document.getElementById('weightInput');
    if (document.activeElement === wi) wi.blur();
    const next = clampField(field, adjustState[field] + step);
    if (next === adjustState[field]) return;
    adjustState[field] = next;
    vibrate(8);
    updateAdjustDisplay();
  };
  const stop = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); };
  btn.addEventListener('pointerdown', () => {
    bump();
    stop();
    holdTimer = setTimeout(() => { repeatTimer = setInterval(bump, 90); }, 400);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
  btn.addEventListener('click', e => { if (e.detail === 0) bump(); }); // keyboard activation
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

async function checkIsPR(exerciseId, weight, reps) {
  const logs = await DB.getAllByIndex('logEntries', 'exerciseId', exerciseId);
  if (logs.length === 0) return true;                 // first ever log counts as the baseline PR
  const maxWeight = Math.max(...logs.map(l => l.weight));
  if (weight > maxWeight) return true;
  if (weight < maxWeight) return false;
  const bestRepsAtMax = Math.max(0, ...logs.filter(l => l.weight === maxWeight).map(l => l.reps));
  return reps > bestRepsAtMax;                        // strictly more reps; a tie is not a PR
}

let _logInFlight = false;
document.getElementById('confirmLogBtn').addEventListener('click', async () => {
  if (!currentExercise || _logInFlight) return;
  const wi = document.getElementById('weightInput');
  if (document.activeElement === wi) wi.blur();   // commits a typed value
  if (adjustState.reps < 1 || adjustState.sets < 1) {
    showSnackbar('Reps and sets need to be at least 1.');
    return;
  }
  _logInFlight = true;
  try {
    const ex = currentExercise;
    const isPR = await checkIsPR(ex.id, adjustState.weight, adjustState.reps);
    await DB.add('logEntries', {
      exerciseId: ex.id, date: todayStr(),
      reps: adjustState.reps, sets: adjustState.sets, weight: adjustState.weight,
      isPR, ts: Date.now()
    });
    vibrate(isPR ? [30,50,30] : [30]);
    hideSheet('logSheet');
    showSnackbar(
      isPR ? `New PR on ${ex.name}: ${fmtKg(adjustState.weight)} kg × ${adjustState.reps}`
           : `Logged ${ex.name}`,
      isPR ? 'pr' : ''
    );
    renderToday();
    updateStreakPill();
  } finally {
    _logInFlight = false;
  }
});

/* ---------- Sheets ---------- */
const SHEET_BACKDROPS = { logSheet:'logSheetBackdrop', promptSheet:'promptBackdrop', confirmSheet:'confirmBackdrop', editExSheet:'editExBackdrop', profileSheet:'profileBackdrop' };
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
async function getProfile() {
  return await DB.get('profileStore', 1);
}
async function openProfileSheet() {
  const p = await getProfile();
  if (p) {
    document.getElementById('pfName').value = p.name || '';
    document.getElementById('pfWeight').value = p.weight;
    document.getElementById('pfHeight').value = p.height;
    document.getElementById('pfAge').value = p.age;
    document.getElementById('pfGender').value = p.gender;
    document.getElementById('pfActivity').value = p.activityLevel;
  }
  PROFILE_FIELDS.forEach(([id]) => document.getElementById(id).classList.remove('invalid'));
  showSheet('profileSheet');
}
document.getElementById('profileBtn').addEventListener('click', openProfileSheet);
document.getElementById('setupProfileBtn').addEventListener('click', openProfileSheet);
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
  hideSheet('profileSheet');
  showSnackbar('Profile saved');
  renderNutritionCard();
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
function toggleNutrition() {
  const body = document.getElementById('nutritionBody');
  const chevron = document.getElementById('nutritionChevron');
  const head = document.getElementById('nutritionToggle');
  body.hidden = !body.hidden;
  chevron.classList.toggle('expanded', !body.hidden);
  head.setAttribute('aria-expanded', String(!body.hidden));
  if (!body.hidden) renderNutritionCard().catch(() => {});
}
document.getElementById('nutritionToggle').addEventListener('click', toggleNutrition);
document.getElementById('nutritionToggle').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNutrition(); }
});

function calcBMR(profile) {
  const { weight, height, age, gender } = profile;
  const male = 10*weight + 6.25*height - 5*age + 5;
  const female = 10*weight + 6.25*height - 5*age - 161;
  if (gender === 'male') return male;
  if (gender === 'female') return female;
  return (male + female) / 2;
}

const PRESET_CONFIG = {
  aggressive: { pct: 0.20, proteinPerKg: 1.8, label: 'Aggressive Bulk' },
  clean:      { pct: 0.10, proteinPerKg: 1.8, label: 'Clean Bulk' },
  recomp:     { pct: 0.00, proteinPerKg: 2.0, label: 'Recomp' },
  cut:        { pct: -0.20, proteinPerKg: 2.2, label: 'Cut' }
};

let activePreset = 'clean';

function computeMacros(profile, presetKey) {
  const bmr = calcBMR(profile);
  const tdee = bmr * profile.activityLevel;
  const cfg = PRESET_CONFIG[presetKey];
  const calories = Math.round(tdee * (1 + cfg.pct));
  const proteinG = Math.round(profile.weight * cfg.proteinPerKg);
  const fatG = Math.round((calories * 0.25) / 9);
  const carbsG = Math.max(0, Math.round((calories - proteinG*4 - fatG*9) / 4));
  return { calories, proteinG, fatG, carbsG, tdee };
}

function renderMacrosForPreset(profile, presetKey) {
  const m = computeMacros(profile, presetKey);
  const cal = document.getElementById('macroCal');
  const pro = document.getElementById('macroProtein');
  const carb = document.getElementById('macroCarbs');
  const fat = document.getElementById('macroFat');
  if (cal) cal.textContent = m.calories.toLocaleString();
  if (pro) pro.textContent = m.proteinG + 'g';
  if (carb) carb.textContent = m.carbsG + 'g';
  if (fat) fat.textContent = m.fatG + 'g';
}

/* Preset button handlers — attached once, not on every render */
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activePreset = btn.dataset.preset;
    getProfile().then(profile => {
      if (profile) renderMacrosForPreset(profile, activePreset);
    });
  });
});

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
  const m = computeMacros(profile, activePreset);
  const nutritionHead = document.getElementById('nutritionToggle');
  if (nutritionHead) {
    const summarySpan = nutritionHead.querySelector('.nutrition-summary');
    if (summarySpan) {
      summarySpan.textContent = `${m.calories.toLocaleString()} kcal a day, BMI ${bmi.toFixed(1)}`;
    }
  }

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

  renderMacrosForPreset(profile, activePreset);

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === activePreset);
  });

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
  const logs = await DB.getAll('logEntries');
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
      <span class="ex-row-meta">${ex.targetSets} × ${ex.targetReps}</span>
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
  nameEl.value = ex.name;
  repsEl.value = ex.targetReps;
  setsEl.value = ex.targetSets;
  [nameEl, repsEl, setsEl].forEach(el => el.classList.remove('invalid'));
  showSheet('editExSheet');
  document.getElementById('editExSaveBtn').onclick = async () => {
    const name = nameEl.value.trim();
    const reps = Math.round(Number(repsEl.value));
    const sets = Math.round(Number(setsEl.value));
    const badName = !name, badReps = !(reps >= 1 && reps <= 100), badSets = !(sets >= 1 && sets <= 20);
    nameEl.classList.toggle('invalid', badName);
    repsEl.classList.toggle('invalid', badReps);
    setsEl.classList.toggle('invalid', badSets);
    if (badName || badReps || badSets) return;

    const fresh = (await DB.get('exercises', ex.id)) || ex;   // keeps the latest order
    Object.assign(fresh, { name, targetReps: reps, targetSets: sets });
    Object.assign(ex, fresh);
    await DB.put('exercises', fresh);
    hideSheet('editExSheet');
    const container = document.querySelector('.plan-card.is-expanded .plan-card-body');
    if (container) renderDayExerciseEditorInline(day, plan, container);
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
  renderToday();
  updateStreakPill();
  renderStreak();
  renderGreeting();
}

document.getElementById('exportDataBtn').addEventListener('click', exportAllData);
document.getElementById('importDataBtn').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});
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

/* ================= Init ================= */
(async function init() {
  resetCalendarToCurrentMonth();
  await updateStreakPill();
  renderStreak();
  renderGreeting();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
