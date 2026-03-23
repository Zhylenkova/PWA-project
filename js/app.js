'use strict';

const CAT_ICONS = {
  'Restauracja':'🍽️','Kawiarnia':'☕','Street food':'🌮',
  'Piekarnia':'🥐','Bar':'🍺','Inne':'✨'
};

const isDesktop = () => window.innerWidth >= 992;

function applyLayout() {
  const d = isDesktop();
  document.querySelector('.sidebar').style.display   = d ? 'flex' : 'none';
  document.querySelector('.main-area').style.display = d ? 'flex' : 'none';
  document.getElementById('app').style.display       = d ? 'none' : 'flex';
  document.querySelectorAll('.cam-desktop-panel').forEach(el => el.style.display = d ? 'flex' : 'none');

  const area = document.querySelector('.main-area');
  const appEl = document.getElementById('app');
  const tabbar = appEl.querySelector('.tabbar');

  if (d) {
    ['screen-camera','screen-map','screen-guide'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentElement !== area) area.appendChild(el);
    });
    updateDesktopHeader();
  } else {
    ['screen-camera','screen-map','screen-guide'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentElement !== appEl) appEl.insertBefore(el, tabbar);
    });
  }
}
window.addEventListener('resize', applyLayout);

let spots = JSON.parse(localStorage.getItem('foodspot-spots') || '[]');
let currentGPS = null;
let videoStream = null;
let facingMode = 'environment';
let capturedDataURL = null;
let activeTab = 'camera';
let selectedCat = 'Restauracja';
let activeFilter = 'all';
let map = null;
let miniMap = null;
let markers = [];
let activeSpotIdx = null;
let deferredInstall = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

window.addEventListener('online',  () => document.getElementById('offline-bar').classList.remove('show'));
window.addEventListener('offline', () => document.getElementById('offline-bar').classList.add('show'));

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstall = e;
  if (!isDesktop()) document.getElementById('install-banner').classList.add('show');
});
window.addEventListener('appinstalled', () => {
  toast('🎉 FoodSpot zainstalowany!');
  document.getElementById('install-banner').classList.remove('show');
  document.getElementById('sb-uninstall-btn').style.display = 'flex';
  document.getElementById('mobile-uninstall-btn').style.display = 'flex';
});
document.getElementById('btn-install-confirm').addEventListener('click', triggerInstall);
document.getElementById('btn-install-dismiss').addEventListener('click', () =>
  document.getElementById('install-banner').classList.remove('show'));

async function triggerInstall() {
  if (!deferredInstall) { toast('Użyj menu przeglądarki → Dodaj do ekranu głównego'); return; }
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') toast('✅ Instalowanie…');
  deferredInstall = null;
}
async function triggerUninstall() {
  if (!confirm('Odinstalować FoodSpot? Pamięć podręczna zostanie wyczyszczona.')) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  const keys = await caches.keys();
  for (const k of keys) await caches.delete(k);
  toast('Aplikacja odinstalowana.');
}

const PAGE_META = {
  camera: { title:'Dodaj miejsce',  sub:'Zrób zdjęcie i zapisz lokal kulinarny' },
  map:    { title:'Mapa lokali',    sub:'Wszystkie odkryte miejsca na mapie' },
  guide:  { title:'Mój Przewodnik', sub:'Twoja kolekcja kulinarnych odkryć' },
};

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.sb-btn[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + tab).classList.add('active');
  if (tab === 'camera') startCamera(); else stopCamera();
  if (tab === 'map')    { initMap(); renderMapPins(); }
  if (tab === 'guide')  renderGuide();
  updateDesktopHeader();
}

function updateDesktopHeader() {
  const hdr = document.getElementById('page-header'); if (!hdr) return;
  const showHeader = isDesktop() && activeTab === 'guide';
  hdr.style.display = showHeader ? 'flex' : 'none';
  document.getElementById('ph-title').textContent = PAGE_META[activeTab]?.title || '';
  document.getElementById('ph-sub').textContent   = PAGE_META[activeTab]?.sub   || '';
}

