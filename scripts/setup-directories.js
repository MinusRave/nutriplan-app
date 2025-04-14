// script/setup-directories.js
const fs = require('fs');
const path = require('path');

// Crea le directory necessarie se non esistono
const directories = [
  'public/css',
  'public/js',
  'public/images/favicon',
  'locales/it',
  'locales/en',
  'locales/fr',
  'locales/es',
  'locales/de',
  'locales/pt'
];

// Crea le cartelle
directories.forEach(dir => {
  const fullPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(fullPath)) {
    console.log(`Creazione directory: ${fullPath}`);
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Genera file favicon di base
const faviconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="4" fill="#2ecc71"/>
  <path d="M8 16 L14 22 L24 10" stroke="white" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// Crea un semplice webmanifest
const webmanifest = JSON.stringify({
  "name": "NutriPlan",
  "short_name": "NutriPlan",
  "icons": [
    {
      "src": "/images/favicon/android-chrome-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/images/favicon/android-chrome-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "#2ecc71",
  "background_color": "#ffffff",
  "display": "standalone"
});

// Scrive i file favicon di esempio
const faviconPath = path.join(__dirname, '..', 'public/images/favicon');
fs.writeFileSync(path.join(faviconPath, 'favicon.svg'), faviconSVG);
fs.writeFileSync(path.join(faviconPath, 'site.webmanifest'), webmanifest);

// Copia i file CSS e JS se non esistono già
const cssDir = path.join(__dirname, '..', 'public/css');
const jsDir = path.join(__dirname, '..', 'public/js');

// Verifica se i file CSS e JS esistono già, altrimenti creali vuoti
if (!fs.existsSync(path.join(cssDir, 'style.css'))) {
  fs.writeFileSync(path.join(cssDir, 'style.css'), '/* Il file style.css sarà creato separatamente */');
}

if (!fs.existsSync(path.join(jsDir, 'main.js'))) {
  fs.writeFileSync(path.join(jsDir, 'main.js'), '// Il file main.js sarà creato separatamente');
}

console.log('Setup delle directory completato con successo!');
