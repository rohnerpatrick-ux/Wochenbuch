/* ---------- Persistenz ---------- */
const STORAGE_KEY = 'wochenbuch_data';

const WEEKDAY_KEYS = ['Mon','Tue','Wed','Thu','Fri'];
const WEEKDAY_LABEL = {Mon:'Montag', Tue:'Dienstag', Wed:'Mittwoch', Thu:'Donnerstag', Fri:'Freitag'};
const WEEKDAY_LABEL_SHORT = {Mon:'Mo', Tue:'Di', Wed:'Mi', Thu:'Do', Fri:'Fr'};
const STATUS_LABEL = {normal:'Normal', supplierung:'Supplierung', entfall:'Entfall', krankheit:'Krankheit'};

function emptyConfig(){
  return {
    periodsCount: 8,
    weeks: {
      A: Object.fromEntries(WEEKDAY_KEYS.map(d=>[d, Array.from({length:8},()=>({subject:'',klasse:''}))])),
      B: Object.fromEntries(WEEKDAY_KEYS.map(d=>[d, Array.from({length:8},()=>({subject:'',klasse:''}))]))
    },
    syncedPeriods: Array.from({length:8}, ()=>false),
    referenceDate: null,
    referenceWeekType: 'A'
  };
}

function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return {config: emptyConfig(), overrides:{}, weekOverrides:{}, entries:{}};
    const parsed = JSON.parse(raw);
    parsed.config = parsed.config || emptyConfig();
    if(!parsed.config.syncedPeriods) parsed.config.syncedPeriods = Array.from({length:parsed.config.periodsCount}, ()=>false);
    parsed.overrides = parsed.overrides || {};
    parsed.weekOverrides = parsed.weekOverrides || {};
    parsed.entries = parsed.entries || {};
    return parsed;
  }catch(e){
    console.error('Ladefehler', e);
    return {config: emptyConfig(), overrides:{}, weekOverrides:{}, entries:{}};
  }
}

let DATA = loadData();

function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
}