function selectCat(el) {
  document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
  selectedCat = el.dataset.cat;

  document.querySelectorAll('.cam-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === selectedCat));
}
function selectCatDesktop(el) {
  document.querySelectorAll('.cam-cat-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  selectedCat = el.dataset.cat;

  document.querySelectorAll('.cat-pill').forEach(p => p.classList.toggle('selected', p.dataset.cat === selectedCat));
}

function startGPS() {
  if (!navigator.geolocation) { updateGPSUI('GPS niedostępny', false); return; }
  updateGPSUI('Pobieranie lokalizacji…', true);
  navigator.geolocation.watchPosition(
    pos => {
      currentGPS = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      const txt = `Sygnał aktywny (do użycia w zdjęciu)`;
      updateGPSUI(txt, false);
    },
    () => updateGPSUI('Lokalizacja niedostępna', false),
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
}
function updateGPSUI(text, loading) {
  const icon  = document.getElementById('cam-gps-icon');
  const label = document.getElementById('cam-gps-text');
  if (icon)  { icon.className = loading ? 'bi bi-geo-alt gps-pulse' : 'bi bi-geo-alt-fill'; icon.style.color = loading ? '' : 'var(--amber)'; }
  if (label) label.textContent = text;
  ['cam-gps-val-d','sb-gps-val','ph-gps-text'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = text;
  });
}
function refreshGPS() { currentGPS = null; startGPS(); toast('Odświeżanie GPS…'); }

async function startCamera() {
  const video = document.getElementById('cam-video');
  const noSup = document.getElementById('cam-no-support');
  if (!navigator.mediaDevices?.getUserMedia) { noSup.style.display='flex'; video.style.display='none'; return; }
  if (videoStream) videoStream.getTracks().forEach(t => t.stop());
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width:{ ideal:1920 }, height:{ ideal:1080 } }, audio:false
    });
    video.srcObject = videoStream;
    video.style.display = 'block';
    noSup.style.display = 'none';
  } catch(e) {
    noSup.style.display = 'flex'; video.style.display = 'none';
  }
}
function stopCamera() {
  if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
}
function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
}

function takePhoto() {
  const video = document.getElementById('cam-video');
  const canvas = document.getElementById('cam-canvas');
  if (!videoStream) { toast('Aparat nie jest gotowy'); return; }
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (facingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  capturedDataURL = canvas.toDataURL('image/jpeg', 0.85);

  document.getElementById('input-cat').value = selectedCat;
  document.getElementById('preview-img').src = capturedDataURL;
  document.getElementById('preview-gps-text').textContent = currentGPS
    ? `${currentGPS.lat.toFixed(5)}, ${currentGPS.lng.toFixed(5)} (±${Math.round(currentGPS.acc)}m)`
    : 'Brak danych GPS';
  document.getElementById('photo-preview').classList.add('show');
}

function retakePhoto() {
  document.getElementById('photo-preview').classList.remove('show');
  capturedDataURL = null;
  document.getElementById('input-name').value = '';
  document.getElementById('input-desc').value = '';
}

function saveSpot() {
  if (!capturedDataURL) return;
  const name = document.getElementById('input-name').value.trim();
  const desc = document.getElementById('input-desc').value.trim();
  const cat  = document.getElementById('input-cat').value;
  const rating = parseInt(document.getElementById('input-rating').value);
  if (!name) { toast('⚠️ Podaj nazwę miejsca'); return; }

  const spot = {
    id: Date.now(),
    dataURL: capturedDataURL,
    name, desc, cat, rating,
    lat: currentGPS?.lat || null,
    lng: currentGPS?.lng || null,
    acc: currentGPS?.acc || null,
    time: new Date().toISOString(),
  };
  spots.unshift(spot);
  persist();
  retakePhoto();
  updateDots(); updateCount();
  toast(`📍 ${name} dodane do przewodnika!`);
  setTimeout(() => switchTab('guide'), 700);
}

function persist() {
  try { localStorage.setItem('foodspot-spots', JSON.stringify(spots)); }
  catch(e) { spots.splice(spots.length-2,2); localStorage.setItem('foodspot-spots', JSON.stringify(spots)); }
}

function initMap() {
  if (map) { setTimeout(() => map.invalidateSize(), 120); return; }
  map = L.map('map').setView([52, 19], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'© <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom:19
  }).addTo(map);
}

function foodIcon(cat) {
  const emoji = CAT_ICONS[cat] || '🍴';
  return L.divIcon({
    html:`<div style="width:38px;height:38px;border-radius:50% 50% 50% 0;background:linear-gradient(135deg,#ff8c00,#c96800);border:3px solid #fff;box-shadow:0 3px 14px rgba(255,140,0,.6);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(45deg);font-size:16px">${emoji}</div></div>`,
    className:'',iconSize:[38,38],iconAnchor:[19,38],popupAnchor:[0,-38]
  });
}

