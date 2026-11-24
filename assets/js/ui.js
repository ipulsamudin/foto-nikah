// Pembantu DOM. Sengaja mungil: tidak ada kerangka kerja, tidak ada build step.

import { esc } from './fmt.js';

export function el(pemilih, akar = document) {
  return akar.querySelector(pemilih);
}

export function semua(pemilih, akar = document) {
  return Array.from(akar.querySelectorAll(pemilih));
}

export function buat(tag, atribut = {}, isi = '') {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(atribut)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'kelas') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  if (isi) n.textContent = isi;
  return n;
}

export function kosongkan(n) {
  while (n && n.firstChild) n.removeChild(n.firstChild);
  return n;
}

let jamNotif = null;

/**
 * Pesan sekilas. Namanya meniru showNotification() di undangan digital supaya
 * perbendaharaan kata antarproyek tetap sama.
 */
export function notif(pesan, tipe = 'info', ms = 3600) {
  const wadah = el('#notif');
  if (!wadah) return;
  wadah.className = `notif tampil ${tipe}`;
  wadah.innerHTML = esc(pesan);
  if (jamNotif) clearTimeout(jamNotif);
  jamNotif = setTimeout(() => {
    wadah.className = 'notif';
  }, ms);
}

/**
 * Taman object URL.
 *
 * Mengganti elemen DOM TIDAK mencabut object URL. Tanpa pembukuan ini, tamu yang
 * berpindah panel dua puluh kali membocorkan dua puluh blob foto — dan iOS
 * membunuh tab yang memakai terlalu banyak memori justru saat tamu sedang
 * bersemangat menjepret.
 */
export function kebunUrl() {
  const daftar = [];
  return {
    url(blob) {
      const u = URL.createObjectURL(blob);
      daftar.push(u);
      return u;
    },
    bersihkan() {
      while (daftar.length) URL.revokeObjectURL(daftar.pop());
    }
  };
}

export function tampilkanPanel(nama) {
  for (const p of semua('[data-panel]')) {
    p.hidden = p.dataset.panel !== nama;
  }
}

/** Nonaktifkan tombol sementara kerja berjalan, tanpa kehilangan labelnya. */
export async function denganSibuk(tombol, labelSibuk, kerja) {
  if (!tombol) return kerja();
  const semula = tombol.textContent;
  tombol.disabled = true;
  tombol.textContent = labelSibuk;
  try {
    return await kerja();
  } finally {
    tombol.disabled = false;
    tombol.textContent = semula;
  }
}