/* ---------- Datumshilfen ---------- */
function toDateStr(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function fromDateStr(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function getMonday(dateStr){
  const d = fromDateStr(dateStr);
  const dow = d.getDay(); // 0 So .. 6 Sa
  const diff = (dow === 0 ? -6 : 1 - dow);
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}
function addDays(dateStr, n){
  const d = fromDateStr(dateStr);
  d.setDate(d.getDate()+n);
  return toDateStr(d);
}
function formatLong(dateStr){
  const d = fromDateStr(dateStr);
  const dow = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'][d.getDay()];
  return dow + ', ' + d.toLocaleDateString('de-AT', {day:'numeric', month:'long', year:'numeric'});
}

/* ---------- AB-Wochenlogik ---------- */
function getWeekType(dateStr){
  const dayOverride = DATA.overrides[dateStr];
  if(dayOverride && dayOverride.type === 'holiday') return null;

  const mondayStr = toDateStr(getMonday(dateStr));
  if(DATA.weekOverrides[mondayStr]) return DATA.weekOverrides[mondayStr];

  if(!DATA.config.referenceDate) return null;
  const refMonday = getMonday(DATA.config.referenceDate);
  const thisMonday = getMonday(dateStr);
  const weeksDiff = Math.round((thisMonday - refMonday) / (7*86400000));
  const isEven = weeksDiff % 2 === 0;
  const refType = DATA.config.referenceWeekType;
  return isEven ? refType : (refType === 'A' ? 'B' : 'A');
}

function getScheduleForDate(dateStr){
  const d = fromDateStr(dateStr);
  const dow = d.getDay();
  if(dow === 0 || dow === 6) return {periods: [], weekType: null, holiday:false, weekend:true};

  const override = DATA.overrides[dateStr];
  if(override && override.type === 'customDay'){
    const periods = override.periods
      .map((p,i)=>({index:i+1, subject:p.subject, klasse:p.klasse}))
      .filter(p=>p.subject && p.subject.trim() !== '');
    return {periods, weekType: getWeekType(dateStr), holiday:false, weekend:false, custom:true};
  }
  if(override && override.type === 'holiday'){
    return {periods: [], weekType: null, holiday:true, weekend:false};
  }

  const weekType = getWeekType(dateStr);
  if(!weekType) return {periods: [], weekType:null, holiday:false, weekend:false, noConfig:true};

  const weekdayKey = WEEKDAY_KEYS[dow-1];
  const arr = (DATA.config.weeks[weekType] && DATA.config.weeks[weekType][weekdayKey]) || [];
  const periods = arr
    .map((p,i)=>({index:i+1, subject:p.subject, klasse:p.klasse}))
    .filter(p=>p.subject && p.subject.trim() !== '');
  return {periods, weekType, holiday:false, weekend:false};
}

/* ---------- Sprach­eingabe ---------- */
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_SUPPORTED = !!SpeechRecognitionAPI;

function attachMic(button, textarea){
  if(!SPEECH_SUPPORTED){ button.style.display = 'none'; return; }
  let recognizing = false;
  let recognition;

  button.addEventListener('click', ()=>{
    if(recognizing){ recognition && recognition.stop(); return; }
    recognition = new SpeechRecognitionAPI();
    recognition.lang = 'de-AT';
    recognition.interimResults = true;
    recognition.continuous = false;

    const startVal = textarea.value;
    const sep = startVal.trim() ? ' ' : '';

    recognition.onstart = ()=>{ recognizing = true; button.classList.add('listening'); };
    recognition.onerror = ()=>{ recognizing = false; button.classList.remove('listening'); };
    recognition.onend = ()=>{ recognizing = false; button.classList.remove('listening'); textarea.dispatchEvent(new Event('change')); };
    recognition.onresult = (event)=>{
      let transcript = '';
      for(let i=0;i<event.results.length;i++){
        transcript += event.results[i][0].transcript;
      }
      textarea.value = startVal + sep + transcript;
    };
    recognition.start();
  });
}

/* ---------- View-Router ---------- */
const app = document.getElementById('app');
const tabs = document.getElementById('tabs');
let currentView = 'today';
let currentDate = toDateStr(new Date());
let currentWeekMonday = toDateStr(getMonday(currentDate));

tabs.addEventListener('click', (e)=>{
  const btn = e.target.closest('.tab');
  if(!btn) return;
  [...tabs.children].forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  currentView = btn.dataset.view;
  render();
});

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  setTimeout(()=>{ t.hidden = true; }, 1800);
}

function render(){
  if(currentView === 'today') renderToday();
  else if(currentView === 'week') renderWeek();
  else if(currentView === 'setup') renderSetup();
}

/* ---------- Heute-Ansicht ---------- */
let customEditMode = false;

function renderToday(){
  customEditMode = false;
  drawToday();
}

function drawToday(){
  const sched = getScheduleForDate(currentDate);
  const hasConfig = DATA.config.referenceDate && DATA.config.weeks;
  let html = '';

  html += `<div class="date-heading">
    <div>
      <div class="eyebrow">Tag</div>
      <h2>${formatLong(currentDate)}</h2>
    </div>
    ${sched.weekType ? `<span class="weektype-pill">${sched.weekType}-Woche</span>` : ''}
  </div>`;

  html += `<div class="btn-row" style="margin-top:-6px;margin-bottom:16px;">
    <button class="btn ghost small" id="prevDay">&larr; Vortag</button>
    <button class="btn ghost small" id="todayBtn">Heute</button>
    <button class="btn ghost small" id="nextDay">Nächster Tag &rarr;</button>
  </div>`;

  if(!hasConfig){
    html += `<div class="empty-state card">
      <h3>Noch kein Stundenplan hinterlegt</h3>
      <p>Leg zuerst unter „Einrichten“ deinen A/B-Stundenplan an.</p>
    </div>`;
    app.innerHTML = html;
    document.getElementById('prevDay').onclick = ()=>{ currentDate = addDays(currentDate,-1); drawToday(); };
    document.getElementById('nextDay').onclick = ()=>{ currentDate = addDays(currentDate,1); drawToday(); };
    document.getElementById('todayBtn').onclick = ()=>{ currentDate = toDateStr(new Date()); drawToday(); };
    return;
  }

  if(sched.weekend){
    html += `<div class="empty-state card"><h3>Wochenende</h3><p>Keine Einträge nötig.</p></div>`;
  } else if(sched.holiday){
    html += `<div class="empty-state card"><h3>Als schulfrei markiert</h3><p>Für diesen Tag wird kein Unterricht abgefragt.
      <br><button class="btn ghost small" id="undoHoliday" style="margin-top:10px;">Als Schultag markieren</button></p></div>`;
  } else if(sched.periods.length === 0 && !customEditMode){
    html += `<div class="empty-state card">
      <h3>Keine Stunden für diesen Tag hinterlegt</h3>
      <p>Entweder ein freier Tag, oder der Stundenplan für diesen Wochentag ist noch leer.</p>
      <button class="btn secondary small" id="openCustom" style="margin-top:8px;">Tag manuell eintragen</button>
    </div>`;
  } else {
    const entriesForDay = DATA.entries[currentDate] || {};
    const doneCount = sched.periods.filter(p=>entriesForDay[p.index] && entriesForDay[p.index].text).length;
    html += `<p class="muted" style="margin-bottom:10px;">${doneCount} / ${sched.periods.length} Stunden eingetragen</p>`;

    sched.periods.forEach(p=>{
      const entry = entriesForDay[p.index] || {status:'normal', text:'', subSubject:'', subKlasse:''};
      const isSup = entry.status === 'supplierung';
      html += `
      <div class="period" data-period="${p.index}">
        <div class="period-head">
          <span class="period-num">${p.index}.</span>
          <div class="period-meta">
            <div class="period-subject">${p.subject}</div>
            <div class="period-class">${p.klasse || ''}</div>
          </div>
          ${entry.text ? '<span class="period-done-badge">&#10003; erfasst</span>' : ''}
        </div>
        <div class="status-row">
          ${Object.entries(STATUS_LABEL).map(([key,label])=>`
            <button class="status-btn ${entry.status===key?'selected':''}" data-status="${key}">${label}</button>
          `).join('')}
        </div>
        <div class="sub-fields ${isSup ? 'visible' : ''}">
          <input type="text" placeholder="Fach (Supplierung)" class="subSubject" value="${entry.subSubject||''}">
          <input type="text" placeholder="Klasse" class="subKlasse" value="${entry.subKlasse||''}">
        </div>
        <div class="entry-row">
          <textarea placeholder="Was wurde gemacht? …sprich einfach los.">${entry.text||''}</textarea>
          <button class="mic-btn" title="Diktieren">&#127908;</button>
        </div>
      </div>`;
    });

    if(!SPEECH_SUPPORTED){
      html += `<p class="muted">Spracheingabe per Tasten-Symbol wird von diesem Browser nicht unterstützt. Tippe stattdessen kurz ins Feld und nutze das Mikrofon-Symbol auf deiner Tastatur (bei iPhone/Safari Standard).</p>`;
    }

    html += `<div class="btn-row">
      <button class="btn ghost small" id="openCustom">Diesen Tag anpassen</button>
      <button class="btn ghost small" id="markHoliday">Als schulfrei markieren</button>
    </div>`;
  }

  if(customEditMode){
    html += renderCustomEditor();
  }

  app.innerHTML = html;
  bindTodayEvents(sched);
}

function renderCustomEditor(){
  const sched = getScheduleForDate(currentDate);
  const count = DATA.config.periodsCount;
  const base = [];
  for(let i=1;i<=count;i++){
    const existing = sched.periods.find(p=>p.index===i);
    base.push(existing || {index:i, subject:'', klasse:''});
  }
  return `
  <div class="card">
    <h3 style="margin-bottom:10px;">Stundenplan nur für diesen Tag anpassen</h3>
    <p class="muted" style="margin-bottom:12px;">Für Fenstertage, Feiertagsverschiebungen o.ä. Gilt nur für ${formatLong(currentDate)}.</p>
    <table class="grid-table">
      <tr><th>Std.</th><th>Fach</th><th>Klasse</th></tr>
      ${base.map(p=>`
        <tr>
          <td>${p.index}</td>
          <td><input type="text" class="ce-subject" data-idx="${p.index}" value="${p.subject||''}" placeholder="–"></td>
          <td><input type="text" class="ce-klasse" data-idx="${p.index}" value="${p.klasse||''}" placeholder="–"></td>
        </tr>
      `).join('')}
    </table>
    <div class="btn-row">
      <button class="btn small" id="saveCustom">Speichern</button>
      <button class="btn ghost small" id="cancelCustom">Abbrechen</button>
    </div>
  </div>`;
}

function bindTodayEvents(sched){
  const prevBtn = document.getElementById('prevDay');
  const nextBtn = document.getElementById('nextDay');
  const todayBtn = document.getElementById('todayBtn');
  if(prevBtn) prevBtn.onclick = ()=>{ currentDate = addDays(currentDate,-1); customEditMode=false; drawToday(); };
  if(nextBtn) nextBtn.onclick = ()=>{ currentDate = addDays(currentDate,1); customEditMode=false; drawToday(); };
  if(todayBtn) todayBtn.onclick = ()=>{ currentDate = toDateStr(new Date()); customEditMode=false; drawToday(); };

  const openCustom = document.getElementById('openCustom');
  if(openCustom) openCustom.onclick = ()=>{ customEditMode = true; drawToday(); };
  const cancelCustom = document.getElementById('cancelCustom');
  if(cancelCustom) cancelCustom.onclick = ()=>{ customEditMode = false; drawToday(); };
  const saveCustom = document.getElementById('saveCustom');
  if(saveCustom) saveCustom.onclick = ()=>{
    const subjects = [...document.querySelectorAll('.ce-subject')];
    const periods = subjects.map(inp=>{
      const idx = inp.dataset.idx;
      const klasseInp = document.querySelector(`.ce-klasse[data-idx="${idx}"]`);
      return {subject: inp.value.trim(), klasse: klasseInp.value.trim()};
    });
    DATA.overrides[currentDate] = {type:'customDay', periods};
    saveData();
    customEditMode = false;
    showToast('Tag angepasst');
    drawToday();
  };

  const markHoliday = document.getElementById('markHoliday');
  if(markHoliday) markHoliday.onclick = ()=>{
    DATA.overrides[currentDate] = {type:'holiday'};
    saveData();
    drawToday();
  };
  const undoHoliday = document.getElementById('undoHoliday');
  if(undoHoliday) undoHoliday.onclick = ()=>{
    delete DATA.overrides[currentDate];
    saveData();
    drawToday();
  };

  document.querySelectorAll('.period').forEach(el=>{
    const idx = el.dataset.period;
    const textarea = el.querySelector('textarea');
    const micBtn = el.querySelector('.mic-btn');
    const subFields = el.querySelector('.sub-fields');
    if(micBtn && textarea) attachMic(micBtn, textarea);

    function getEntry(){
      if(!DATA.entries[currentDate]) DATA.entries[currentDate] = {};
      if(!DATA.entries[currentDate][idx]) DATA.entries[currentDate][idx] = {status:'normal', text:'', subSubject:'', subKlasse:''};
      return DATA.entries[currentDate][idx];
    }

    el.querySelectorAll('.status-btn').forEach(btn=>{
      btn.onclick = ()=>{
        const entry = getEntry();
        entry.status = btn.dataset.status;
        saveData();
        if(entry.status === 'supplierung'){
          subFields.classList.add('visible');
        } else {
          subFields.classList.remove('visible');
        }
        el.querySelectorAll('.status-btn').forEach(b=>b.classList.toggle('selected', b===btn));
      };
    });

    if(textarea){
      const commit = ()=>{
        const entry = getEntry();
        entry.text = textarea.value;
        saveData();
      };
      textarea.addEventListener('blur', commit);
      textarea.addEventListener('change', commit);
    }

    const subSubject = el.querySelector('.subSubject');
    const subKlasse = el.querySelector('.subKlasse');
    if(subSubject) subSubject.addEventListener('blur', ()=>{ getEntry().subSubject = subSubject.value; saveData(); });
    if(subKlasse) subKlasse.addEventListener('blur', ()=>{ getEntry().subKlasse = subKlasse.value; saveData(); });
  });
}

/* ---------- Wochen-Ansicht ---------- */
function renderWeek(){
  let html = `<div class="week-nav">
    <button class="btn ghost small" id="prevWeek">&larr; Woche</button>
    <div class="eyebrow" id="weekLabel"></div>
    <button class="btn ghost small" id="nextWeek">Woche &rarr;</button>
  </div>`;

  WEEKDAY_KEYS.forEach((dk,i)=>{
    const dateStr = addDays(currentWeekMonday, i);
    const sched = getScheduleForDate(dateStr);
    const entriesForDay = DATA.entries[dateStr] || {};
    html += `<div class="week-day-block card">
      <div class="week-day-title">${WEEKDAY_LABEL[dk]}, ${fromDateStr(dateStr).toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit'})}
        ${sched.weekType ? `<span class="weektype-pill" style="font-size:.68rem;">${sched.weekType}</span>` : ''}
        ${sched.holiday ? '<span class="override-tag">schulfrei</span>' : ''}
      </div>`;
    if(sched.periods.length === 0){
      html += `<p class="muted">— keine Stunden —</p>`;
    } else {
      sched.periods.forEach(p=>{
        const e = entriesForDay[p.index];
        const statusTag = e && e.status !== 'normal' ? `<span class="override-tag">${STATUS_LABEL[e.status]}</span>` : '';
        html += `<div class="week-entry">
          <span class="num">${p.index}.</span>
          <span>
            <strong>${p.subject}</strong> ${p.klasse||''} ${statusTag}<br>
            <span class="muted">${e && e.text ? e.text : '– nicht eingetragen –'}</span>
          </span>
        </div>`;
      });
    }
    html += `</div>`;
  });

  html += `<div class="btn-row">
    <button class="btn secondary small" id="exportCsv">Als CSV exportieren (ganzes Schuljahr)</button>
    <button class="btn ghost small" id="exportJson">Sicherung speichern (JSON)</button>
    <button class="btn ghost small" id="importJsonBtn">Sicherung laden (JSON)</button>
    <input type="file" id="importFile" accept="application/json" style="display:none;">
  </div>
  <p class="muted" style="margin-top:8px;">Tipp: Stundenplan bequem am Laptop unter „Einrichten“ eintippen, hier als JSON sichern, Datei aufs Handy schicken (z.&nbsp;B. per Mail) und dort über „Sicherung laden“ einlesen.</p>`;

  app.innerHTML = html;
  const mondayDate = fromDateStr(currentWeekMonday);
  const sundayDate = addDays(currentWeekMonday,4);
  document.getElementById('weekLabel').textContent =
    mondayDate.toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit'}) + ' – ' +
    fromDateStr(sundayDate).toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit',year:'numeric'});

  document.getElementById('prevWeek').onclick = ()=>{ currentWeekMonday = addDays(currentWeekMonday,-7); renderWeek(); };
  document.getElementById('nextWeek').onclick = ()=>{ currentWeekMonday = addDays(currentWeekMonday,7); renderWeek(); };
  document.getElementById('exportCsv').onclick = exportCsv;
  document.getElementById('exportJson').onclick = exportJson;
  document.getElementById('importJsonBtn').onclick = ()=> document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    importJson(file);
  };
}