function renderMapPins() {
  if (!map) return;
  markers.forEach(m => m.remove()); markers = [];
  const geo = spots.filter(s => s.lat && s.lng);
  document.getElementById('map-empty').style.display = geo.length ? 'none' : 'flex';
  if (!geo.length) return;
  const bounds = [];
  geo.forEach(spot => {
    const stars = '★'.repeat(spot.rating) + '☆'.repeat(5-spot.rating);
    const m = L.marker([spot.lat, spot.lng], { icon: foodIcon(spot.cat) }).addTo(map)
      .bindPopup(`<div style="text-align:center;font-family:'DM Sans',sans-serif;min-width:170px">
        <img src="${spot.dataURL}" style="width:100%;height:90px;object-fit:cover;border-radius:8px;margin-bottom:8px"/>
        <strong style="font-size:.88rem;display:block">${spot.name}</strong>
        <span style="font-size:.75rem;color:#c96800">${CAT_ICONS[spot.cat]||''} ${spot.cat}</span><br/>
        <span style="color:#ff8c00;font-size:.9rem">${stars}</span><br/>
        <button onclick="openSpotModal(${spots.indexOf(spot)})" style="margin-top:8px;background:#ff8c00;color:#fff;border:none;border-radius:8px;padding:5px 14px;font-size:.78rem;cursor:pointer;font-family:'DM Sans',sans-serif">Szczegóły & Udostępnij</button>
      </div>`,{maxWidth:210});
    markers.push(m);
    bounds.push([spot.lat, spot.lng]);
  });
  if (bounds.length === 1) map.setView(bounds[0], 15);
  else map.fitBounds(bounds, { padding:[40,40] });
  setTimeout(() => map.invalidateSize(), 120);
}

function applyFilter(el) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeFilter = el.dataset.filter;
  renderGuide();
}

function renderGuide() {
  const grid  = document.getElementById('food-grid');
  const empty = document.getElementById('guide-empty');
  const frow  = document.getElementById('filter-row');
  grid.innerHTML = '';

  if (!spots.length) { empty.style.display='flex'; frow.style.display='none'; return; }
  empty.style.display = 'none'; frow.style.display = 'flex';

  const visible = activeFilter === 'all' ? spots : spots.filter(s => s.cat === activeFilter);

  if (!visible.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--ink-m);font-size:.88rem">Brak miejsc w tej kategorii</div>`;
    return;
  }

  visible.forEach(spot => {
    const i = spots.indexOf(spot);
    const card = document.createElement('div');
    card.className = 'food-card';
    const stars = Array.from({length:5},(_,k)=>
      `<i class="bi bi-star${k < spot.rating ? '-fill' : ''} ${k >= spot.rating ? 'empty' : ''}"></i>`
    ).join('');
    card.innerHTML = `
      <img class="food-thumb" src="${spot.dataURL}" alt="${spot.name}" loading="lazy"/>
      <div class="food-card-body">
        <div class="food-cat">${CAT_ICONS[spot.cat]||'🍴'} ${spot.cat}</div>
        <div class="food-name">${spot.name}</div>
        <div class="food-rating">${stars}</div>
        <div class="food-loc"><i class="bi bi-geo-alt-fill"></i>${spot.lat ? `${spot.lat.toFixed(3)}, ${spot.lng.toFixed(3)}` : 'Brak GPS'}</div>
        <div class="food-time">${formatDate(spot.time)}</div>
      </div>`;
    card.addEventListener('click', () => openSpotModal(i));
    grid.appendChild(card);
  });
  updateDots(); updateCount();
}

