import {
  DAY, daysUntil, waterProgress, dueLabel, clampFreq, validateEmail, passwordStrength, STRENGTH_LABELS,
  weatherAdvice, firstName, plantsToContext,
} from './lib.js';
import { CATALOG, CATEGORIES } from './catalog.js';
import { createBackend } from './backend.js';
import { wikiInfo } from './wiki.js';

/* ------------------------------ utilitários ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name); s.append(u); return s;
};
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast'), 2800);
}
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('plantae_' + k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('plantae_' + k, JSON.stringify(v)); } catch { /* quota */ } },
  del: (k) => localStorage.removeItem('plantae_' + k),
};

async function loadImage(file) {
  try { return await createImageBitmap(file); } catch {
    return new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file);
    });
  }
}
async function shrink(file, max, q) {
  const bmp = await loadImage(file);
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
  const s = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
const b64 = (dataUrl) => dataUrl.split(',')[1];

/* --------------------------------- estado -------------------------------- */
const state = { be: null, user: null, plants: null, unsub: null, chat: [], weather: null, cat: 'Todas', mode: 'id', idPhoto: null, idCtx: null };

/* ------------------------------ tema / sessão ---------------------------- */
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else document.documentElement.removeAttribute('data-theme');
}
applyTheme(store.get('theme', 'system'));

/* ------------------------------ imagens reais ---------------------------- */
function plantImg(box, title) {
  box.replaceChildren(icon('leaf'));
  if (!title) return;
  wikiInfo(title).then((w) => {
    if (w && w.thumb && box.isConnected) {
      const img = h('img', { src: w.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      box.replaceChildren(img);
    }
  });
}
function photoBox(p, cls = 'pimg') {
  const box = h('div', { class: cls });
  if (p.photo) box.append(h('img', { src: p.photo, alt: `Fotografia de ${p.name}` }));
  else plantImg(box, p.species);
  return box;
}

/* ================================ AUTH UI ================================= */
function bootAuthUI() {
  const be = state.be;
  $('#demoBanner').hidden = be.mode !== 'demo';
  $('#btnGuest').hidden = be.mode !== 'demo';
  wikiInfo('Monstera deliciosa').then((w) => {
    if (!w) return;
    $('#authHero').style.backgroundImage = `url("${w.thumb}")`;
    const c = $('#heroCredit'); c.textContent = 'Foto: Wikipédia'; c.href = w.page; c.hidden = false;
  });

  const showForm = (which) => {
    ['Login', 'Signup', 'Reset'].forEach((n) => ($('#form' + n).hidden = n !== which));
    $('#tabLogin').classList.toggle('on', which !== 'Signup'); $('#tabLogin').setAttribute('aria-selected', String(which !== 'Signup'));
    $('#tabSignup').classList.toggle('on', which === 'Signup'); $('#tabSignup').setAttribute('aria-selected', String(which === 'Signup'));
    $('#socials').hidden = which === 'Reset';
    $$('.err').forEach((e) => (e.textContent = ''));
  };
  $('#tabLogin').onclick = () => showForm('Login');
  $('#tabSignup').onclick = () => showForm('Signup');
  $('#goReset').onclick = () => { $('#rEmail').value = $('#lEmail').value; showForm('Reset'); };
  $('#backLogin').onclick = () => showForm('Login');

  // Olho para ver/ocultar a palavra-passe
  $$('.eye').forEach((b) => {
    b.replaceChildren(icon('eye'));
    b.onclick = () => {
      const input = document.getElementById(b.dataset.eye);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(show));
      b.setAttribute('aria-label', show ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe');
      b.replaceChildren(icon(show ? 'eyeoff' : 'eye'));
      input.focus();
    };
  });

  // Força da palavra-passe
  $('#sPass').addEventListener('input', (e) => {
    const s = passwordStrength(e.target.value);
    $('.meter').dataset.s = String(s);
    $('#meterLabel').textContent = s ? `Força: ${STRENGTH_LABELS[s]}` : '';
  });

  const run = async (btn, errEl, fn) => {
    errEl.textContent = ''; btn.disabled = true;
    try { await fn(); } catch (e) { if (!e.silent) errEl.textContent = e.message; }
    finally { btn.disabled = false; }
  };

  $('#formLogin').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#lEmail').value, pw = $('#lPass').value;
    if (!validateEmail(email)) { $('#loginErr').textContent = 'Escreve um email válido.'; return; }
    if (!pw) { $('#loginErr').textContent = 'Escreve a palavra-passe.'; return; }
    run($('#btnLogin'), $('#loginErr'), () => be.auth.signIn(email, pw));
  });
  $('#formSignup').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#sName').value.trim(), email = $('#sEmail').value, p1 = $('#sPass').value, p2 = $('#sPass2').value;
    const err = $('#signupErr');
    if (!name) { err.textContent = 'Escreve o teu nome.'; return; }
    if (!validateEmail(email)) { err.textContent = 'Escreve um email válido.'; return; }
    if (p1.length < 8) { err.textContent = 'A palavra-passe precisa de pelo menos 8 caracteres.'; return; }
    if (p1 !== p2) { err.textContent = 'As palavras-passe não coincidem.'; return; }
    run($('#btnSignup'), err, () => be.auth.signUp({ name, email, password: p1 }));
  });
  $('#formReset').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#rEmail').value;
    if (!validateEmail(email)) { $('#resetErr').textContent = 'Escreve um email válido.'; return; }
    run($('#btnReset'), $('#resetErr'), async () => {
      await be.auth.reset(email); showForm('Login'); toast('Se o email existir, enviámos o link de recuperação.');
    });
  });
  $('#btnGoogle').onclick = () => run($('#btnGoogle'), $('#socialErr'), () => be.auth.google());
  $('#btnApple').onclick = () => run($('#btnApple'), $('#socialErr'), () => be.auth.apple());
  $('#btnGuest').onclick = () => be.auth.guest();

  const pending = be.takeAuthError();
  if (pending && !pending.silent) $('#socialErr').textContent = pending.message;
}

