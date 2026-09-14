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

/* ---------- View routing ---------- */
document.querySelectorAll('.dock-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
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

async function renderToday() {
  const now = new Date();
  const dayName = WEEKDAY_NAMES[now.getDay()].toUpperCase();
  const statusBar = document.getElementById('todayStatusBar');
  const plan = await getActivePlan();
  const list = document.getElementById('exerciseList');
  const empty = document.getElementById('emptyToday');
  list.innerHTML = '';

  if (!plan) {
    statusBar.textContent = dayName;
    empty.hidden = false;
    return;
  }
  const planDays = await DB.getAllByIndex('planDays', 'planId', plan.id);
  const day = planDays.find(pd => pd.weekday === now.getDay());
  if (!day) {
    statusBar.textContent = dayName + ' ➔ Rest Day';
    empty.hidden = false;
    return;
  }
  statusBar.textContent = dayName + ' ➔ ' + (day.label || 'Session').toUpperCase();

  let exercises = await DB.getAllByIndex('exercises', 'planDayId', day.id);
  exercises = exercises.sort((a,b) => (a.order||0) - (b.order||0));
  if (exercises.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  for (const ex of exercises) {
    const logs = await DB.getAllByIndex('logEntries', 'exerciseId', ex.id);
    const last = logs.sort((a,b) => b.ts - a.ts)[0];
    const card = document.createElement('div');
    card.className = 'exercise-card';
    card.innerHTML = `
      <div>
        <div class="exercise-name">${escapeHtml(ex.name)}</div>
        <div class="exercise-meta">target ${ex.targetSets}×${ex.targetReps}</div>
      </div>
      <div class="exercise-lastlog${last ? '' : ' muted'}">${last ? last.weight + 'kg' : '--'}</div>
    `;
    card.addEventListener('click', () => openLogSheet(ex, last));
    list.appendChild(card);
  }
}

/* ---------- Log sheet ---------- */
let currentExercise = null;
let adjustState = { weight: 0, reps: 0, sets: 0 };

function openLogSheet(ex, last) {
  currentExercise = ex;
  adjustState.weight = last ? last.weight : 0;
  adjustState.reps = last ? last.reps : ex.targetReps;
  adjustState.sets = last ? last.sets : ex.targetSets;
  document.getElementById('logSheetTitle').textContent = ex.name;
  updateAdjustDisplay();
  showSheet('logSheet');
}
function updateAdjustDisplay() {
  document.getElementById('weightValue').textContent = adjustState.weight;
  document.getElementById('repsValue').textContent = adjustState.reps;
  document.getElementById('setsValue').textContent = adjustState.sets;
}
function attachSwipe(trackId, field, stepPx, stepValue, min) {
  const el = document.getElementById(trackId);
  let startX = 0, startVal = 0, dragging = false;
  const start = (x) => { dragging = true; startX = x; startVal = adjustState[field]; };
  const move = (x) => {
    if (!dragging) return;
    const delta = x - startX;
    const steps = Math.round(delta / stepPx);
    const next = startVal + steps * stepValue;
    adjustState[field] = Math.max(min, Math.round(next * 100) / 100);
    updateAdjustDisplay();
  };
  const end = () => { dragging = false; };
  el.addEventListener('touchstart', e => start(e.touches[0].clientX), {passive: true});
  el.addEventListener('touchmove', e => move(e.touches[0].clientX), {passive: true});
  el.addEventListener('touchend', end);
  el.addEventListener('mousedown', e => start(e.clientX));
  window.addEventListener('mousemove', e => move(e.clientX));
  window.addEventListener('mouseup', end);
}
attachSwipe('weightTrack', 'weight', 24, 2.5, 0);
attachSwipe('repsTrack', 'reps', 20, 1, 0);
attachSwipe('setsTrack', 'sets', 20, 1, 0);

async function checkIsPR(exerciseId, weight, reps) {
  const logs = await DB.getAllByIndex('logEntries', 'exerciseId', exerciseId);
  if (logs.length === 0) return true;
  const historicalMaxWeight = Math.max(...logs.map(l => l.weight));
  if (weight < historicalMaxWeight) return false;
  const bestRepsAtThisWeight = Math.max(0, ...logs.filter(l => l.weight === weight).map(l => l.reps));
  return reps >= bestRepsAtThisWeight;
}

document.getElementById('confirmLogBtn').addEventListener('click', async () => {
  if (!currentExercise) return;
  const isPR = await checkIsPR(currentExercise.id, adjustState.weight, adjustState.reps);
  await DB.add('logEntries', {
    exerciseId: currentExercise.id, date: todayStr(),
    reps: adjustState.reps, sets: adjustState.sets, weight: adjustState.weight,
    isPR, ts: Date.now()
  });
  vibrate(isPR ? [30,50,30] : [30]);
  hideSheet('logSheet');
  renderToday();
  updateStreakPill();
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
  document.getElementById('promptTitle').textContent = title;
  document.getElementById('promptInput').placeholder = placeholder;
  document.getElementById('promptInput').value = '';
  promptCallback = callback;
  showSheet('promptSheet');
  setTimeout(() => document.getElementById('promptInput').focus(), 200);
}
document.getElementById('promptConfirmBtn').addEventListener('click', () => {
  const val = document.getElementById('promptInput').value.trim();
  hideSheet('promptSheet');
  if (promptCallback) promptCallback(val);
});

/* ================= PROFILE ================= */
async function getProfile() {
  return await DB.get('profileStore', 1);
}
document.getElementById('profileBtn').addEventListener('click', async () => {
  const p = await getProfile();
  if (p) {
    document.getElementById('pfName').value = p.name || '';
    document.getElementById('pfWeight').value = p.weight;
    document.getElementById('pfHeight').value = p.height;
    document.getElementById('pfAge').value = p.age;
    document.getElementById('pfGender').value = p.gender;
    document.getElementById('pfActivity').value = p.activityLevel;
  }
  showSheet('profileSheet');
});
document.getElementById('setupProfileBtn').addEventListener('click', () => showSheet('profileSheet'));
document.getElementById('profileSaveBtn').addEventListener('click', async () => {
  const existing = await getProfile();
  const profile = {
    id: 1,
    name: document.getElementById('pfName').value.trim() || '',
    weight: Number(document.getElementById('pfWeight').value),
    height: Number(document.getElementById('pfHeight').value),
    age: Number(document.getElementById('pfAge').value),
    gender: document.getElementById('pfGender').value,
    activityLevel: Number(document.getElementById('pfActivity').value),
    streakRecharges: existing?.streakRecharges ?? 3,
    rechargeUsedThisWeek: existing?.rechargeUsedThisWeek ?? false
  };
  if (!profile.weight || !profile.height || !profile.age) return;
  await DB.put('profileStore', profile);
  hideSheet('profileSheet');
  renderNutritionCard();
  renderGreeting(profile);
});

/* ================= GREETING ================= */
function renderGreeting(profile) {
  const banner = document.getElementById('greetingBanner');
  if (!banner) return;
  if (profile && profile.name) {
    banner.innerHTML = `Welcome back, <span class="greeting-name">${escapeHtml(profile.name)}</span> 👋`;
    return;
  }
  getProfile().then(p => {
    const name = (p && p.name) ? p.name : 'Athlete';
    banner.innerHTML = `Welcome back, <span class="greeting-name">${escapeHtml(name)}</span> 👋`;
  });
}

/* ================= MACROCALC (Nutrition Blueprint) ================= */
document.getElementById('nutritionToggle').addEventListener('click', () => {
  const body = document.getElementById('nutritionBody');
  const chevron = document.getElementById('nutritionChevron');
  body.hidden = !body.hidden;
  chevron.classList.toggle('expanded', !body.hidden);
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
      summarySpan.textContent = `BMI ${bmi.toFixed(1)} · ${m.calories.toLocaleString()} kcal`;
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
    if (bmiNeedleEl) {
      const clamped = Math.min(40, Math.max(15, bmi));
      const pct = ((clamped - 15) / (40 - 15)) * 100;
      bmiNeedleEl.style.left = `${pct}%`;
    }
  }

  renderMacrosForPreset(profile, activePreset);

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === activePreset);
  });

  if (curWeightEl) curWeightEl.textContent = profile.weight + ' KG';

  if (!tgtSlider || !weeksSlider || !tgtLbl || !weeksSlider || !targetResultEl) return;

  tgtSlider.value = profile.weight;
  tgtLbl.textContent = profile.weight;

  const updateTarget = () => {
    tgtLbl.textContent = tgtSlider.value;
    weeksLbl.textContent = weeksSlider.value;
    const delta = Number(tgtSlider.value) - profile.weight;
    const weeks = Number(weeksSlider.value);
    const totalKcal = delta * 7700;
    const dailyDelta = Math.round(totalKcal / (weeks * 7));
    const bmr = calcBMR({ ...profile, weight: profile.weight });
    const tdee = bmr * profile.activityLevel;
    const targetCalories = Math.round(tdee + dailyDelta);
    const verb = dailyDelta > 0 ? 'surplus' : dailyDelta < 0 ? 'deficit' : 'maintenance';
    targetResultEl.textContent =
      `${targetCalories} kcal/day (${dailyDelta >= 0 ? '+' : ''}${dailyDelta} ${verb}) over ${weeks} weeks`;
  };
  tgtSlider.oninput = updateTarget;
  weeksSlider.oninput = updateTarget;
  updateTarget();
}