function openSpotModal(idx) {
  activeSpotIdx = idx;
  const spot = spots[idx]; if (!spot) return;
  document.getElementById('modal-img').src = spot.dataURL;
  document.getElementById('modal-name').textContent = spot.name;
  document.getElementById('modal-desc').textContent = spot.desc || '';
  document.getElementById('modal-cat').textContent  = `${CAT_ICONS[spot.cat]||''} ${spot.cat}`;
  document.getElementById('modal-date').textContent = formatDate(spot.time);
  document.getElementById('modal-coords').textContent = spot.lat
    ? `${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}`
    : 'Brak danych GPS';

  const starsEl = document.getElementById('modal-rating-stars');
  starsEl.innerHTML = Array.from({length:5},(_,k)=>
    `<i class="bi bi-star${k < spot.rating ? '-fill' : ''} ${k >= spot.rating ? 'empty' : ''}"></i>`
  ).join('');
  document.getElementById('modal-rating-num').textContent = `${spot.rating}/5`;

  const miniEl = document.getElementById('modal-map-mini');
  miniEl.style.display = spot.lat ? 'block' : 'none';
  document.getElementById('spot-modal').classList.add('show');

  if (spot.lat) {
    setTimeout(() => {
      if (miniMap) { miniMap.remove(); miniMap = null; }
      miniMap = L.map('modal-map-mini',{zoomControl:false,dragging:false,scrollWheelZoom:false})
        .setView([spot.lat, spot.lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(miniMap);
      L.marker([spot.lat, spot.lng], { icon: foodIcon(spot.cat) }).addTo(miniMap);
    }, 80);
  }
}

function handleModalClick(e) {
  if (e.target === document.getElementById('spot-modal')) closeModal();
}
function closeModal() {
  document.getElementById('spot-modal').classList.remove('show');
  if (miniMap) { miniMap.remove(); miniMap = null; }
}
function deleteSpot() {
  if (activeSpotIdx === null || !confirm('Usunąć to miejsce z przewodnika?')) return;
  spots.splice(activeSpotIdx, 1);
  persist(); closeModal();
  renderGuide();
  if (map) renderMapPins();
  updateDots(); updateCount();
  toast('🗑️ Miejsce usunięte');
}

function dataURLtoFile(dataURL, filename) {
  const [header, base64] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

async function shareSpot() {
  const spot = spots[activeSpotIdx]; if (!spot) return;
  const stars = '★'.repeat(spot.rating) + '☆'.repeat(5 - spot.rating);
  const mapsLink = spot.lat
    ? `https://www.openstreetmap.org/?mlat=${spot.lat}&mlon=${spot.lng}#map=16/${spot.lat}/${spot.lng}`
    : '';

  const text = [
    `🍴 ${spot.name} — ${stars}`,
    spot.cat ? `${CAT_ICONS[spot.cat]||''} ${spot.cat}` : '',
    spot.desc ? `"${spot.desc}"` : '',
    spot.lat ? `📍 ${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}` : '',
    mapsLink ? `🗺️ ${mapsLink}` : '',
    '\n📱 FoodSpot — Lokalny Przewodnik Kulinarny'
  ].filter(Boolean).join('\n');

  const shareData = { title:`FoodSpot: ${spot.name}`, text };

  if (navigator.canShare) {
    try {
      const file = dataURLtoFile(spot.dataURL, `foodspot-${spot.id}.jpg`);
      if (navigator.canShare({ files:[file] })) shareData.files = [file];
    } catch(e) {}
  }

  try {
    await navigator.share(shareData);
    toast('✅ Rekomendacja udostępniona!');
  } catch(e) {
    if (e.name === 'AbortError') return;
    try {
      const { files, ...textOnly } = shareData;
      await navigator.share(textOnly);
      toast('✅ Udostępniono!');
    } catch(e2) {
      try { await navigator.clipboard.writeText(text); toast('📋 Skopiowano do schowka!'); }
      catch(e3) { toast('❌ Udostępnianie niedostępne'); }
    }
  }
}

async function shareCurrentLocation() {
  if (!currentGPS) { toast('⚠️ Brak sygnału GPS — poczekaj chwilę'); return; }
  const { lat, lng } = currentGPS;
  const osmLink    = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  const googleLink = `https://maps.google.com/?q=${lat},${lng}`;
  const text = `📍 Moja aktualna lokalizacja:\n${lat.toFixed(6)}, ${lng.toFixed(6)}\n\n🗺️ OpenStreetMap: ${osmLink}\n🗺️ Google Maps: ${googleLink}\n\n📱 Wysłane przez FoodSpot`;

  try {
    await navigator.share({ title:'Moja lokalizacja — FoodSpot', text });
    toast('✅ Lokalizacja udostępniona!');
  } catch(e) {
    if (e.name === 'AbortError') return;
    try { await navigator.clipboard.writeText(text); toast('📋 Lokalizacja skopiowana!'); }
    catch(e2) { toast('❌ Udostępnianie niedostępne'); }
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pl-PL',{day:'2-digit',month:'short',year:'numeric'})
    + ' ' + d.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}
function updateDots() {
  const hasGeo = spots.some(s => s.lat);
  [['dot-map','sbdot-map'], ['dot-guide','sbdot-guide']].forEach(([mob,desk]) => {
    const show = mob.includes('map') ? hasGeo : spots.length > 0;
    [mob,desk].forEach(id => { const el=document.getElementById(id); if(el) el.classList.toggle('show',show); });
  });
}
function updateCount() {
  const el = document.getElementById('sb-count'); if (el) el.textContent = spots.length;
}

window.addEventListener('DOMContentLoaded', () => {
  applyLayout();
  startGPS();
  startCamera();
  updateDots();
  updateCount();
  if (location.hash === '#map') switchTab('map');
  if (location.hash === '#guide') switchTab('guide');
});