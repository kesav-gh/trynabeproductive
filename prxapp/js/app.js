const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAY_SHORT = ['S','M','T','W','T','F','S'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
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
  if (name === 'plans') renderPlans();
  if (name === 'streak') renderStreak();
}

/* ---------- Today view ---------- */
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

  const exercises = await DB.getAllByIndex('exercises', 'planDayId', day.id);
  if (exercises.length === 0) {
    empty.hidden = false;
    return;
  }
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

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- Log sheet with swipe-to-adjust ---------- */
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
  // mouse fallback for desktop testing
  el.addEventListener('mousedown', e => start(e.clientX));
  window.addEventListener('mousemove', e => move(e.clientX));
  window.addEventListener('mouseup', end);
}
attachSwipe('weightTrack', 'weight', 24, 2.5, 0);
attachSwipe('repsTrack', 'reps', 20, 1, 0);
attachSwipe('setsTrack', 'sets', 20, 1, 0);

document.getElementById('confirmLogBtn').addEventListener('click', async () => {
  if (!currentExercise) return;
  await DB.add('logEntries', {
    exerciseId: currentExercise.id,
    date: todayStr(),
    reps: adjustState.reps,
    sets: adjustState.sets,
    weight: adjustState.weight,
    ts: Date.now()
  });
  await registerTodaysLog();
  hideSheet('logSheet');
  renderToday();
  updateStreakPill();
});

function showSheet(id) {
  document.getElementById(id).classList.add('show');
  document.getElementById(id === 'logSheet' ? 'logSheetBackdrop' : 'promptBackdrop').classList.add('show');
}
function hideSheet(id) {
  document.getElementById(id).classList.remove('show');
  document.getElementById(id === 'logSheet' ? 'logSheetBackdrop' : 'promptBackdrop').classList.remove('show');
}
document.getElementById('logSheetBackdrop').addEventListener('click', () => hideSheet('logSheet'));
document.getElementById('promptBackdrop').addEventListener('click', () => hideSheet('promptSheet'));

/* ---------- Streak engine ---------- */
async function getStreakState() {
  let s = await DB.get('streakState', 1);
  if (!s) {
    s = { id: 1, lastLoggedDate: null, currentStreak: 0, freezeAvailable: false };
    await DB.put('streakState', s);
  }
  return s;
}

async function registerTodaysLog() {
  const s = await getStreakState();
  const today = todayStr();
  if (s.lastLoggedDate === today) return; // already counted today

  if (!s.lastLoggedDate) {
    s.currentStreak = 1;
  } else {
    const gap = daysBetween(s.lastLoggedDate, today);
    if (gap === 1) {
      s.currentStreak += 1;
    } else if (gap === 2 && s.freezeAvailable) {
      s.currentStreak += 1; // freeze absorbs the missed day
      s.freezeAvailable = false;
    } else if (gap > 1) {
      s.currentStreak = 1;
    }
  }
  // earn a freeze every 7-day milestone (simple version, one freeze banked at a time)
  if (s.currentStreak > 0 && s.currentStreak % 7 === 0) {
    s.freezeAvailable = true;
  }
  s.lastLoggedDate = today;
  await DB.put('streakState', s);
}

async function updateStreakPill() {
  const s = await getStreakState();
  document.getElementById('streakCount').textContent = s.currentStreak;
}

async function renderStreak() {
  const s = await getStreakState();
  document.getElementById('streakHeroNum').textContent = s.currentStreak;
  document.getElementById('freezeStatus').textContent = s.freezeAvailable
    ? 'Freeze available — one missed day won\'t break your streak'
    : 'No freeze available (earn one every 7 days)';

  const logs = await DB.getAll('logEntries');
  const byDate = {};
  logs.forEach(l => { byDate[l.date] = (byDate[l.date] || 0) + 1; });
  const dates = Object.keys(byDate).sort().reverse().slice(0, 14);
  const list = document.getElementById('historyList');
  list.innerHTML = dates.map(d => `
    <div class="history-row"><span>${d}</span><span>${byDate[d]} logged</span></div>
  `).join('') || '<div class="history-row"><span>No sessions yet</span></div>';
}

