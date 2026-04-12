  // ── Constantes ────────────────────────────────────────────────────────────────

const SUBJECT_COLORS = {
  math:    'var(--math)',
  french:  'var(--french)',
  history: 'var(--history)',
  physics: 'var(--physics)',
  english: 'var(--english)',
  bio:     'var(--bio)',
  other:   'var(--other)',
};

const SUBJECT_LABELS = {
  math:    'Maths',
  french:  'Français',
  history: 'Histoire-Géo',
  physics: 'Physique-Chimie',
  english: 'Anglais',
  bio:     'SVT',
  other:   'Autre',
};

const SUBJECT_MAP = [
  { keys: ['math'],                                                                        id: 'math'    },
  { keys: ['français', 'francais', 'french'],                                             id: 'french'  },
  { keys: ['histoire', 'géographie', 'geographie', 'histoire-geo'],                      id: 'history' },
  { keys: ['physique', 'chimie'],                                                          id: 'physics' },
  { keys: ['anglais', 'lv1', 'lv2', 'english'],                                          id: 'english' },
  { keys: ['svt', 'sciences vie', 'biologie', 'bio', 'sciences & vie', 'sciences vie & terre'], id: 'bio' },
];

const MONTHS_FR = {
  janvier:1, février:2, mars:3, avril:4, mai:5, juin:6,
  juillet:7, août:8, septembre:9, octobre:10, novembre:11, décembre:12,
};

const MONTHS_LABELS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

const SKIP_RX = [
  /^donné le /i, /^\[?\d+ jours?\]?$/i, /^non fait$/i,
  /^j'ai terminé$/i, /^voir le cours$/i, /^fait$/i, /^evaluation\s*$/i,
];

// ── État ──────────────────────────────────────────────────────────────────────

let devoirs = JSON.parse(localStorage.getItem('devoirs_v2') || '[]');
devoirs = devoirs.map(d => ({ ...d, id: Math.round(d.id) }));
devoirs = devoirs.filter((d, i, arr) => arr.findIndex(x => x.id === d.id) === i);

let activeFilter = 'all';
let editingId    = null;
let editingDevoir = null;
let calYear = null, calMonth = null, calSelectedDate = null;