/* ================= STREAK: day-status engine ================= */
function getMondayStr(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return fmtDate(d);
}

function getWeekMondayStr() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  return fmtDate(mon);
}

async function checkAndRestockRecharges(profile) {
  if (!profile) return;
  const todayS = todayStr();
  const thisMonday = getWeekMondayStr();
  const lastMonday = addDays(thisMonday, -7);
  const lastSunday = addDays(thisMonday, -1);

  const logs = await DB.getAll('logEntries');
  const lastWeekLogs = logs.filter(l => l.date >= lastMonday && l.date <= lastSunday);
  const uniqueDays = new Set(lastWeekLogs.map(l => l.date));
  const daysAttended = uniqueDays.size;

  const today = new Date();
  const isMonday = today.getDay() === 1;
  const alreadyResetThisWeek = profile.rechargeUsedThisWeek === false && profile.streakRecharges === 3;

  if (isMonday || !alreadyResetThisWeek) {
    profile.rechargeUsedThisWeek = false;
    if (daysAttended >= 5) {
      profile.streakRecharges = 3;
    }
    await DB.put('profileStore', profile);
  }
}

async function computeDayStatuses(throughDateStr, profile) {
  const logs = await DB.getAll('logEntries');
  const recharges = profile?.streakRecharges ?? 3;
  let rechargedThisWeek = profile?.rechargeUsedThisWeek ?? false;

  if (logs.length === 0) return { statuses: {}, streak: 0, firstDate: null, rechargesRemaining: recharges };
  const byDate = {};
  logs.forEach(l => { (byDate[l.date] ||= []).push(l); });
  const firstDate = Object.keys(byDate).sort()[0];

  const thisMonday = getWeekMondayStr();

  const statuses = {};
  const order = [];
  let streak = 0;
  let cursor = firstDate;
  let rechargesUsed = 0;
  while (cursor <= throughDateStr) {
    const dayLogs = byDate[cursor];
    const isToday = (cursor === throughDateStr);
    let status;
    if (dayLogs && dayLogs.length > 0) {
      status = dayLogs.some(l => l.isPR) ? 'pr' : 'attended';
      streak += 1;
    } else if (isToday) {
      status = 'pending';
    } else {
      let priorInactive = 0;
      for (let i = order.length - 1, seen = 0; i >= 0 && seen < 6; i--, seen++) {
        const s = statuses[order[i]];
        if (s === 'rest' || s === 'missed' || s === 'recharged') priorInactive++;
      }
      const canRecharge = !rechargedThisWeek && (recharges - rechargesUsed) > 0;
      if (priorInactive < 2) {
        status = 'rest';
      } else if (canRecharge && cursor >= thisMonday) {
        status = 'recharged';
        rechargedThisWeek = true;
        rechargesUsed++;
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
  return { statuses, streak, firstDate, rechargesRemaining: recharges - rechargesUsed, rechargeUsedThisWeek: rechargedThisWeek };
}

async function updateStreakPill() {
  const profile = await getProfile();
  const data = await computeDayStatuses(todayStr(), profile);
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
  const profile = await getProfile();
  await checkAndRestockRecharges(profile);
  const freshProfile = await getProfile();
  const data = await computeDayStatuses(todayS, freshProfile);
  document.getElementById('streakCount').textContent = data.streak;

  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  const satEnd = new Date(sunday); satEnd.setDate(sunday.getDate()+6);
  document.getElementById('weekRangeLabel').textContent =
    `${MONTH_NAMES[sunday.getMonth()].slice(0,3)} ${sunday.getDate()} – ${MONTH_NAMES[satEnd.getMonth()].slice(0,3)} ${satEnd.getDate()}`;

  /* Weekday labels */
  const weekLabels = document.getElementById('weekLabels');
  weekLabels.innerHTML = '';
  const wkLabels = ['S','M','T','W','T','F','S'];
  for (let i = 0; i < 7; i++) {
    const span = document.createElement('span');
    span.textContent = wkLabels[i];
    weekLabels.appendChild(span);
  }

  /* Day nodes + pill background */
  const weekBar = document.getElementById('weekBar');
  weekBar.innerHTML = '';
  const pillBg = document.getElementById('pillBg');
  let streakStartIdx = -1;
  let streakEndIdx = -1;
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday); d.setDate(sunday.getDate() + i);
    const dS = fmtDate(d);
    let status;
    if (dS === todayS) {
      status = data.statuses[dS] || 'today-pending';
    } else if (dS < todayS) {
      status = (data.firstDate && dS >= data.firstDate) ? data.statuses[dS] : 'pending';
    } else {
      status = 'future';
    }
    statuses.push(status);

    const isActive = (status === 'attended' || status === 'pr' || status === 'recharged');
    if (isActive) {
      if (streakStartIdx === -1) streakStartIdx = i;
      streakEndIdx = i;
    }

    const glyph = (status==='attended') ? '✓' : (status==='pr') ? '★' : (status==='recharged') ? '⚡' : (status==='missed') ? '✕' : (status==='rest') ? '—' : '';
    const node = document.createElement('div');
    node.className = `streak-node ${status}`;
    node.textContent = glyph;
    weekBar.appendChild(node);
  }

  /* Position thick pill background behind consecutive active days */
  if (streakStartIdx >= 0 && streakEndIdx >= streakStartIdx) {
    const nodeW = 30;
    const trackW = weekBar.offsetWidth || 280;
    const gap = trackW > 0 ? (trackW - 7 * nodeW) / 6 : 0;
    const leftPx = streakStartIdx * (nodeW + gap);
    const rightPx = (6 - streakEndIdx) * (nodeW + gap);
    pillBg.style.left = `calc(${leftPx}px - 4px)`;
    pillBg.style.right = `calc(${rightPx}px - 4px)`;
    pillBg.style.width = 'auto';
  } else {
    pillBg.style.left = '50%';
    pillBg.style.right = '50%';
    pillBg.style.width = '0';
  }

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
    cell.className = 'cal-cell' + (dS === todayS ? ' is-today' : '');
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

async function renderPlans() {
  const plans = await DB.getAll('plans');
  const list = document.getElementById('planList');
  list.innerHTML = '';
  for (const p of plans) {
    const card = document.createElement('div');
    card.className = 'plan-card' + (p.isActive ? ' is-active' : '');
    card.dataset.planId = p.id;

    /* Card head row */
    const head = document.createElement('div');
    head.className = 'plan-card-head';
    head.innerHTML = `
      <span class="plan-card-name">${escapeHtml(p.name)}</span>
      <div class="plan-card-actions">
        <span class="plan-card-badge">${p.isActive ? 'ACTIVE' : 'tap to activate'}</span>
        <span class="trash-btn" data-plan-id="${p.id}">🗑</span>
      </div>
    `;
    head.querySelector('.plan-card-name').addEventListener('click', () => togglePlanCard(p, card, plans));
    head.querySelector('.plan-card-badge').addEventListener('click', () => togglePlanCard(p, card, plans));
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

    /* Card body — weekday grid (hidden until expanded) */
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
      if (badge) badge.textContent = 'tap to activate';
    });
    card.classList.add('is-active');
    const badge = card.querySelector('.plan-card-badge');
    if (badge) badge.textContent = 'ACTIVE';

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
    const cell = document.createElement('div');
    cell.className = 'weekday-cell' + (day ? ' has-exercises' : '');
    cell.textContent = WEEKDAY_SHORT[w];
    cell.addEventListener('click', () => openDayEditorInline(plan, w, day, body));
    grid.appendChild(cell);
  }
  body.appendChild(grid);

  const hint = document.createElement('div');
  hint.className = 'exercise-meta';
  hint.style.textAlign = 'center';
  hint.textContent = 'Tap a day to set its split and exercises';
  body.appendChild(hint);
}