/* ---------- Plans view ---------- */
async function renderPlans() {
  const plans = await DB.getAll('plans');
  const list = document.getElementById('planList');
  list.innerHTML = '';
  for (const p of plans) {
    const row = document.createElement('div');
    row.className = 'plan-row' + (p.isActive ? ' is-active' : '');
    row.innerHTML = `
      <span class="plan-row-name">${escapeHtml(p.name)}</span>
      <span class="plan-row-badge">${p.isActive ? 'ACTIVE — tap to edit' : 'tap to activate'}</span>
    `;
    row.addEventListener('click', async () => {
      if (!p.isActive) {
        for (const other of plans) { other.isActive = false; await DB.put('plans', other); }
        p.isActive = true;
        await DB.put('plans', p);
        renderPlans();
      } else {
        openPlanEditor(p);
      }
    });
    list.appendChild(row);
  }
}

document.getElementById('newPlanBtn').addEventListener('click', () => {
  openPrompt('New plan', 'e.g. Push Pull Legs', async (name) => {
    if (!name) return;
    const plans = await DB.getAll('plans');
    const isFirst = plans.length === 0;
    await DB.add('plans', { name, isActive: isFirst });
    renderPlans();
  });
});

let currentEditingPlan = null;
async function openPlanEditor(plan) {
  currentEditingPlan = plan;
  document.getElementById('planEditorTitle').textContent = plan.name;
  document.getElementById('planEditorHead').hidden = false;
  const editor = document.getElementById('planEditor');
  editor.hidden = false;

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
  editor.innerHTML = '';
  editor.appendChild(grid);
  const hint = document.createElement('div');
  hint.className = 'exercise-meta';
  hint.style.textAlign = 'center';
  hint.textContent = 'Tap a day to set its split and exercises';
  editor.appendChild(hint);
}

document.getElementById('closePlanEditor').addEventListener('click', () => {
  document.getElementById('planEditorHead').hidden = true;
  document.getElementById('planEditor').hidden = true;
});

async function openDayEditor(plan, weekday, existingDay) {
  const editor = document.getElementById('planEditor');
  let day = existingDay;
  if (!day) {
    openPrompt('Split name', 'e.g. Push Day', async (label) => {
      if (!label) return;
      const id = await DB.add('planDays', { planId: plan.id, weekday, label });
      day = { id, planId: plan.id, weekday, label };
      renderDayExerciseEditor(day);
    });
    return;
  }
  renderDayExerciseEditor(day);
}

async function renderDayExerciseEditor(day) {
  const editor = document.getElementById('planEditor');
  const exercises = await DB.getAllByIndex('exercises', 'planDayId', day.id);
  const box = document.createElement('div');
  box.className = 'day-exercise-editor';
  box.innerHTML = `<div class="section-title" style="margin-top:0">${escapeHtml(day.label)} (${WEEKDAY_NAMES[day.weekday]})</div>`;
  exercises.forEach(ex => {
    const row = document.createElement('div');
    row.className = 'day-exercise-row';
    row.innerHTML = `<span>${escapeHtml(ex.name)} — ${ex.targetSets}×${ex.targetReps}</span><span class="remove-x">✕</span>`;
    row.querySelector('.remove-x').addEventListener('click', async (e) => {
      e.stopPropagation();
      await DB.delete('exercises', ex.id);
      renderDayExerciseEditor(day);
    });
    box.appendChild(row);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-ghost';
  addBtn.style.marginTop = '10px';
  addBtn.textContent = '+ Add exercise';
  addBtn.addEventListener('click', () => {
    openPrompt('Exercise name', 'e.g. Bench Press', async (name) => {
      if (!name) return;
      await DB.add('exercises', { planDayId: day.id, name, targetReps: 8, targetSets: 3 });
      renderDayExerciseEditor(day);
    });
  });
  box.appendChild(addBtn);
  editor.querySelectorAll('.day-exercise-editor').forEach(n => n.remove());
  editor.appendChild(box);
}

/* ---------- Generic prompt sheet ---------- */
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

/* ---------- Init ---------- */
(async function init() {
  await getStreakState();
  await updateStreakPill();
  renderToday();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
