'use strict';

let activeTab = 'camera';
let map = null;

function switchTab(tab) {
  activeTab = tab;


  document.querySelectorAll('.tab').forEach(btn =>
    btn.classList.toggle('active', btn.getAttribute('onclick').includes(tab))
  );


  document.querySelectorAll('.screen').forEach(screen =>
    screen.classList.remove('active')
  );

  const activeScreen = document.getElementById('screen-' + tab);
  if (activeScreen) activeScreen.classList.add('active');


  //init mapy
  if (tab === 'map') {
    initMap();
  }

  // render bedzie tutaj
  if (tab === 'guide') {
    renderGuide();
  }
}

//mapka leaflet
function initMap() {
  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
    return;
  }

  map = L.map('map').setView([50.0647, 19.9450], 13); 

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}


function renderGuide() {
  const grid = document.getElementById('food-grid');

  grid.innerHTML = `
    <div style="padding:20px;text-align:center;color:#777;">
      Brak zapisanych miejsc 🍽️
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  switchTab('camera');
});