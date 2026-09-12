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
  if (name === 'plans') { resetPlanEditorState(); renderPlans(); renderPlanSwitcherCard(); renderNutritionCard(); }
  if (name === 'streak') { resetCalendarToCurrentMonth(); renderStreak(); }
}

/* ================= TODAY ================= */
async function getActivePlan() {
  const plans = await DB.getAll('plans');
  return plans.find(p => p.isActive) || null;
}

async function renderToday() {
  const now = new Date();
  document.getElementById('todayWeekdayLabel').textContent = WEEKDAY_NAMES[now.getDay()];
  const plan = await getActivePlan();
  const list = document.getElementById('exerciseList');
  const empty = document.getElementById('emptyToday');
  list.innerHTML = '';

  if (!plan) {
    document.getElementById('todaySplitName').textContent = 'No active plan';
    empty.hidden = false;
    return;
  }
  const planDays = await DB.getAllByIndex('planDays', 'planId', plan.id);
  const day = planDays.find(pd => pd.weekday === now.getDay());
  if (!day) {
    document.getElementById('todaySplitName').textContent = 'Rest day';
    empty.hidden = false;
    return;
  }
  document.getElementById('todaySplitName').textContent = day.label || 'Session';

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
      <div class="exercise-lastlog">${last ? last.weight + 'kg' : '--'}</div>
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
  const profile = {
    id: 1,
    weight: Number(document.getElementById('pfWeight').value),
    height: Number(document.getElementById('pfHeight').value),
    age: Number(document.getElementById('pfAge').value),
    gender: document.getElementById('pfGender').value,
    activityLevel: Number(document.getElementById('pfActivity').value)
  };
  if (!profile.weight || !profile.height || !profile.age) return;
  await DB.put('profileStore', profile);
  hideSheet('profileSheet');
  renderNutritionCard();
});

/* ================= NUTRITION BLUEPRINT ================= */
document.getElementById('nutritionToggle').addEventListener('click', () => {
  const body = document.getElementById('nutritionBody');
  const chevron = document.getElementById('nutritionChevron');
  body.hidden = !body.hidden;
  chevron.textContent = body.hidden ? '▾' : '▴';
});

function calcBMR(profile) {
  const { weight, height, age, gender } = profile;
  const male = 10*weight + 6.25*height - 5*age + 5;
  const female = 10*weight + 6.25*height - 5*age - 161;
  if (gender === 'male') return male;
  if (gender === 'female') return female;
  return (male + female) / 2; // 'other' -- averaged approximation, not a validated formula
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

async function renderNutritionCard() {
  const profile = await getProfile();
  const noMsg = document.getElementById('noProfileMsg');
  const content = document.getElementById('nutritionContent');
  if (!profile) { noMsg.hidden = false; content.hidden = true; return; }
  noMsg.hidden = true; content.hidden = false;

  const bmi = profile.weight / Math.pow(profile.height/100, 2);
  document.getElementById('bmiValue').textContent = bmi.toFixed(1);
  const clamped = Math.min(40, Math.max(15, bmi));
  const pct = ((clamped - 15) / (40 - 15)) * 100;
  document.getElementById('bmiNeedle').style.left = `${pct}%`;

  renderMacrosForPreset(profile, activePreset);

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === activePreset);
    btn.onclick = () => {
      activePreset = btn.dataset.preset;
      renderMacrosForPreset(profile, activePreset);
    };
  });

  // Target mode sliders
  const curSlider = document.getElementById('curWeightSlider');
  const tgtSlider = document.getElementById('tgtWeightSlider');
  const weeksSlider = document.getElementById('weeksSlider');
  curSlider.value = profile.weight;
  tgtSlider.value = profile.weight;
  document.getElementById('curWeightLbl').textContent = profile.weight;
  document.getElementById('tgtWeightLbl').textContent = profile.weight;

  const updateTarget = () => {
    document.getElementById('curWeightLbl').textContent = curSlider.value;
    document.getElementById('tgtWeightLbl').textContent = tgtSlider.value;
    document.getElementById('weeksLbl').textContent = weeksSlider.value;
    const delta = Number(tgtSlider.value) - Number(curSlider.value);
    const weeks = Number(weeksSlider.value);
    const totalKcal = delta * 7700; // ~7700 kcal per kg of fat/tissue change
    const dailyDelta = Math.round(totalKcal / (weeks * 7));
    const bmr = calcBMR({ ...profile, weight: Number(curSlider.value) });
    const tdee = bmr * profile.activityLevel;
    const targetCalories = Math.round(tdee + dailyDelta);
    const verb = dailyDelta > 0 ? 'surplus' : dailyDelta < 0 ? 'deficit' : 'maintenance';
    document.getElementById('targetResult').textContent =
      `${targetCalories} kcal/day (${dailyDelta >= 0 ? '+' : ''}${dailyDelta} ${verb}) over ${weeks} weeks`;
  };
  curSlider.oninput = updateTarget;
  tgtSlider.oninput = updateTarget;
  weeksSlider.oninput = updateTarget;
  updateTarget();
}

