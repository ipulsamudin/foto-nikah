// Service worker: aplikasi harus bisa dibuka dari nol tanpa internet.
// Naikkan VERSI setiap kali berkas aplikasi berubah agar cache lama dibuang.
//
// MENGAPA shell wajib offline, bukan sekadar "bagus kalau ada": tamu memindai QR
// di venue dengan jaringan yang dipakai ratusan orang. Kalau HTML dan modul JS
// harus diambil dari jaringan lebih dulu, halaman hanya berputar — dan foto itu
// TIDAK PERNAH TERJADI. Begitu shell ter-cache, kamera dan IndexedDB bekerja
// tanpa jaringan sama sekali; hanya pengiriman yang butuh jaringan, dan itu
// sudah diantre. Janji aplikasi ini — "jepret sekarang, kirim nanti" — hanya
// benar kalau shell-nya offline-first.

const VERSI = 'foto-nikah-v3';

const ASET = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/router.js',
  './assets/js/ui.js',
  './assets/js/fmt.js',
  './assets/js/exif.js',
  './assets/js/tamu.js',
  './assets/js/kamera.js',
  './assets/js/berkas-kamera.js',
  './assets/js/gambar.js',
  './assets/js/bingkai.js',
  './assets/js/antrean.js',
  './assets/js/unggah.js',
  './assets/js/indeks.js',
  './assets/js/simpan-galeri.js',
  './assets/js/views/beranda.js',
  './assets/js/views/saya.js',
  './assets/js/views/info.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  // Halaman cetak ikut di-precache: kartu QR mungkin dicetak dari laptop di
  // venue yang tidak punya internet.
  './cetak/qr.html',
  './cetak/qr.css',
  './cetak/qr.js',
  './vendor/qrcode-generator-1.4.4.esm.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSI);
      await cache.addAll(ASET);
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const nama of await caches.keys()) {
        if (nama !== VERSI) await caches.delete(nama);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/** Host backend. Jangan pernah disentuh service worker — lihat alasannya di bawah. */
function hostBackend(url) {
  return (
    /(^|\.)script\.google\.com$/.test(url.hostname) ||
    /(^|\.)script\.googleusercontent\.com$/.test(url.hostname)
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // POST unggahan tidak pernah disentuh.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ATURAN KERAS: endpoint Apps Script tidak boleh pernah masuk cache, dengan
  // alasan apa pun. Balasan 200 yang ter-cache membuat unggahan yang gagal
  // tampak "berhasil", dan foto tamu akan hilang tanpa jejak.
  if (hostBackend(url)) return;

  // Lintas-origin lain dibiarkan apa adanya. JANGAN mengembalikan Response
  // sintetis di sini: antrean mengandalkan fetch yang BENAR-BENAR menolak
  // supaya ia tahu harus menjadwalkan ulang.
  if (url.origin !== location.origin) return;

  // data/api.json diambil network-first (pengecualian yang sadar).
  //
  // Berkas ini memuat URL backend. Kalau cache-first, mengganti deployment Apps
  // Script menuntut naik VERSI + deploy ulang + semua HP me-refresh dua kali —
  // tepat pekerjaan yang tidak kita inginkan pada jam 11 malam tanggal 5
  // Desember. Network-first membuat perubahan endpoint berlaku pada pemuatan
  // online berikutnya, dan tetap bekerja offline lewat cadangan cache.
  if (url.pathname.endsWith('/data/api.json')) {
    event.respondWith(jaringanDulu(req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(jaringanDulu(req, './index.html'));
    return;
  }

  event.respondWith(cacheDuluSegarkan(req));
});

async function jaringanDulu(req, cadangan) {
  const cache = await caches.open(VERSI);
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    const tersimpan = (await cache.match(req)) || (cadangan ? await cache.match(cadangan) : null);
    if (tersimpan) return tersimpan;
    throw e;
  }
}

async function cacheDuluSegarkan(req) {
  const cache = await caches.open(VERSI);
  const tersimpan = await cache.match(req);
  const segar = fetch(req)
    .then((resp) => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => null);
  return tersimpan || (await segar) || Response.error();
}
