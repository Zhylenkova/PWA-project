'use strict';

const CAT_ICONS = {
  'Restauracja':'🍽️','Kawiarnia':'☕','Street food':'🌮',
  'Piekarnia':'🥐','Bar':'🍺','Inne':'✨'
};

//responsywnosc
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

//instalacja
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-install-confirm')?.addEventListener('click', triggerInstall);
  document.getElementById('btn-install-dismiss')?.addEventListener('click', () =>
    document.getElementById('install-banner').classList.remove('show')
  );
});


async function triggerInstall() {
  if (!deferredInstall) { toast('Użyj menu przeglądarki -> Dodaj do ekranu głównego'); return; }
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') toast('✅ Instalowanie…');
  deferredInstall = null;
}

//init
window.addEventListener('DOMContentLoaded', () => {
  applyLayout();
  startGPS();
  startCamera();
  updateDots();
  updateCount();

  if (location.hash === '#map') switchTab('map');
  if (location.hash === '#guide') switchTab('guide');
});