async function openDayEditorInline(plan, weekday, existingDay, container) {
  let day = existingDay;
  if (!day) {
    openPrompt('Split name', 'e.g. Push Day', async (label) => {
      if (!label) return;
      const id = await DB.add('planDays', { planId: plan.id, weekday, label });
      day = { id, planId: plan.id, weekday, label };
      renderDayExerciseEditorInline(day, plan, container);
    });
    return;
  }
  renderDayExerciseEditorInline(day, plan, container);
}

async function renderDayExerciseEditorInline(day, plan, container) {
  let exercises = await DB.getAllByIndex('exercises', 'planDayId', day.id);
  exercises = exercises.sort((a,b) => (a.order||0) - (b.order||0));

  /* Remove any existing day editor in this container */
  container.querySelectorAll('.day-exercise-editor').forEach(n => n.remove());

  const box = document.createElement('div');
  box.className = 'day-exercise-editor';

  const headRow = document.createElement('div');
  headRow.style.display = 'flex';
  headRow.style.justifyContent = 'space-between';
  headRow.style.alignItems = 'flex-start';
  headRow.innerHTML = `
    <div>
      <div class="section-title" style="margin:0;">${escapeHtml(day.label)}</div>
      <div class="exercise-meta" style="margin-top:2px;">${WEEKDAY_NAMES[day.weekday]}</div>
    </div>
    <span class="trash-btn delete-day-split-btn">🗑</span>`;
  box.appendChild(headRow);

  const rowsWrap = document.createElement('div');
  rowsWrap.id = 'exRowsWrap';
  rowsWrap.style.marginTop = '10px';
  exercises.forEach(ex => rowsWrap.appendChild(buildExerciseRow(ex, day, plan)));
  box.appendChild(rowsWrap);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-ghost';
  addBtn.style.marginTop = '10px';
  addBtn.textContent = '+ Add exercise';
  addBtn.addEventListener('click', () => {
    openPrompt('Exercise name', 'e.g. Bench Press', async (name) => {
      if (!name) return;
      const maxOrder = Math.max(-1, ...exercises.map(e => e.order||0));
      await DB.add('exercises', { planDayId: day.id, name, targetReps: 8, targetSets: 3, order: maxOrder+1 });
      renderDayExerciseEditorInline(day, plan, container);
    });
  });
  box.appendChild(addBtn);

  container.appendChild(box);

  box.querySelector('.delete-day-split-btn').addEventListener('click', () => {
    openConfirm('Delete this split?', `"${day.label}" and its exercises will be removed from ${WEEKDAY_NAMES[day.weekday]}.`, async () => {
      for (const ex of exercises) await DB.delete('exercises', ex.id);
      await DB.delete('planDays', day.id);
      box.remove();
      /* Re-render the card's weekday grid */
      const body = container;
      body.querySelectorAll('.day-exercise-editor').forEach(n => n.remove());
      renderPlanCardEditor(plan, body.closest('.plan-card'));
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

let currentEditingPlan = null;

function buildExerciseRow(ex, day, plan) {
  const row = document.createElement('div');
  row.className = 'day-exercise-row';
  row.dataset.exId = ex.id;
  row.innerHTML = `
    <div class="day-exercise-row-main">
      <span class="drag-handle">⠿</span>
      <span>${escapeHtml(ex.name)} — ${ex.targetSets}×${ex.targetReps}</span>
    </div>
    <div class="day-exercise-row-actions">
      <span class="edit-pencil">✎</span>
      <span class="remove-x">✕</span>
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
      renderDayExerciseEditorInline(day, plan, container);
    });
  });
  attachDragReorder(row);
  return row;
}

function attachDragReorder(row) {
  const handle = row.querySelector('.drag-handle');
  let startY = 0, dragging = false;
  const onMove = (clientY) => {
    if (!dragging) return;
    row.style.transform = `translateY(${clientY - startY}px)`;
    const wrap = document.getElementById('exRowsWrap');
    const siblings = [...wrap.children].filter(c => c !== row);
    for (const sib of siblings) {
      const rect = sib.getBoundingClientRect();
      const mid = rect.top + rect.height/2;
      if (clientY < mid && sib.previousSibling !== row) {
        wrap.insertBefore(row, sib);
        row.style.transform = `translateY(${clientY - startY}px)`;
        break;
      } else if (clientY >= mid && sib.nextSibling !== row) {
        wrap.insertBefore(row, sib.nextSibling);
        row.style.transform = `translateY(${clientY - startY}px)`;
        break;
      }
    }
  };
  const onEnd = async () => {
    if (!dragging) return;
    dragging = false;
    row.classList.remove('dragging');
    row.style.transform = '';
    const wrap = document.getElementById('exRowsWrap');
    const ids = [...wrap.children].map(c => Number(c.dataset.exId));
    for (let i = 0; i < ids.length; i++) {
      const exRecord = await DB.get('exercises', ids[i]);
      exRecord.order = i;
      await DB.put('exercises', exRecord);
    }
  };
  handle.addEventListener('touchstart', e => { dragging = true; startY = e.touches[0].clientY; row.classList.add('dragging'); }, {passive: true});
  handle.addEventListener('touchmove', e => onMove(e.touches[0].clientY), {passive: true});
  handle.addEventListener('touchend', onEnd);
  handle.addEventListener('mousedown', e => { dragging = true; startY = e.clientY; row.classList.add('dragging'); });
  window.addEventListener('mousemove', e => onMove(e.clientY));
  window.addEventListener('mouseup', onEnd);
}

function openExerciseEditSheet(ex, day, plan) {
  document.getElementById('editExName').value = ex.name;
  document.getElementById('editExReps').value = ex.targetReps;
  document.getElementById('editExSets').value = ex.targetSets;
  showSheet('editExSheet');
  document.getElementById('editExSaveBtn').onclick = async () => {
    ex.name = document.getElementById('editExName').value.trim() || ex.name;
    ex.targetReps = Number(document.getElementById('editExReps').value) || ex.targetReps;
    ex.targetSets = Number(document.getElementById('editExSets').value) || ex.targetSets;
    await DB.put('exercises', ex);
    hideSheet('editExSheet');
    const container = document.querySelector('.plan-card.is-expanded .plan-card-body');
    if (container) renderDayExerciseEditorInline(day, plan, container);
  };
}

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
