// Titik awal aplikasi.

import { mulaiRouter, jalur } from './router.js';
import { el, semua } from './ui.js';
import { jumlahFoto } from './fmt.js';
import { mintaPenyimpananPersisten } from './antrean.js';
import { mulaiPengirim, onPerubahan } from './unggah.js';
import * as beranda from './views/beranda.js';
import * as saya from './views/saya.js';
import * as info from './views/info.js';

const RUTE = {
  '/': beranda,
  '/saya': saya,
  '/info': info,
  '*': beranda
};

function pasangTab() {
  const segarkan = () => {
    const p = jalur();
    for (const a of semua('.tab')) {
      a.classList.toggle('aktif', a.getAttribute('href') === `#${p}`);
    }
  };
  addEventListener('hashchange', segarkan);
  segarkan();
}

/**
 * Indikator antrean yang menempel di layar.
 *
 * Tamu tidak boleh merasa fotonya hilang. Satu baris jujur di bawah layar jauh
 * lebih menenangkan daripada diam — dan ini juga pertahanan utama kita terhadap
 * tamu yang menutup tab di tengah pengiriman, karena `beforeunload` diabaikan
 * di iOS Safari dan makin dibatasi di Chrome.
 */
function pasangIndikator() {
  const kotak = el('#antrean-chip');
  onPerubahan((r) => {
    if (!kotak) return;
    if (!r.menunggu) {
      kotak.hidden = true;
      return;
    }
    kotak.hidden = false;
    kotak.textContent =
      `${jumlahFoto(r.menunggu)} menunggu terkirim` +
      (r.gagal ? ` · ${r.gagal} perlu dicoba lagi` : '') +
      ' — biarkan halaman ini terbuka';
  });
}

function pasangServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Shell harus bisa dibuka tanpa internet: tamu memindai QR di venue dengan
  // jaringan padat, dan kalau HTML/JS harus diambil dari jaringan, halaman
  // berputar dan foto itu TIDAK PERNAH TERJADI.
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* tanpa SW aplikasi tetap jalan, hanya tidak offline-first */
    });
  });
}

async function mulai() {
  pasangTab();
  pasangIndikator();
  pasangServiceWorker();
  mintaPenyimpananPersisten();
  await mulaiRouter(RUTE);
  mulaiPengirim();
}

mulai();