/* ---------- Export ---------- */
function exportCsv(){
  const rows = [['Datum','Wochentag','Woche','Stunde','Fach','Klasse','Status','Supplierung Fach','Supplierung Klasse','Eintrag']];
  Object.keys(DATA.entries).sort().forEach(dateStr=>{
    const sched = getScheduleForDate(dateStr);
    const entriesForDay = DATA.entries[dateStr];
    Object.keys(entriesForDay).forEach(idx=>{
      const e = entriesForDay[idx];
      if(!e.text && e.status === 'normal') return;
      const p = sched.periods.find(pp=>String(pp.index)===String(idx)) || {subject:'',klasse:''};
      const d = fromDateStr(dateStr);
      const wd = ['So','Mo','Di','Mi','Do','Fr','Sa'][d.getDay()];
      rows.push([dateStr, wd, sched.weekType||'', idx, p.subject, p.klasse, STATUS_LABEL[e.status]||e.status, e.subSubject||'', e.subKlasse||'', (e.text||'').replace(/\n/g,' ')]);
    });
  });
  const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  downloadFile('wochenbuch.csv', csv, 'text/csv;charset=utf-8');
  showToast('CSV exportiert');
}
function exportJson(){
  downloadFile('wochenbuch_backup.json', JSON.stringify(DATA, null, 2), 'application/json');
  showToast('Sicherung erstellt');
}
function importJson(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!parsed.config){ showToast('Ungültige Datei'); return; }
      const proceed = confirm('Bestehende Daten auf diesem Gerät werden durch die Sicherung ersetzt. Fortfahren?');
      if(!proceed) return;
      parsed.overrides = parsed.overrides || {};
      parsed.weekOverrides = parsed.weekOverrides || {};
      parsed.entries = parsed.entries || {};
      if(!parsed.config.syncedPeriods) parsed.config.syncedPeriods = Array.from({length:parsed.config.periodsCount}, ()=>false);
      DATA = parsed;
      saveData();
      showToast('Sicherung geladen');
      render();
    }catch(err){
      showToast('Datei konnte nicht gelesen werden');
    }
  };
  reader.readAsText(file);
}
function downloadFile(filename, content, mime){
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- Einrichten-Ansicht ---------- */
let setupWeekType = 'A';

function renderSetup(){
  const cfg = DATA.config;
  let html = `
  <div class="card">
    <h3 style="margin-bottom:12px;">Grundeinstellungen</h3>
    <div class="field">
      <label>Anzahl Stunden pro Tag</label>
      <input type="number" id="periodsCount" min="1" max="12" value="${cfg.periodsCount}">
    </div>
    <div class="field">
      <label>Referenzdatum (ein Montag)</label>
      <input type="date" id="refDate" value="${cfg.referenceDate || ''}">
      <div class="field-hint">Wähle einen Montag und gib an, ob das die A- oder B-Woche ist. Alle anderen Wochen werden automatisch daraus berechnet.</div>
    </div>
    <div class="field">
      <label>Wochentyp an diesem Montag</label>
      <select id="refType">
        <option value="A" ${cfg.referenceWeekType==='A'?'selected':''}>A-Woche</option>
        <option value="B" ${cfg.referenceWeekType==='B'?'selected':''}>B-Woche</option>
      </select>
    </div>
    <button class="btn small" id="saveBasics">Speichern</button>
  </div>

  <div class="card">
    <h3 style="margin-bottom:6px;">Stundenplan</h3>
    <p class="muted" style="margin-bottom:12px;">Trag Fach und Klasse für jede Stunde ein. Leer lassen = keine Stunde.</p>
    <div class="week-toggle">
      <button data-w="A" class="${setupWeekType==='A'?'active':''}">A-Woche</button>
      <button data-w="B" class="${setupWeekType==='B'?'active':''}">B-Woche</button>
    </div>
    <div style="overflow-x:auto;">
    <table class="grid-table" id="scheduleTable">
      <tr><th>Std.</th>${WEEKDAY_KEYS.map(dk=>`<th>${WEEKDAY_LABEL_SHORT[dk]}</th>`).join('')}</tr>
      ${renderScheduleRows(setupWeekType)}
    </table>
    </div>
    <button class="btn small" id="saveSchedule" style="margin-top:12px;">Stundenplan speichern</button>
  </div>

  <div class="card">
    <h3 style="margin-bottom:6px;">Wochentyp-Kalender</h3>
    <p class="muted" style="margin-bottom:12px;">Falls sich der A/B-Rhythmus mal verschiebt (z.&nbsp;B. wegen Ferien): hier für eine ganze Kalenderwoche A oder B festlegen. Gilt dann für Mo–Fr dieser Woche.</p>
    <div class="field-row" style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
      <div class="field" style="flex:1; min-width:140px; margin-bottom:0;">
        <label>Ein beliebiger Tag in dieser Woche</label>
        <input type="date" id="weekOvDate">
      </div>
      <div class="field" style="min-width:110px; margin-bottom:0;">
        <label>Wochentyp</label>
        <select id="weekOvValue"><option value="A">A-Woche</option><option value="B">B-Woche</option></select>
      </div>
      <button class="btn small" id="addWeekOverride">Festlegen</button>
    </div>
    <div id="weekOverrideList" style="margin-top:14px;"></div>
  </div>

  <div class="card">
    <h3 style="margin-bottom:6px;">Schulfreie Tage &amp; Ferien</h3>
    <p class="muted" style="margin-bottom:12px;">Einzelner Feiertag oder ganzer Ferienzeitraum – an diesen Tagen wird nichts abgefragt.</p>
    <div class="field-row" style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
      <div class="field" style="flex:1; min-width:120px; margin-bottom:0;">
        <label>Von</label>
        <input type="date" id="holFrom">
      </div>
      <div class="field" style="flex:1; min-width:120px; margin-bottom:0;">
        <label>Bis (optional, für Ferien)</label>
        <input type="date" id="holTo">
      </div>
      <button class="btn small" id="addHoliday">Als schulfrei markieren</button>
    </div>
    <div id="overrideList" style="margin-top:14px;"></div>
    <p class="field-hint">Einzelne Tage mit individuellem Plan (z.&nbsp;B. Fenstertag) kannst du direkt in der „Heute“-Ansicht über „Diesen Tag anpassen“ eintragen.</p>
  </div>
  `;
  app.innerHTML = html;
  bindSetupEvents();
  renderOverrideList();
  renderWeekOverrideList();
}

function renderScheduleRows(weekType){
  const cfg = DATA.config;
  let rows = '';
  for(let i=0;i<cfg.periodsCount;i++){
    const synced = !!cfg.syncedPeriods[i];
    rows += `<tr class="${synced?'synced-row':''}">`;
    rows += `<td>${i+1}<br><label style="font-weight:400;display:flex;align-items:center;gap:3px;white-space:nowrap;">
      <input type="checkbox" class="sync-toggle" data-idx="${i}" ${synced?'checked':''}> <span style="font-size:.68rem;">A=B</span>
    </label></td>`;
    WEEKDAY_KEYS.forEach(dk=>{
      const arr = cfg.weeks[weekType][dk] || [];
      const p = arr[i] || {subject:'',klasse:''};
      rows += `<td>
        <input type="text" class="sched-subject" data-day="${dk}" data-idx="${i}" placeholder="Fach" value="${p.subject||''}">
        <input type="text" class="sched-klasse" data-day="${dk}" data-idx="${i}" placeholder="Klasse" value="${p.klasse||''}">
      </td>`;
    });
    rows += `</tr>`;
  }
  return rows;
}

function bindSetupEvents(){
  document.getElementById('saveBasics').onclick = ()=>{
    const newCount = parseInt(document.getElementById('periodsCount').value, 10) || 8;
    resizePeriods(newCount);
    DATA.config.referenceDate = document.getElementById('refDate').value || null;
    DATA.config.referenceWeekType = document.getElementById('refType').value;
    saveData();
    showToast('Gespeichert');
    renderSetup();
  };

  document.querySelectorAll('.week-toggle button').forEach(btn=>{
    btn.onclick = ()=>{ setupWeekType = btn.dataset.w; renderSetup(); };
  });

  document.getElementById('saveSchedule').onclick = ()=>{
    const cfg = DATA.config;
    document.querySelectorAll('.sync-toggle').forEach(cb=>{
      cfg.syncedPeriods[parseInt(cb.dataset.idx,10)] = cb.checked;
    });
    document.querySelectorAll('.sched-subject').forEach(inp=>{
      const day = inp.dataset.day, idx = parseInt(inp.dataset.idx,10);
      cfg.weeks[setupWeekType][day][idx].subject = inp.value.trim();
    });
    document.querySelectorAll('.sched-klasse').forEach(inp=>{
      const day = inp.dataset.day, idx = parseInt(inp.dataset.idx,10);
      cfg.weeks[setupWeekType][day][idx].klasse = inp.value.trim();
    });
    // Synchronisierte Stunden in die jeweils andere Woche spiegeln
    const otherType = setupWeekType === 'A' ? 'B' : 'A';
    cfg.syncedPeriods.forEach((isSynced, idx)=>{
      if(!isSynced) return;
      WEEKDAY_KEYS.forEach(dk=>{
        cfg.weeks[otherType][dk][idx] = {...cfg.weeks[setupWeekType][dk][idx]};
      });
    });
    saveData();
    showToast('Stundenplan gespeichert');
    renderSetup();
  };

  document.getElementById('addWeekOverride').onclick = ()=>{
    const date = document.getElementById('weekOvDate').value;
    if(!date){ showToast('Bitte Datum wählen'); return; }
    const mondayStr = toDateStr(getMonday(date));
    DATA.weekOverrides[mondayStr] = document.getElementById('weekOvValue').value;
    saveData();
    renderWeekOverrideList();
    showToast('Wochentyp festgelegt');
  };

  document.getElementById('addHoliday').onclick = ()=>{
    const from = document.getElementById('holFrom').value;
    const to = document.getElementById('holTo').value || from;
    if(!from){ showToast('Bitte Datum wählen'); return; }
    let d = from;
    let guard = 0;
    while(d <= to && guard < 200){
      const dow = fromDateStr(d).getDay();
      if(dow !== 0 && dow !== 6) DATA.overrides[d] = {type:'holiday'};
      d = addDays(d,1);
      guard++;
    }
    saveData();
    renderOverrideList();
    showToast('Als schulfrei markiert');
  };
}

function renderWeekOverrideList(){
  const wrap = document.getElementById('weekOverrideList');
  const entries = Object.entries(DATA.weekOverrides).sort(([a],[b])=>a.localeCompare(b));
  if(entries.length === 0){
    wrap.innerHTML = `<p class="muted">Noch keine Wochen manuell festgelegt – es gilt der automatische Rhythmus ab dem Referenzdatum.</p>`;
    return;
  }
  wrap.innerHTML = entries.map(([monday, type])=>{
    const sunday = addDays(monday,4);
    return `<div class="override-item">
      <span>${fromDateStr(monday).toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit'})} – ${fromDateStr(sunday).toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit',year:'numeric'})} <span class="override-tag">${type}-Woche</span></span>
      <button class="btn ghost small" data-delw="${monday}">Entfernen</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-delw]').forEach(btn=>{
    btn.onclick = ()=>{
      delete DATA.weekOverrides[btn.dataset.delw];
      saveData();
      renderWeekOverrideList();
    };
  });
}

function resizePeriods(newCount){
  const cfg = DATA.config;
  ['A','B'].forEach(wt=>{
    WEEKDAY_KEYS.forEach(dk=>{
      const arr = cfg.weeks[wt][dk];
      while(arr.length < newCount) arr.push({subject:'',klasse:''});
      arr.length = newCount;
    });
  });
  while(cfg.syncedPeriods.length < newCount) cfg.syncedPeriods.push(false);
  cfg.syncedPeriods.length = newCount;
  cfg.periodsCount = newCount;
}

function renderOverrideList(){
  const wrap = document.getElementById('overrideList');
  const entries = Object.entries(DATA.overrides).sort(([a],[b])=>a.localeCompare(b));
  if(entries.length === 0){
    wrap.innerHTML = `<p class="muted">Keine Ausnahmen eingetragen.</p>`;
    return;
  }
  wrap.innerHTML = entries.map(([date, ov])=>{
    let label = ov.type === 'holiday' ? 'Schulfrei' : 'Individueller Tag';
    return `<div class="override-item">
      <span>${fromDateStr(date).toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit',year:'numeric'})} <span class="override-tag">${label}</span></span>
      <button class="btn ghost small" data-del="${date}">Entfernen</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = ()=>{
      delete DATA.overrides[btn.dataset.del];
      saveData();
      renderOverrideList();
    };
  });
}

/* ---------- Start ---------- */
render();

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  });
}