function renderMacrosForPreset(profile, presetKey) {
  const m = computeMacros(profile, presetKey);
  document.getElementById('macroCal').textContent = m.calories.toLocaleString();
  document.getElementById('macroProtein').textContent = m.proteinG + 'g';
  document.getElementById('macroCarbs').textContent = m.carbsG + 'g';
  document.getElementById('macroFat').textContent = m.fatG + 'g';
}

/* ================= STREAK: day-status engine ================= */
async function computeDayStatuses(throughDateStr) {
  const logs = await DB.getAll('logEntries');
  if (logs.length === 0) return { statuses: {}, streak: 0, firstDate: null };
  const byDate = {};
  logs.forEach(l => { (byDate[l.date] ||= []).push(l); });
  const firstDate = Object.keys(byDate).sort()[0];

  const statuses = {};
  const order = [];
  let streak = 0;
  let cursor = firstDate;
  while (cursor <= throughDateStr) {
    const dayLogs = byDate[cursor];
    let status;
    if (dayLogs && dayLogs.length > 0) {
      status = dayLogs.some(l => l.isPR) ? 'pr' : 'attended';
      streak += 1;
    } else {
      let priorInactive = 0;
      for (let i = order.length - 1, seen = 0; i >= 0 && seen < 6; i--, seen++) {
        const s = statuses[order[i]];
        if (s === 'rest' || s === 'missed') priorInactive++;
      }
      if (priorInactive < 2) { status = 'rest'; }
      else { status = 'missed'; streak = 0; }
    }
    statuses[cursor] = status;
    order.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return { statuses, streak, firstDate };
}

async function updateStreakPill() {
  const data = await computeDayStatuses(todayStr());
  document.getElementById('streakCount').textContent = data.streak;
}

/* ================= STREAK: weekly bar + month calendar ================= */
let calViewYear, calViewMonth; // month calendar navigation state (0-indexed month)
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

  // Weekly bar -- always this actual calendar week, independent of month nav
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  const satEnd = new Date(sunday); satEnd.setDate(sunday.getDate()+6);
  document.getElementById('weekRangeLabel').textContent =
    `${MONTH_NAMES[sunday.getMonth()].slice(0,3)} ${sunday.getDate()} – ${MONTH_NAMES[satEnd.getMonth()].slice(0,3)} ${satEnd.getDate()}`;

  const weekBar = document.getElementById('weekBar');
  weekBar.innerHTML = '';
  const wkLabels = ['S','M','T','W','T','F','S'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday); d.setDate(sunday.getDate() + i);
    const dS = fmtDate(d);
    let status;
    if (dS === todayS) {
      status = data.statuses[dS] || 'today-pending';
    } else if (dS < todayS) {
      status = (data.firstDate && dS >= data.firstDate) ? data.statuses[dS] : 'pending';
    } else {
      status = 'pending';
    }
    const cell = document.createElement('div');
    cell.className = 'weekbar-day';
    const connectorSolid = (status === 'attended' || status === 'pr' || status === 'rest');
    const glyph = (status==='attended'||status==='pr') ? '✓' : (status==='missed' ? '✕' : (status==='rest' ? '—' : ''));
    cell.innerHTML = `
      <div class="weekbar-label">${wkLabels[i]}</div>
      <div class="weekbar-node ${status}">${glyph}</div>
      <div class="weekbar-connector ${connectorSolid ? 'solid' : ''}"></div>
    `;
    weekBar.appendChild(cell);
  }

  // Month calendar -- respects nav state, capped forward at real current month
  document.getElementById('calMonthLabel').textContent = `${MONTH_NAMES[calViewMonth]} ${calViewYear}`;
  document.getElementById('calNextBtn').disabled =
    (calViewYear === today.getFullYear() && calViewMonth === today.getMonth());

  const grid = document.getElementById('monthGrid');
  grid.innerHTML = '';
  const firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  const firstWeekdaySun = firstOfMonth.getDay(); // 0=Sun, matches header S M T W T F S
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
    cell.className = 'cal-cell';
    let dotHtml = '<div class="dot-slot"></div>';
    if (dS <= todayS && data.firstDate && dS >= data.firstDate) {
      const status = data.statuses[dS];
      const dotClass = { attended:'dot-blue', pr:'dot-yellow', rest:'dot-grey', missed:'dot-red' }[status];
      if (dotClass) dotHtml = `<span class="dot ${dotClass}"></span>`;
    }
    cell.innerHTML = `<span>${day}</span>${dotHtml}`;
    grid.appendChild(cell);
  }
}