/* ============================== LIGAÇÃO À APP ============================= */
function onUser(user) {
  state.user = user;
  $('#boot').hidden = true;
  if (!user) {
    state.unsub && state.unsub(); state.unsub = null; state.plants = null; state.chat = [];
    $('#app').hidden = true; $('#auth').hidden = false; $('#sheet').open && $('#sheet').close();
    return;
  }
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#modeBadge').hidden = state.be.mode !== 'demo';
  state.be.users.touch(user);
  renderMe(); renderChatChips(); switchTab('garden');
  state.unsub && state.unsub();
  state.unsub = state.be.plants.subscribe(user.uid, (list, err) => {
    if (err) { toast('Não foi possível carregar o jardim. Verifica as regras do Firestore.', true); list = []; }
    state.plants = list; renderGarden(); maybeNotify();
  });
  loadWeather(false);
}

function switchTab(name) {
  $$('.tab').forEach((t) => (t.hidden = t.id !== 'tab-' + name));
  $$('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#fabAdd').hidden = name !== 'garden';
  window.scrollTo({ top: 0 });
  if (name === 'explore' && !$('#exploreGrid').children.length) renderExplore();
  if (name === 'identify') setMode(state.mode);
}
$$('.nav button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

/* --------------------------------- Sheet --------------------------------- */
const sheet = $('#sheet');
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
let sheetCleanup = [];
sheet.addEventListener('close', () => { sheetCleanup.forEach((f) => f()); sheetCleanup = []; });
function openSheet(title, ...content) {
  const inner = h('div', { class: 'sheet-in' },
    h('div', { class: 'sheet-bar' }, h('h2', { text: title }), h('button', { class: 'x', 'aria-label': 'Fechar', onclick: () => sheet.close() }, icon('close'))),
    ...content);
  sheet.replaceChildren(inner);
  if (!sheet.open) sheet.showModal();
  inner.scrollTop = 0;
  return inner;
}

/* ================================== JARDIM ================================ */
function renderGarden() {
  if (!state.user) return;
  const plants = state.plants || [];
  $('#greet').textContent = `Olá, ${firstName(state.user.name)} 🌿`;
  const due = plants.filter((p) => daysUntil(p) <= 0).length;
  $('#statTotal').textContent = plants.length; $('#statDue').textContent = due;
  renderWeather();

  const q = $('#plantSearch').value.trim().toLowerCase();
  const list = plants.filter((p) => !q || `${p.name} ${p.species || ''} ${p.location || ''}`.toLowerCase().includes(q))
    .sort((a, b) => daysUntil(a) - daysUntil(b));
  const box = $('#plantList'); box.replaceChildren();
  if (!plants.length) {
    box.append(h('div', { class: 'empty' }, h('p', { text: 'Ainda não tens plantas.' }),
      h('p', { class: 'small', text: 'Toca em + para adicionar a primeira, ou usa a câmara para a identificar.' })));
    return;
  }
  if (!list.length) { box.append(h('div', { class: 'empty', text: 'Nenhuma planta encontrada.' })); return; }
  list.forEach((p) => {
    const d = daysUntil(p), late = d <= 0;
    const card = h('div', { class: 'pcard', role: 'button', tabindex: '0', onclick: () => openPlant(p.id), onkeydown: (e) => { if (e.key === 'Enter') openPlant(p.id); } },
      photoBox(p),
      h('div', {},
        h('h3', { text: p.name }),
        h('p', { text: [p.species, p.location].filter(Boolean).join(' · ') || ' ' }),
        h('p', { class: 'due' + (late ? ' late' : ''), text: dueLabel(d) }),
        h('div', { class: 'bar' + (late ? ' late' : '') }, h('i', { style: `width:${waterProgress(p)}%` }))),
      h('button', { class: 'water' + (late ? ' late' : ''), 'aria-label': `Regar ${p.name}`, onclick: (e) => { e.stopPropagation(); waterPlant(p); } }, icon('drop')));
    box.append(card);
  });
}
$('#plantSearch').addEventListener('input', renderGarden);

async function waterPlant(p) {
  const now = Date.now();
  try {
    await state.be.plants.save(state.user.uid, { id: p.id, lastWatered: now, history: [...(p.history || []), now].slice(-30) });
    toast(`${p.name} foi regada 💧`);
  } catch { toast('Não foi possível guardar a rega.', true); }
}

/* ---- Clima (Open-Meteo, opcional) ---- */
function renderWeather() {
  const box = $('#weatherCard'); box.replaceChildren();
  const w = state.weather;
  if (w) {
    box.append(h('div', {}, h('b', { text: `${Math.round(w.temp)}°C` }), h('div', { class: 'small', text: weatherAdvice(w) })));
    return;
  }
  box.append(h('div', {}, h('b', { text: 'Rega com o clima' }), h('div', { class: 'small', text: 'Ativa a localização para conselhos de rega baseados na meteorologia.' })),
    h('button', { onclick: () => loadWeather(true) }, 'Ativar'));
}
async function loadWeather(ask) {
  let loc = store.get('loc', null);
  if (!loc) {
    if (!ask || !navigator.geolocation) return;
    try {
      loc = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }), rej, { timeout: 10000 }));
      store.set('loc', loc);
    } catch { toast('Não foi possível obter a localização.', true); return; }
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m&daily=temperature_2m_max,precipitation_sum&forecast_days=1&timezone=auto`;
    const j = await (await fetch(url)).json();
    state.weather = { temp: j.current.temperature_2m, tmax: j.daily.temperature_2m_max[0], rainMm: j.daily.precipitation_sum[0] };
    renderWeather(); renderMe();
  } catch { /* sem rede: ignora */ }
}

/* ---- Lembretes ---- */
function maybeNotify() {
  if (!store.get('reminders', false) || !('Notification' in window) || Notification.permission !== 'granted') return;
  const today = new Date().toDateString();
  if (store.get('notified', '') === today) return;
  const due = (state.plants || []).filter((p) => daysUntil(p) <= 0);
  if (!due.length) return;
  store.set('notified', today);
  try { new Notification('Plantae', { body: `${due.map((p) => p.name).join(', ')} ${due.length > 1 ? 'precisam' : 'precisa'} de água hoje 💧`, icon: 'icon.svg' }); } catch { /* ignora */ }
}

/* -------------------------- Adicionar / editar planta -------------------- */
$('#fabAdd').onclick = () => plantForm(null);

function plantForm(plant, prefill = {}) {
  const p = plant || { name: '', species: '', location: '', freq: 7, light: 'média', toxic: null, notes: '', photo: null, ...prefill };
  let photo = p.photo || null;
  const pick = h('div', { class: 'photo-pick', role: 'button', tabindex: '0' });
  const showPhoto = () => { pick.replaceChildren(photo ? h('img', { src: photo, alt: 'Fotografia da planta' }) : h('span', { text: 'Adicionar fotografia' })); };
  showPhoto();
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.onchange = async () => {
    if (!file.files[0]) return;
    try { photo = await shrink(file.files[0], 480, 0.72); showPhoto(); } catch { toast('Não foi possível abrir a imagem.', true); }
  };
  pick.onclick = () => file.click();
  pick.onkeydown = (e) => { if (e.key === 'Enter') file.click(); };

  const f = {
    name: h('input', { value: p.name, placeholder: 'Ex.: Monstera da sala', maxlength: '80', required: true }),
    species: h('input', { value: p.species || '', placeholder: 'Ex.: Monstera deliciosa (ajuda a obter a foto)' }),
    location: h('input', { value: p.location || '', placeholder: 'Ex.: Sala, janela virada a sul' }),
    freq: h('input', { type: 'number', min: '1', max: '90', value: String(p.freq || 7), inputmode: 'numeric' }),
    light: h('select', {}, ...['baixa', 'média', 'alta'].map((v) => h('option', { value: v, selected: v === p.light }, v))),
    toxic: h('select', {}, h('option', { value: '', selected: p.toxic == null }, 'Não sei'), h('option', { value: 'true', selected: p.toxic === true }, 'Sim'), h('option', { value: 'false', selected: p.toxic === false }, 'Não')),
    notes: h('textarea', { placeholder: 'Notas (substrato, adubo, onde a compraste…)', maxlength: '1000' }, p.notes || ''),
  };
  const field = (label, el) => h('label', { class: 'field' }, h('span', { text: label }), el);
  const err = h('p', { class: 'err', role: 'alert' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, plant ? 'Guardar alterações' : 'Adicionar ao jardim');
  const form = h('form', { class: 'form', novalidate: true },
    pick, file,
    field('Nome', f.name), field('Espécie (opcional)', f.species), field('Localização', f.location),
    h('div', { class: 'two' }, field('Regar a cada (dias)', f.freq), field('Luz', f.light)),
    field('Tóxica para cães/gatos?', f.toxic), field('Notas', f.notes), err, save);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.name.value.trim()) { err.textContent = 'Dá um nome à planta.'; return; }
    save.disabled = true;
    const data = {
      ...(plant ? { id: plant.id } : { lastWatered: Date.now(), history: [] }),
      name: f.name.value.trim(), species: f.species.value.trim(), location: f.location.value.trim(),
      freq: clampFreq(f.freq.value), light: f.light.value,
      toxic: f.toxic.value === '' ? null : f.toxic.value === 'true',
      notes: f.notes.value.trim(), photo,
    };
    try {
      await state.be.plants.save(state.user.uid, data);
      sheet.close(); toast(plant ? 'Planta atualizada' : `${data.name} adicionada ao jardim 🌿`);
    } catch { err.textContent = 'Não foi possível guardar. Tenta novamente.'; save.disabled = false; }
  };
  openSheet(plant ? 'Editar planta' : 'Nova planta', form);
}

/* ------------------------------ Detalhe da planta ------------------------ */
function openPlant(id) {
  const p = (state.plants || []).find((x) => x.id === id);
  if (!p) return;
  const d = daysUntil(p);
  const hero = photoBox(p, 'hero-img');
  const pills = h('div', { class: 'pills' },
    h('span', { class: 'pill', text: `Rega a cada ${p.freq} dias` }),
    h('span', { class: 'pill', text: `Luz ${p.light || 'média'}` }),
    p.toxic === true && h('span', { class: 'pill warn', text: 'Tóxica para animais' }),
    p.toxic === false && h('span', { class: 'pill ok', text: 'Segura para animais' }));
  const tl = h('div', { class: 'tl' });
  const entryText = h('textarea', { placeholder: 'Como está a planta hoje? (novas folhas, rebentos, problemas…)', maxlength: '1000' });
  let entryPhoto = null;
  const entryFile = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const entryBtn = h('button', { class: 'btn secondary', type: 'button', onclick: () => entryFile.click() }, 'Anexar foto');
  entryFile.onchange = async () => { if (entryFile.files[0]) { try { entryPhoto = await shrink(entryFile.files[0], 640, 0.72); entryBtn.textContent = 'Foto anexada ✓'; } catch { toast('Não foi possível abrir a imagem.', true); } } };
  const addEntry = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    if (!entryText.value.trim() && !entryPhoto) return;
    try {
      await state.be.diary.add(state.user.uid, p.id, { date: Date.now(), text: entryText.value.trim(), photo: entryPhoto });
      entryText.value = ''; entryPhoto = null; entryBtn.textContent = 'Anexar foto';
    } catch { toast('Não foi possível guardar a entrada.', true); }
  } }, 'Guardar no diário');

  const unsub = state.be.diary.subscribe(state.user.uid, p.id, (entries) => {
    tl.replaceChildren(...(entries.length ? entries.map((en) => h('div', { class: 'tl-item' },
      h('time', { text: new Date(en.date).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' }) }),
      en.photo && h('img', { src: en.photo, alt: 'Fotografia do diário' }),
      en.text && h('p', { text: en.text }),
      h('button', { onclick: () => state.be.diary.remove(state.user.uid, p.id, en.id) }, 'Apagar'))) : [h('p', { class: 'muted small', text: 'Ainda sem entradas. Regista a evolução da planta com fotografias.' })]));
  });
  sheetCleanup.push(unsub);

  let confirmDel = false;
  const del = h('button', { class: 'btn danger', onclick: async () => {
    if (!confirmDel) { confirmDel = true; del.textContent = 'Toca outra vez para apagar de vez'; return; }
    try { await state.be.plants.remove(state.user.uid, p.id); sheet.close(); toast(`${p.name} foi removida`); } catch { toast('Não foi possível apagar.', true); }
  } }, 'Apagar planta');

  openSheet(p.name,
    hero,
    h('p', { class: 'muted', text: [p.species, p.location].filter(Boolean).join(' · ') }),
    pills,
    p.notes && h('div', { class: 'note', text: p.notes }),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: () => { waterPlant(p); sheet.close(); } }, d <= 0 ? 'Marcar como regada hoje' : 'Regar agora'),
      h('div', { class: 'two' },
        h('button', { class: 'btn secondary', onclick: () => { sheet.close(); askAbout(p); } }, 'Perguntar à IA'),
        h('button', { class: 'btn secondary', onclick: () => { sheet.close(); state.idCtx = p; setMode('dx'); switchTab('identify'); } }, 'Diagnosticar'))),
    h('div', { class: 'sec' }, h('h3', { text: 'Diário da planta' }), entryText, h('div', { class: 'two' }, entryBtn, addEntry), entryFile, tl),
    (p.history && p.history.length) ? h('div', { class: 'sec' }, h('h3', { text: 'Últimas regas' }),
      h('p', { class: 'muted small', text: p.history.slice(-5).reverse().map((t) => new Date(t).toLocaleDateString('pt-PT')).join(' · ') })) : null,
    h('div', { class: 'btns' }, h('button', { class: 'btn secondary', onclick: () => plantForm(p) }, 'Editar'), del));
}

/* ================================= EXPLORAR =============================== */
function renderExplore() {
  const chips = $('#catChips'); chips.replaceChildren(...CATEGORIES.map((c) => h('button', { class: 'chip' + (c === state.cat ? ' on' : ''), onclick: () => { state.cat = c; renderExplore(); } }, c)));
  const grid = $('#exploreGrid'); grid.replaceChildren();
  CATALOG.filter((s) => state.cat === 'Todas' || s.cat === state.cat).forEach((s) => {
    const img = h('div', { class: 'gimg' }, icon('leaf')); plantImg(img, s.sci);
    grid.append(h('button', { class: 'gcard', onclick: () => speciesSheet(s) }, img,
      h('div', { class: 'gbody' }, h('b', { text: s.pt }), h('i', { text: s.sci }))));
  });
}
function speciesSheet(s) {
  const hero = h('div', { class: 'hero-img' }, icon('leaf'));
  const credit = h('p', { class: 'fine', text: '' });
  const extract = h('p', { class: 'muted' });
  wikiInfo(s.sci).then((w) => {
    if (!w) return;
    hero.replaceChildren(h('img', { src: w.thumb, alt: s.pt, style: 'width:100%;height:100%;object-fit:cover;border-radius:18px', referrerpolicy: 'no-referrer' }));
    extract.textContent = w.extract.length > 320 ? w.extract.slice(0, 320).replace(/\s+\S*$/, '') + '…' : w.extract;
    credit.replaceChildren('Fotografia e texto: ', h('a', { href: w.page, target: '_blank', rel: 'noopener', text: 'Wikipédia' }), ' (licenças livres, ver página da imagem).');
  });
  openSheet(s.pt, hero, h('p', { class: 'sci muted', style: 'font-style:italic', text: s.sci }),
    h('div', { class: 'pills' },
      h('span', { class: 'pill', text: `Rega a cada ~${s.freq} dias` }), h('span', { class: 'pill', text: `Luz ${s.light}` }), h('span', { class: 'pill', text: s.level }),
      s.toxic === true && h('span', { class: 'pill warn', text: 'Tóxica para animais' }),
      s.toxic === false && h('span', { class: 'pill ok', text: 'Segura para animais' }),
      s.toxic == null && h('span', { class: 'pill', text: 'Confirmar toxicidade' })),
    h('div', { class: 'note', text: s.tip }), extract, credit,
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: () => plantForm(null, { name: s.pt, species: s.sci, freq: s.freq, light: s.light, toxic: s.toxic }) }, 'Adicionar ao meu jardim'),
      h('button', { class: 'btn secondary', onclick: () => { sheet.close(); askAbout({ name: s.pt, species: s.sci }); } }, 'Perguntar à IA sobre esta planta')));
}

/* ============================ IDENTIFICAR / DIAGNOSTICAR ================== */
function setMode(m) {
  state.mode = m;
  $('#modeId').classList.toggle('on', m === 'id'); $('#modeId').setAttribute('aria-selected', String(m === 'id'));
  $('#modeDx').classList.toggle('on', m === 'dx'); $('#modeDx').setAttribute('aria-selected', String(m === 'dx'));
  $('#modeHelp').textContent = m === 'id'
    ? 'Descobre que planta é, com cuidados e uma foto de referência para comparares.'
    : `Fotografa folhas, caule ou terra com problemas${state.idCtx ? ` (${state.idCtx.name})` : ''} e recebe uma análise e passos práticos.`;
  $('#idGo').textContent = m === 'id' ? 'Identificar com Gemini' : 'Diagnosticar com Gemini';
  $('#idResult').replaceChildren();
}
$('#modeId').onclick = () => { state.idCtx = null; setMode('id'); };
$('#modeDx').onclick = () => setMode('dx');

async function onPhoto(file) {
  if (!file) return;
  try {
    const dataUrl = await shrink(file, 1024, 0.82);
    state.idPhoto = dataUrl;
    $('#idPreview').src = dataUrl; $('#idPreview').hidden = false; $('#idEmpty').hidden = true;
    $('#idGo').disabled = false; $('#idResult').replaceChildren();
  } catch { toast('Não foi possível abrir a imagem.', true); }
}
$('#idCam').onchange = (e) => onPhoto(e.target.files[0]);
$('#idGal').onchange = (e) => onPhoto(e.target.files[0]);

$('#idGo').onclick = async () => {
  if (!state.idPhoto) return;
  const out = $('#idResult'); out.replaceChildren(h('div', { class: 'spin', text: 'O Gemini está a analisar a fotografia…' }));
  $('#idGo').disabled = true;
  try {
    const ai = state.be.ai;
    if (state.mode === 'id') showIdentify(await ai.identify(b64(state.idPhoto), 'image/jpeg'));
    else showDiagnose(await ai.diagnose(b64(state.idPhoto), 'image/jpeg', state.idCtx && state.idCtx.name));
  } catch (e) { out.replaceChildren(h('div', { class: 'res' }, h('p', { class: 'err', text: e.message }))); }
  finally { $('#idGo').disabled = false; }
};

const confClass = { alta: 'ok', média: '', baixa: 'warn' };
function showIdentify(j) {
  const out = $('#idResult');
  if (!j || !j.planta_visivel) { out.replaceChildren(h('div', { class: 'res' }, h('p', { text: 'Não consegui ver nenhuma planta nesta fotografia. Tenta aproximar-te da folha ou da flor, com boa luz.' }))); return; }
  const refImg = h('figure', {}, h('div', { class: 'gimg' }, icon('leaf')), h('figcaption', { text: 'Referência (Wikipédia)' }));
  wikiInfo(j.especie).then((w) => {
    if (!w) { refImg.querySelector('figcaption').textContent = 'Sem foto de referência'; return; }
    refImg.replaceChildren(h('img', { src: w.thumb, alt: `Referência: ${j.especie}`, referrerpolicy: 'no-referrer' }),
      h('figcaption', {}, h('a', { href: w.page, target: '_blank', rel: 'noopener', text: 'Referência (Wikipédia)' })));
  });
  const mine = h('figure', {}, h('img', { src: state.idPhoto, alt: 'A tua fotografia' }), h('figcaption', { text: 'A tua foto' }));
  const alts = (j.alternativas || []).slice(0, 3);
  out.replaceChildren(h('div', { class: 'res' },
    j.exemplo && h('div', { class: 'note', text: 'Resultado de exemplo — modo demonstração (sem ligação ao Gemini).' }),
    h('div', {}, h('h3', { text: j.nome_comum || j.especie }), h('div', { class: 'sci', text: j.especie })),
    h('div', { class: 'compare' }, mine, refImg),
    h('div', { class: 'pills' },
      h('span', { class: 'pill ' + (confClass[j.confianca] || ''), text: `Confiança ${j.confianca || '—'}` }),
      j.dificuldade && h('span', { class: 'pill', text: j.dificuldade }),
      j.rega_dias && h('span', { class: 'pill', text: `Rega ~${j.rega_dias} dias` }),
      j.luz && h('span', { class: 'pill', text: `Luz ${j.luz}` }),
      j.toxica_animais === true && h('span', { class: 'pill warn', text: 'Tóxica para animais' }),
      j.toxica_animais === false && h('span', { class: 'pill ok', text: 'Segura para animais' })),
    j.resumo && h('p', { text: j.resumo }),
    (j.cuidados || []).length ? h('ul', {}, ...j.cuidados.map((c) => h('li', { text: c }))) : null,
    alts.length ? h('div', { class: 'note' }, 'Também pode ser: ', alts.map((a) => a.nome || a.especie).join(', ')) : null,
    j.confianca !== 'alta' && h('div', { class: 'note', text: 'A confiança não é alta: compara as folhas com a referência antes de decidires.' }),
    h('button', { class: 'btn primary', onclick: async () => {
      const small = state.idPhoto ? await shrinkDataUrl(state.idPhoto, 480, 0.72) : null;
      plantForm(null, { name: j.nome_comum || j.especie, species: j.especie, freq: clampFreq(j.rega_dias || 7), light: ['baixa', 'média', 'alta'].includes(j.luz) ? j.luz : 'média', toxic: typeof j.toxica_animais === 'boolean' ? j.toxica_animais : null, photo: small });
    } }, 'Adicionar ao meu jardim'),
    h('p', { class: 'fine', text: 'Identificação por IA: pode errar. Não consumas nem uses plantas com base apenas neste resultado.' })));
}
function shrinkDataUrl(dataUrl, max, q) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => res(null); img.src = dataUrl;
  });
}
const sevClass = { baixa: 'ok', média: '', alta: 'warn' };
function showDiagnose(j) {
  const out = $('#idResult');
  if (!j || !j.planta_visivel) { out.replaceChildren(h('div', { class: 'res' }, h('p', { text: 'Não consegui ver a planta com clareza. Fotografa a zona afetada de perto e com boa luz.' }))); return; }
  out.replaceChildren(h('div', { class: 'res' },
    j.exemplo && h('div', { class: 'note', text: 'Resultado de exemplo — modo demonstração (sem ligação ao Gemini).' }),
    h('h3', { text: j.saudavel ? 'Sem problemas visíveis' : (j.problema || 'Possível problema') }),
    h('div', { class: 'pills' }, h('span', { class: 'pill ' + (sevClass[j.gravidade] || ''), text: `Gravidade ${j.gravidade || '—'}` })),
    j.causa_provavel && h('p', { text: j.causa_provavel }),
    (j.passos || []).length ? h('div', {}, h('b', { text: 'O que fazer' }), h('ol', {}, ...j.passos.map((s) => h('li', { text: s })))) : null,
    j.prevencao && h('p', {}, h('b', { text: 'Prevenção: ' }), j.prevencao),
    j.procurar_ajuda_quando && h('div', { class: 'note', text: `Procura ajuda de um especialista se: ${j.procurar_ajuda_quando}` }),
    h('div', { class: 'btns' }, h('button', { class: 'btn secondary', onclick: () => { askAbout(state.idCtx || { name: 'a minha planta', species: '' }, `Diagnóstico por foto: ${j.problema || ''}. ${j.causa_provavel || ''} Podes aprofundar e dizer o que devo observar nos próximos dias?`); } }, 'Continuar no assistente')),
    h('p', { class: 'fine', text: 'Uma fotografia não substitui a observação presencial. Isto é orientação geral.' })));
}

/* ================================ ASSISTENTE ============================== */
const CHIPS = ['O que devo regar hoje?', 'Porque amarelam as folhas?', 'Que plantas são seguras para gatos?', 'Como multiplico uma jiboia?'];
function renderChatChips() {
  $('#chatChips').replaceChildren(...CHIPS.map((c) => h('button', { class: 'chip', onclick: () => sendChat(c) }, c)));
  if (!state.chat.length) $('#chatLog').replaceChildren(botBubble('Olá! Sou o Plantae 🌿 Pergunta-me sobre rega, luz, pragas ou escolha de plantas. Conheço o teu jardim, por isso posso ser específico.'));
}
function botBubble(text) { const b = h('div', { class: 'bub ai' }); richText(b, text); return b; }
function richText(el, text) {
  el.replaceChildren(); let ul = null;
  const inline = (parent, s) => s.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) parent.append(h('strong', { text: part.slice(2, -2) })); else if (part) parent.append(part.replace(/\*/g, ''));
  });
  text.split('\n').forEach((line) => {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!ul) { ul = h('ul'); el.append(ul); } const li = h('li'); inline(li, m[1]); ul.append(li); }
    else if (line.trim()) { ul = null; const p = h('p'); inline(p, line.trim()); el.append(p); }
  });
}
let chatBusy = false;
async function sendChat(text) {
  text = text.trim(); if (!text || chatBusy) return;
  chatBusy = true; $('#chatInput').value = '';
  const log = $('#chatLog');
  if (!state.chat.length) log.replaceChildren();
  state.chat.push({ role: 'user', text });
  log.append(h('div', { class: 'bub user', text }));
  const bub = h('div', { class: 'bub ai', text: '…' }); log.append(bub);
  bub.scrollIntoView({ block: 'end', behavior: 'smooth' });
  let ctx = plantsToContext(state.plants || []);
  if (state.weather) ctx += `\nTempo hoje: ${Math.round(state.weather.temp)}°C, máx ${Math.round(state.weather.tmax)}°C, chuva ${state.weather.rainMm} mm.`;
  try {
    const reply = await state.be.ai.chat(state.chat, ctx, (t) => { richText(bub, t); bub.scrollIntoView({ block: 'end' }); });
    state.chat.push({ role: 'ai', text: reply });
  } catch (e) { bub.className = 'bub ai err'; bub.textContent = e.message; state.chat.pop(); }
  finally { chatBusy = false; }
}
$('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('#chatInput').value); });
$('#chatClear').onclick = () => { state.chat = []; renderChatChips(); };
function askAbout(p, custom) {
  switchTab('chat');
  sendChat(custom || `Tenho uma planta "${p.name}"${p.species ? ` (${p.species})` : ''}. Que cuidados principais deve ter e que erros devo evitar?`);
}

/* ================================== PERFIL ================================ */
function renderMe() {
  const u = state.user; if (!u) return;
  $('#meName').textContent = u.name; $('#meEmail').textContent = u.email || 'Sessão de demonstração';
  const prov = { 'google.com': 'Google', 'apple.com': 'Apple', password: 'Email e palavra-passe', demo: 'Modo demonstração' }[u.provider] || u.provider;
  $('#meProvider').textContent = `Sessão iniciada com: ${prov}`;
  const av = $('#meAvatar'); av.replaceChildren(u.photo ? h('img', { src: u.photo, alt: '', referrerpolicy: 'no-referrer' }) : (u.name[0] || '?').toUpperCase());
  $('#themeSel').value = store.get('theme', 'system');
  setSwitch($('#remToggle'), store.get('reminders', false));
  setSwitch($('#locToggle'), !!store.get('loc', null));
}
const setSwitch = (el, on) => el.setAttribute('aria-checked', String(!!on));
$('#themeSel').onchange = (e) => { store.set('theme', e.target.value); applyTheme(e.target.value); };
$('#remToggle').onclick = async () => {
  const on = !store.get('reminders', false);
  if (on) {
    if (!('Notification' in window)) { toast('Este navegador não suporta notificações.', true); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Permissão de notificações recusada.', true); return; }
  }
  store.set('reminders', on); setSwitch($('#remToggle'), on); if (on) { store.del('notified'); maybeNotify(); }
};
$('#locToggle').onclick = async () => {
  if (store.get('loc', null)) { store.del('loc'); state.weather = null; renderWeather(); setSwitch($('#locToggle'), false); return; }
  await loadWeather(true); setSwitch($('#locToggle'), !!store.get('loc', null));
};
$('#btnExport').onclick = () => {
  const data = { exportadoEm: new Date().toISOString(), utilizador: { nome: state.user.name, email: state.user.email }, plantas: (state.plants || []).map(({ photo, ...r }) => r) };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'plantae-dados.json' });
  a.click(); URL.revokeObjectURL(a.href);
};
$('#btnLogout').onclick = () => state.be.auth.signOut();

/* ================================== ARRANQUE ============================== */
(async function init() {
  try {
    state.be = await createBackend();
  } catch (e) {
    $('#boot').replaceChildren(h('p', { text: 'Não foi possível carregar o Firebase. Verifica a ligação e o config.js.' }), h('p', { class: 'small', text: String(e.message || e) }));
    return;
  }
  bootAuthUI();
  state.be.auth.onChange(onUser);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  void DAY;
})();