function save() { localStorage.setItem('devoirs_v2', JSON.stringify(devoirs)); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectSubject(raw) {
  const lower = raw.toLowerCase();
  for (const { keys, id } of SUBJECT_MAP) {
    if (keys.some(k => lower.includes(k))) return id;
  }
  return 'other';
}

function resolveDate(dayNum, monthName) {
  const month = MONTHS_FR[monthName.toLowerCase()];
  if (!month) return null;
  const day = parseInt(dayNum, 10);
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  if (candidate < yesterday) year += 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function urgency(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(dateStr + 'T00:00:00'); due.setHours(0, 0, 0, 0);
  const diff  = Math.round((due - today) / 86400000);
  if (diff <= 0) return { label: "Aujourd'hui", cls: 'urgency-today' };
  if (diff <= 2) return { label: 'Bientôt',     cls: 'urgency-soon'  };
  return { label: `J+${diff}`, cls: 'urgency-later' };
}

function formatDateLong(str) {
  return new Date(str + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function isDST(lines) {
  return lines.some(l => /\bDST\b|devoir\s+sur\s+table|évaluation\s+tp/i.test(l));
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getYouTubeID(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── Parser Pronote ─────────────────────────────────────────────────────────────

function parsePronote(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];
  let currentDate = null, currentSubjectRaw = null, currentLines = [];

  function flush() {
    if (!currentDate || !currentSubjectRaw || currentLines.length === 0) return;
    results.push({
      id: Date.now() + Math.floor(Math.random() * 10000),
      date: currentDate,
      matiere: detectSubject(currentSubjectRaw),
      matiereRaw: currentSubjectRaw,
      lines: [...currentLines],
      links: [],
      done: false,
    });
    currentLines = [];
  }

  for (const line of lines) {
    const dateMatch = line.match(/pour\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+(\w+)/i);
    if (dateMatch) {
      flush(); currentSubjectRaw = null;
      currentDate = resolveDate(dateMatch[1], dateMatch[2]);
      continue;
    }
    const cleaned = line.replace(/^\*+\s*/, '').trim();
    const isMat = /^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜÇŒÆ\s\-&'0-9LV]+$/.test(cleaned)
      && cleaned.length >= 3 && cleaned.length < 65
      && !SKIP_RX.some(rx => rx.test(cleaned));
    if (isMat && currentDate) { flush(); currentSubjectRaw = cleaned; continue; }
    if (SKIP_RX.some(rx => rx.test(cleaned))) continue;
    if (currentDate && currentSubjectRaw && cleaned) currentLines.push(cleaned);
  }
  flush();
  return results;
}

// ── Import Pronote ─────────────────────────────────────────────────────────────

function openImportSheet() {
  document.getElementById('importSheetOverlay').classList.add('open');
  document.getElementById('importSheet').classList.add('open');
}

function closeImportSheet() {
  document.getElementById('importSheetOverlay').classList.remove('open');
  document.getElementById('importSheet').classList.remove('open');
}

function importPronote() {
  const text = document.getElementById('pronoteInput').value;
  const parsed = parsePronote(text);
  const fb = document.getElementById('importFeedback');
  if (parsed.length === 0) {
    fb.textContent = 'Aucun devoir détecté.';
    fb.className = 'import-feedback err';
    return;
  }
  let added = 0;
  for (const p of parsed) {
    const key = p.date + p.matiere + (p.lines[0] || '');
    if (!devoirs.some(d => d.date + d.matiere + (d.lines[0] || '') === key)) {
      devoirs.push(p); added++;
    }
  }
  save(); render();
  fb.textContent = `${added} devoir(s) importé(s).`;
  fb.className = 'import-feedback ok';
  document.getElementById('pronoteInput').value = '';
  setTimeout(() => { closeImportSheet(); fb.textContent = ''; }, 1500);
}

function clearAll() {
  if (!confirm('Effacer tous les devoirs ?')) return;
  devoirs = []; save(); render(); closeImportSheet();
}

// ── Export / Import JSON ───────────────────────────────────────────────────────

function exportDevoirs() {
  const blob = new Blob([JSON.stringify(devoirs, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'devoirs-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importDevoirs() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error();
        let added = 0;
        imported.forEach(d => {
          if (!devoirs.some(x => x.id === d.id)) { devoirs.push(d); added++; }
        });
        save(); render();
      } catch { alert('Fichier invalide.'); }
    };
    reader.readAsText(file);
  });
  input.click();
}

// ── Filtres ────────────────────────────────────────────────────────────────────

function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (f === 'all') document.getElementById('navAll').classList.add('active');
  render();
}

// ── Edit modal (sheet) ────────────────────────────────────────────────────────

function openEditModal(id) {
  editingDevoir = devoirs.find(x => x.id === Number(id));
  if (!editingDevoir) return;
  document.getElementById('editModalTitle').textContent = editingDevoir.matiereRaw || SUBJECT_LABELS[editingDevoir.matiere];
  document.getElementById('editLines').value = editingDevoir.lines.join('\n');
  renderLinkRows(editingDevoir.links || []);
  document.getElementById('editSheetOverlay').classList.add('open');
  document.getElementById('editSheet').classList.add('open');
}

function closeEditModal() {
  document.getElementById('editSheetOverlay').classList.remove('open');
  document.getElementById('editSheet').classList.remove('open');
  editingDevoir = null;
}

function saveEdit() {
  if (!editingDevoir) return;
  editingDevoir.lines = document.getElementById('editLines').value.split('\n').map(l => l.trim()).filter(Boolean);
  editingDevoir.links = collectLinks();
  save(); render(); closeEditModal();
}

// ── Liens ─────────────────────────────────────────────────────────────────────

function renderLinkRows(links) {
  const container = document.getElementById('editLinks');
  container.innerHTML = '';
  links.forEach((lk, i) => container.appendChild(makeLinkRow(lk.label, lk.url, i)));
}

function makeLinkRow(label, url, idx) {
  const row = document.createElement('div');
  row.className = 'link-row';
  row.dataset.idx = idx;

  const labelInput = document.createElement('input');
  labelInput.type = 'text'; labelInput.placeholder = 'Nom du lien';
  labelInput.value = label || ''; labelInput.dataset.field = 'label';

  const urlInput = document.createElement('input');
  urlInput.type = 'url'; urlInput.placeholder = 'Colle une URL…';
  urlInput.value = url || ''; urlInput.dataset.field = 'url';

  const loader = document.createElement('span');
  loader.className = 'link-loader'; loader.textContent = '…'; loader.hidden = true;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'link-remove'; removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => row.remove());

  urlInput.addEventListener('blur', () => fetchLinkTitle(urlInput, labelInput, loader));
  urlInput.addEventListener('paste', () => setTimeout(() => fetchLinkTitle(urlInput, labelInput, loader), 50));

  row.appendChild(removeBtn);
  row.appendChild(labelInput);
  row.appendChild(loader);
  row.appendChild(urlInput);
  return row;
}

async function fetchLinkTitle(urlInput, labelInput, loader) {
  const url = urlInput.value.trim();
  if (!url || labelInput.value.trim()) return;
  if (!url.startsWith('http')) return;

  if (url.includes('lumni.fr')) {
    const slug = url.split('/').filter(Boolean).pop().split('?')[0];
    if (slug) labelInput.value = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return;
  }

  loader.hidden = false;
  try {
    const ytId = getYouTubeID(url);
    if (ytId) {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`);
      if (res.ok) { const data = await res.json(); labelInput.value = data.title; loader.hidden = true; return; }
    }
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      const match = data.contents.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (match) labelInput.value = match[1].trim().slice(0, 80);
    }
  } catch { /* silencieux */ } finally { loader.hidden = true; }
}

function addLinkRow() {
  const container = document.getElementById('editLinks');
  const row = makeLinkRow('', '', container.children.length);
  container.appendChild(row);
  row.querySelector('[data-field="url"]').focus();
}

function collectLinks() {
  return [...document.querySelectorAll('#editLinks .link-row')]
    .map(row => ({ label: row.querySelector('[data-field="label"]').value.trim(), url: row.querySelector('[data-field="url"]').value.trim() }))
    .filter(lk => lk.url);
}

// ── Calendrier custom ─────────────────────────────────────────────────────────

function openDatePopup(id) {
  editingId = Number(id);
  const d = devoirs.find(x => x.id === editingId);
  if (!d) return;
  const current = new Date(d.date + 'T00:00:00');
  calYear = current.getFullYear();
  calMonth = current.getMonth();
  calSelectedDate = d.date;
  renderCalendar();
  document.getElementById('calSheetOverlay').classList.add('open');
  document.getElementById('calSheet').classList.add('open');
}

function closeDatePopup() {
  document.getElementById('calSheetOverlay').classList.remove('open');
  document.getElementById('calSheet').classList.remove('open');
  editingId = null;
}

function renderCalendar() {
  document.getElementById('calMonthLabel').textContent = MONTHS_LABELS[calMonth] + ' ' + calYear;
  const todayStr   = new Date().toISOString().split('T')[0];
  const devoirDates = new Set(devoirs.map(d => d.date));
  let startDow = new Date(calYear, calMonth, 1).getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const container = document.getElementById('calDays');
  container.innerHTML = '';
  for (let i = 0; i < startDow; i++) {
    const e = document.createElement('div'); e.className = 'cal-day other-month'; container.appendChild(e);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const btn = document.createElement('button');
    btn.className = 'cal-day'; btn.textContent = d;
    if (dateStr === todayStr)        btn.classList.add('today');
    if (dateStr === calSelectedDate) btn.classList.add('selected');
    if (devoirDates.has(dateStr))    btn.classList.add('has-devoir');
    btn.addEventListener('click', () => {
      const dv = devoirs.find(x => x.id === Number(editingId));
      if (dv) { dv.date = dateStr; save(); render(); }
      closeDatePopup();
    });
    container.appendChild(btn);
  }
  document.getElementById('calPrev').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); };
  document.getElementById('calNext').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); };
}

// ── Actions cartes ─────────────────────────────────────────────────────────────

function deleteDevoir(id) {
  devoirs = devoirs.filter(x => x.id !== Number(id));
  save(); render();
}

// ── Rendu ─────────────────────────────────────────────────────────────────────

function render() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('statTotal').textContent  = devoirs.length;
  document.getElementById('statToday').textContent  = devoirs.filter(d => d.date === today).length;
  document.getElementById('statUrgent').textContent = devoirs.filter(d => { const u = urgency(d.date); return u.cls !== 'urgency-later'; }).length;

  // Filtres
  const subjects = [...new Set(devoirs.map(d => d.matiere))];
  const filtersEl = document.getElementById('filters');
  filtersEl.innerHTML = `<button class="filter-pill ${activeFilter==='all'?'active':''}" onclick="setFilter('all')">Tout</button>`;
  subjects.forEach(s => {
    const active = activeFilter === s;
    const color  = SUBJECT_COLORS[s] || SUBJECT_COLORS.other;
    filtersEl.innerHTML += `<button class="filter-pill ${active?'active':''}" onclick="setFilter('${s}')"
      style="${active ? `border-color:${color};color:${color}` : ''}">${SUBJECT_LABELS[s] || s}</button>`;
  });

  let filtered = activeFilter === 'all' ? devoirs : devoirs.filter(d => d.matiere === activeFilter);
  filtered = [...filtered].sort((a, b) => a.date.localeCompare(b.date));

  const groups = {};
  filtered.forEach(d => { if (!groups[d.date]) groups[d.date] = []; groups[d.date].push(d); });

  const listEl = document.getElementById('devoirsList');
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty"><div class="empty-icon">📚</div>Aucun devoir.<br>Importe depuis Pronote pour commencer.</div>`;
    return;
  }

  listEl.innerHTML = Object.entries(groups).map(([date, items]) => {
    const u = urgency(date);
    return `
    <div class="day-group">
      <div class="day-label">
        <span class="day-label-text">${formatDateLong(date)}</span>
        ${u.cls !== 'urgency-later' ? `<span class="urgency-badge ${u.cls}">${u.label}</span>` : ''}
      </div>
      <div class="devoirs-list">
        ${items.map(d => {
          const color = SUBJECT_COLORS[d.matiere] || SUBJECT_COLORS.other;
          const dst   = isDST(d.lines);
          const u2    = urgency(d.date);
          return `
          <div class="devoir-card" style="--subject-color:${color}">
            <div class="devoir-check" onclick="deleteDevoir(${d.id})" title="Supprimer">
              <svg class="check-icon" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
            </div>
            <div>
              <div class="devoir-subject">
                ${escHtml(d.matiereRaw || SUBJECT_LABELS[d.matiere])}
                ${dst ? '<span class="dst-badge">DST</span>' : ''}
              </div>
              <div class="devoir-lines">
                ${d.lines.map(l => `<div class="devoir-line">${escHtml(l)}</div>`).join('')}
              </div>
              ${(d.links && d.links.length) ? `
              <div class="devoir-links">
                ${d.links.map(lk => `
                  <a class="devoir-link-item" href="${escHtml(lk.url)}" target="_blank" rel="noopener">
                    <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                    ${escHtml(lk.label || lk.url)}
                  </a>`).join('')}
              </div>` : ''}
              <div class="card-actions">
                <button class="card-action-btn" onclick="openDatePopup(${d.id})">
                  <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Déplacer
                </button>
                <button class="card-action-btn" onclick="openEditModal(${d.id})">
                  <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Modifier
                </button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('dateToday').textContent = new Date().toLocaleDateString('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

render();