/* ================= PLANS ================= */
function resetPlanEditorState() {
  currentEditingPlan = null;
  document.getElementById('planEditorHead').hidden = true;
  document.getElementById('planEditor').hidden = true;
  document.getElementById('planEditor').innerHTML = '';
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
    const row = document.createElement('div');
    row.className = 'plan-row' + (p.isActive ? ' is-active' : '');
    row.innerHTML = `
      <span class="plan-row-name">${escapeHtml(p.name)}</span>
      <div class="plan-row-actions">
        <span class="plan-row-badge">${p.isActive ? 'ACTIVE — tap to edit' : 'tap to activate'}</span>
        <span class="trash-btn" data-plan-id="${p.id}">🗑</span>
      </div>
    `;
    row.querySelector('.plan-row-name').addEventListener('click', () => activateOrEditPlan(p, plans));
    row.querySelector('.plan-row-badge').addEventListener('click', () => activateOrEditPlan(p, plans));
    row.querySelector('.trash-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirm('Delete plan?', `"${p.name}" and all its splits and exercises will be removed. Logged history stays intact.`, async () => {
        await deletePlanCascade(p.id);
        resetPlanEditorState();
        await renderPlans();
        await renderPlanSwitcherCard();
        renderToday();
      });
    });
    list.appendChild(row);
  }
}

async function activateOrEditPlan(p, plans) {
  if (!p.isActive) {
    for (const other of plans) { if (other.isActive) { other.isActive = false; await DB.put('plans', other); } }
    p.isActive = true;
    await DB.put('plans', p);
    resetPlanEditorState();
    await renderPlans();
    await renderPlanSwitcherCard();
    renderToday();
  } else {
    openPlanEditor(p);
  }
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

async function openPlanEditor(plan) {
  currentEditingPlan = plan;
  document.getElementById('planEditorTitle').textContent = 'Weekly Splits';
  document.getElementById('planEditorHead').hidden = false;
  const editor = document.getElementById('planEditor');
  editor.hidden = false;
  editor.innerHTML = '';

  const planDays = await DB.getAllByIndex('planDays', 'planId', plan.id);
  const grid = document.createElement('div');
  grid.className = 'weekday-grid';
  for (let w = 0; w < 7; w++) {
    const day = planDays.find(pd => pd.weekday === w);
    const cell = document.createElement('div');
    cell.className = 'weekday-cell' + (day ? ' has-exercises' : '');
    cell.textContent = WEEKDAY_SHORT[w];
    cell.addEventListener('click', () => openDayEditor(plan, w, day));
    grid.appendChild(cell);
  }
  editor.appendChild(grid);
  const hint = document.createElement('div');
  hint.className = 'exercise-meta';
  hint.style.textAlign = 'center';
  hint.textContent = 'Tap a day to set its split and exercises';
  editor.appendChild(hint);
}

document.getElementById('closePlanEditor').addEventListener('click', resetPlanEditorState);

async function openDayEditor(plan, weekday, existingDay) {
  let day = existingDay;
  if (!day) {
    openPrompt('Split name', 'e.g. Push Day', async (label) => {
      if (!label) return;
      const id = await DB.add('planDays', { planId: plan.id, weekday, label });
      day = { id, planId: plan.id, weekday, label };
      renderDayExerciseEditor(day, plan);
    });
    return;
  }
  renderDayExerciseEditor(day, plan);
}

async function renderDayExerciseEditor(day, plan) {
  const editor = document.getElementById('planEditor');
  let exercises = await DB.getAllByIndex('exercises', 'planDayId', day.id);
  exercises = exercises.sort((a,b) => (a.order||0) - (b.order||0));

  const box = document.createElement('div');
  box.className = 'day-exercise-editor';

  const headRow = document.createElement('div');
  headRow.style.display = 'flex';
  headRow.style.justifyContent = 'space-between';
  headRow.style.alignItems = 'flex-start';
  headRow.innerHTML = `
    <div>
      <div class="section-title" style="margin:0;">${escapeHtml(day.label)} — Workout Split</div>
      <div class="exercise-meta" style="margin-top:2px;">${WEEKDAY_NAMES[day.weekday]}</div>
    </div>
    <span class="trash-btn" id="deleteDaySplitBtn">🗑</span>`;
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
      renderDayExerciseEditor(day, plan);
    });
  });
  box.appendChild(addBtn);

  editor.querySelectorAll('.day-exercise-editor').forEach(n => n.remove());
  editor.appendChild(box);

  document.getElementById('deleteDaySplitBtn').addEventListener('click', () => {
    openConfirm('Delete this split?', `"${day.label}" and its exercises will be removed from ${WEEKDAY_NAMES[day.weekday]}.`, async () => {
      for (const ex of exercises) await DB.delete('exercises', ex.id);
      await DB.delete('planDays', day.id);
      box.remove();
      openPlanEditor(plan);
    });
  });
}

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
      renderDayExerciseEditor(day, plan);
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
    renderDayExerciseEditor(day, plan);
  };
}

/* ================= Init ================= */
(async function init() {
  resetCalendarToCurrentMonth();
  await updateStreakPill();
  renderStreak(); // default home tab
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
