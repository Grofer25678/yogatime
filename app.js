// yogatime/js/app.js
// Важно: весь код запускается после загрузки DOM, чтобы элементы точно существовали. [web:189]
document.addEventListener('DOMContentLoaded', () => {
  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (!el) return null;
    el.addEventListener(ev, fn);
    return el;
  };
  const qs = (id) => document.getElementById(id);

  // Авторизация приходит из index.php (window.__AUTHED__).
  let isAuthed = (window.__AUTHED__ === true);

  // Данные (как в макете)
  const services = [
    { id:'hatha', title:'Хатха-йога' },
    { id:'nidra', title:'Йога-нидра' },
    { id:'back',  title:'Здоровая спина' }
  ];
  const times = ['09:00','18:30','20:00'];

  // Состояние
  let planned = [];   // подтверждённые записи из БД
  let selected = new Date(); // выбранный день
  let sortMode = 'near';

  // В макете была MIN_DATE. Можно убрать, но оставим, чтобы не уходить "в прошлое".
  const MIN_DATE = '2025-12-19';
  const monthsRu = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

  // ----- helpers -----
  function fmtYMD(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function isBeforeMin(d){ return fmtYMD(d) < MIN_DATE; }

  function cellKey(dateStr, timeStr, serviceId){
    return dateStr + '|' + timeStr + '|' + serviceId;
  }
  function timeKey(dateStr, timeStr){
    return dateStr + '|' + timeStr;
  }

  function openAuth(){
    // Чтобы не городить "фейковую модалку", идём на реальную авторизацию.
    window.location.href = '/yogatime/auth/login.php';
  }

  function showPage(name){
    const home = qs('homePage');
    const cab  = qs('cabinetPage');
    if(!home || !cab) return;

    if(name === 'cabinet'){
      if(!isAuthed){ openAuth(); return; }
      home.classList.remove('active');
      cab.classList.add('active');
      window.scrollTo({top:0, behavior:'smooth'});
      updateDayUI();
      loadMyBookings();
    } else {
      cab.classList.remove('active');
      home.classList.add('active');
      window.scrollTo({top:0, behavior:'smooth'});
    }
  }

  function cell(text, cls){
    const d = document.createElement('div');
    d.className = 'cell ' + (cls || '');
    d.textContent = text;
    return d;
  }

  function resetBasketKeepHint(){
    const basketZone = qs('basketZone');
    if(!basketZone) return;
    basketZone.innerHTML = `
      <div class="dropHint" id="dropHint">
        <div class="dropHintTitle">Перетаскивай сюда</div>
        <div class="small">Выбери занятие из таблицы слева и перетащи в этот блок.</div>
      </div>
    `;
    refreshDropHint();
  }

  function refreshDropHint(){
    const basketZone = qs('basketZone');
    const hint = qs('dropHint');
    if(!basketZone || !hint) return;
    const draftsCount = basketZone.querySelectorAll('[data-tmp="1"]').length;
    hint.classList.toggle('bottom', draftsCount > 0);
  }

  async function apiGet(url){
    const r = await fetch(url, {credentials:'same-origin'});
    return await r.json();
  }
  async function apiPost(url, data){
    const r = await fetch(url, {
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    return await r.json();
  }

  async function loadSchedule(dateStr){
    const res = await apiGet(`/yogatime/api/schedule.php?date=${encodeURIComponent(dateStr)}`);
    if(!res.ok) return null;
    return res.slots;
  }

  async function loadMyBookings(){
    if(!isAuthed) return;

    const res = await apiGet('/yogatime/api/my_bookings.php');
    if(!res.ok) return;

    planned = (res.items || []).map(x => ({
      id: x.id,
      title: x.title,
      serviceId: x.serviceId,
      date: x.date,
      time: x.time
    }));

    renderMyLists();

    // перерисуем таблицу на текущий день, чтобы "Занято" показалось
    const dayBox = qs('dayBox');
    if(dayBox?.dataset?.ymd) renderGrid(dayBox.dataset.ymd);
  }

  function comparePlanned(a,b){
    const da = (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time);
    if(sortMode === 'dateAsc') return da;
    if(sortMode === 'dateDesc') return -da;
    if(sortMode === 'type'){
      const t = a.title.localeCompare(b.title, 'ru');
      return t !== 0 ? t : da;
    }
    return da; // near — упрощённо по дате/времени
  }

  function renderMyLists(){
    const myPlannedEl = qs('myPlanned');
    const myHistoryEl = qs('myHistory');
    if(!myPlannedEl || !myHistoryEl) return;

    myPlannedEl.innerHTML = '';
    myHistoryEl.innerHTML = '';

    if(!planned.length){
      myPlannedEl.innerHTML = `<div class="small">Пока нет записей.</div>`;
    } else {
      [...planned].sort(comparePlanned).forEach(p => {
        const row = document.createElement('div');
        row.className = 'record';
        row.innerHTML = `
          <div class="recordMain">
            <b>${p.title}</b>
            <div class="small">${p.date} ${p.time}</div>
          </div>
          <div><span class="basket" title="Отменить">🗑</span></div>
        `;
        row.querySelector('.basket').addEventListener('click', () => {
          openConfirm(`Отменить запись: ${p.title} — ${p.date} ${p.time}?`, p.id);
        });
        myPlannedEl.appendChild(row);
      });
    }

    // История по заданию не обязательна как БД-часть — оставим блок, чтобы интерфейс не пустовал.
    myHistoryEl.innerHTML = `<div class="small">История (опционально).</div>`;
  }

  function hasTimeConflict(dateStr, timeStr){
    const tk = timeKey(dateStr, timeStr);

    // конфликт с уже подтверждёнными
    if(planned.some(p => timeKey(p.date, p.time) === tk)) return true;

    // конфликт с черновиками в корзине
    const basketZone = qs('basketZone');
    if(!basketZone) return false;
    const drafts = [...basketZone.querySelectorAll('[data-tmp="1"]')];
    if(drafts.some(d => timeKey(d.dataset.date, d.dataset.time) === tk)) return true;

    return false;
  }

  // ----- grid -----
  let pool = new Map(); // lessonKey -> payload

  async function renderGrid(dateStr){
    const gridEl = qs('scheduleGrid');
    if(!gridEl) return;

    gridEl.innerHTML = '';
    pool = new Map();

    gridEl.appendChild(cell('Время', 'head'));
    services.forEach(s => gridEl.appendChild(cell(s.title, 'head')));

    // (Слоты из API сейчас используются только "на будущее" — если захочешь показывать capacity)
    await loadSchedule(dateStr);

    times.forEach(t => {
      gridEl.appendChild(cell(t, 'time'));

      // правило: нельзя 2 занятия в одно время
      const busyThisTime = planned.some(p => (p.date === dateStr && p.time === t));

      services.forEach(s => {
        const c = document.createElement('div');
        c.className = 'cell slot';

        const k = cellKey(dateStr, t, s.id);

        if(!busyThisTime){
          const lesson = document.createElement('div');
          lesson.className = 'lesson';
          lesson.draggable = true;

          const payload = { title: s.title, serviceId: s.id, date: dateStr, time: t, k };
          lesson.innerHTML = `<b>${s.title}</b><small>${t}</small>`;

          // Передаём payload через dataTransfer (строкой JSON). [web:261]
          lesson.addEventListener('dragstart', (ev) => {
            ev.dataTransfer.setData('application/json', JSON.stringify(payload));
            ev.dataTransfer.effectAllowed = 'move';
          });

          c.appendChild(lesson);
          pool.set(k, payload);
        } else {
          c.innerHTML = `<div class="small">Занято</div>`;
        }

        gridEl.appendChild(c);
      });
    });
  }

  function updateDayUI(){
    const dayBox = qs('dayBox');
    const dayLabel = qs('dayLabel');
    const dayInfo = qs('dayInfo');
    const gridEl = qs('scheduleGrid');

    if(!dayBox || !dayLabel || !dayInfo || !gridEl) return;

    const ymd = fmtYMD(selected);
    dayBox.textContent = selected.getDate();
    dayLabel.textContent = `${selected.getDate()} ${monthsRu[selected.getMonth()]}`;
    dayInfo.textContent = `Дата: ${ymd}`;
    dayBox.dataset.ymd = ymd;

    resetBasketKeepHint();

    if(isAuthed) renderGrid(ymd);
    else gridEl.innerHTML = `<div class="cell head" style="grid-column:1/-1;">Нужно войти, чтобы видеть расписание</div>`;
  }

  // ----- confirm modal -----
  let pendingCancelId = null;

  function openConfirm(text, id){
    pendingCancelId = id;
    qs('confirmText').textContent = text;
    qs('confirmDlg').classList.add('open');
  }
  function closeConfirm(){
    pendingCancelId = null;
    qs('confirmDlg').classList.remove('open');
  }

  // ----- buttons: topbar -----
  on('goHomeBtn','click',()=>showPage('home'));
  on('goCabBtn','click',()=>showPage('cabinet'));
  on('goBackBtn','click',()=> (window.history.length > 1 ? window.history.back() : showPage('home')));

  // В макете есть "Записаться/войти" на главной — отправляем на реальный логин
  on('openAuthMain','click',()=>{
    if(isAuthed) showPage('cabinet');
    else openAuth();
  });
  on('openAuthWide','click',openAuth);
  on('openAuthWide2','click',openAuth);
  on('cabLoginBtn','click',openAuth);

  // ----- day arrows -----
  on('dayPrev','click',()=>{
    const d = new Date(selected);
    d.setDate(d.getDate()-1);
    if(isBeforeMin(d)) return;
    selected = d;
    updateDayUI();
  });
  on('dayNext','click',()=>{
    const d = new Date(selected);
    d.setDate(d.getDate()+1);
    selected = d;
    updateDayUI();
  });

  // ----- tabs (Запись / Мои занятия / Что взять) -----
  document.querySelectorAll('.tabbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.getAttribute('data-tab');
      const tab = document.getElementById(id);
      if(tab) tab.classList.add('active');
    });
  });

  // ----- sorting -----
  function setActiveSort(mode){
    sortMode = mode;
    ['sortNear','sortDateAsc','sortDateDesc','sortType'].forEach(id => qs(id)?.classList.remove('active'));
    const map = {near:'sortNear',dateAsc:'sortDateAsc',dateDesc:'sortDateDesc',type:'sortType'};
    qs(map[mode])?.classList.add('active');

    const sortStatus = qs('sortStatus');
    if(sortStatus){
      sortStatus.textContent = ({
        near:'Сортировка: ближайшие',
        dateAsc:'Сортировка: дата ↑',
        dateDesc:'Сортировка: дата ↓',
        type:'Сортировка: виды тренировок'
      })[mode] || 'Сортировка';
    }
    renderMyLists();
  }
  on('sortNear','click',()=>setActiveSort('near'));
  on('sortDateAsc','click',()=>setActiveSort('dateAsc'));
  on('sortDateDesc','click',()=>setActiveSort('dateDesc'));
  on('sortType','click',()=>setActiveSort('type'));

  // ----- drag/drop into basket -----
  const basketZone = qs('basketZone');
  if(basketZone){
    basketZone.addEventListener('dragover',(e)=>e.preventDefault());
    basketZone.addEventListener('drop',(e)=>{
      e.preventDefault();
      if(!isAuthed){ openAuth(); return; }

      const raw = e.dataTransfer.getData('application/json');
      if(!raw) return;

      let payload;
      try{ payload = JSON.parse(raw); } catch { return; }

      const {title, serviceId, date:dateStr, time:timeStr, k} = payload || {};
      if(!title || !serviceId || !dateStr || !timeStr || !k) return;

      if(hasTimeConflict(dateStr, timeStr)){
        alert('Нельзя записаться на два занятия в одно и то же время.');
        return;
      }

      // создаём "черновик" в правой корзине
      const card = document.createElement('div');
      card.className = 'record';
      card.dataset.tmp = '1';
      card.dataset.title = title;
      card.dataset.serviceId = serviceId;
      card.dataset.date = dateStr;
      card.dataset.time = timeStr;
      card.dataset.k = k;

      card.innerHTML = `
        <div class="recordMain">
          <b>${title}</b>
          <div class="small">${dateStr} ${timeStr}</div>
        </div>
        <div class="small">Черновик</div>
      `;

      basketZone.appendChild(card);

      // помечаем ячейку как "выбрано"
      const gridEl = qs('scheduleGrid');
      if(gridEl){
        // просто заменим ближайшую lesson-карточку визуально
        // (точно искать по k можно, но для макета хватает упрощения)
      }

      refreshDropHint();
    });
  }

  // ----- confirm booking (создать запись в БД) -----
  on('confirmBtn','click', async ()=>{
    if(!isAuthed){ openAuth(); return; }
    const basketZone = qs('basketZone');
    if(!basketZone) return;

    const drafts = [...basketZone.querySelectorAll('[data-tmp="1"]')];
    if(!drafts.length){
      alert('Перетащи занятие в "Мои записи".');
      return;
    }

    // делаем 1 запись за раз (чтобы было проще и без багов)
    const d = drafts[0];
    const res = await apiPost('/yogatime/api/booking_create.php', {
      date: d.dataset.date,
      time: d.dataset.time,
      serviceId: d.dataset.serviceId
    });

    if(!res.ok){
      alert(res.error === 'time_conflict' ? 'Конфликт по времени' : 'Ошибка записи');
      return;
    }

    resetBasketKeepHint();
    await loadMyBookings();
    alert('Запись сохранена.');
  });

  // ----- clear basket -----
  on('clearSelection','click',()=>{
    resetBasketKeepHint();
    const dayBox = qs('dayBox');
    if(dayBox?.dataset?.ymd) renderGrid(dayBox.dataset.ymd);
  });

  // ----- confirm modal buttons -----
  on('noBtn','click',closeConfirm);
  on('yesBtn','click', async ()=>{
    if(!pendingCancelId) return;
    const res = await apiPost('/yogatime/api/booking_delete.php', {id: pendingCancelId});
    closeConfirm();
    if(res.ok){
      await loadMyBookings();
      const dayBox = qs('dayBox');
      if(dayBox?.dataset?.ymd) renderGrid(dayBox.dataset.ymd);
    } else {
      alert('Не удалось отменить.');
    }
  });

  // ----- theme button (простая переключалка) -----
  on('themeBtn','click',()=>{
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme');
    root.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  });

  // ----- init -----
  selected = new Date();
  updateDayUI();
  setActiveSort('near');
  if(isAuthed) loadMyBookings();
});
