// Logika murni halaman cetak QR: alamat, mode lembar, geometri PNG, nama berkas.
//
// Dipisah dari qr.js BUKAN demi kerapian. qr.js menyentuh DOM di tingkat atas,
// jadi tools/selftest.mjs tidak bisa mengimpornya di Node sama sekali — dan yang
// ada di berkas ini justru logika yang kalau salah baru ketahuan SETELAH 200
// kartu atau satu X-banner tercetak dengan alamat atau ukuran yang keliru.
// Kesalahan itu tidak bisa ditarik kembali, jadi ia harus bisa diassertion.
// Maka: tanpa DOM, tanpa window, tanpa jaringan.

import { slugNama } from '../assets/js/fmt.js';

/** Quiet zone 4 modul: syarat spesifikasi QR, dan penyebab gagal-scan nomor satu. */
export const KUIET_MODUL = 4;

/**
 * Sisi PNG yang dituju.
 *
 * 2048 dipilih karena satu berkas harus melayani tiga tujuan sekaligus: ditempel
 * 60 mm di undangan digital (±850 dpi, berlebih dan aman), dibesarkan 480 mm jadi
 * X-banner (±106 dpi, wajar untuk format besar), dan dikirim WhatsApp yang
 * merekompresi ke ±1600 px JPEG (satu modul masih ±39 px — jauh di atas ukuran
 * yang bisa ditelan artefak JPEG).
 */
export const PX_TARGET_PNG = 2048;

/** Harus sama dengan nilai <option> di qr.html. */
export const NILAI_LEMBAR = ['2', '4', '8', 'poster'];

/**
 * Nilai select / `?n=` → mode yang sah.
 *
 * MENGAPA bukan `Number(nilai) || 2` seperti sebelumnya: `Number('poster')` adalah
 * NaN, dan `NaN || 2` adalah 2 — jadi memilih Poster akan diam-diam menggambar dua
 * kartu biasa. Dan `?n=99` dulu ditulis apa adanya ke <select>, membuat
 * selectedIndex -1 sehingga toolbar tampak KOSONG padahal lembarnya tergambar 2
 * kartu. Nilai yang dinormalkan di sini ditulis balik ke select, jadi yang
 * terlihat selalu sama dengan yang tergambar.
 */
export function modeLembar(nilai) {
  const v = String(nilai ?? '').trim();
  const sah = NILAI_LEMBAR.includes(v) ? v : '2';
  return {
    nilai: sah,
    poster: sah === 'poster',
    jumlah: sah === 'poster' ? 1 : Number(sah)
  };
}

/**
 * Alamat yang akan dicetak. Sekali kartu dicetak, alamat ini tidak bisa diubah.
 *
 * Prioritas: `?url=` (untuk uji) → KONFIG.qrUrl (produksi) → halaman ini sendiri.
 * `location` disuntik sebagai argumen, bukan dibaca langsung, supaya prioritas ini
 * bisa diassertion tanpa browser.
 */
export function alamatDasar({ cari = '', urlKonfig = '', asal = '', jalur = '' } = {}) {
  // Spasi dibuang lebih dulu: `?url=` yang kosong atau hanya spasi TIDAK boleh
  // mengalahkan qrUrl produksi, karena hasilnya QR yang menunjuk ke mana-mana.
  const dariUrl = (new URLSearchParams(cari).get('url') || '').trim();
  if (dariUrl) return dariUrl;
  if (urlKonfig) return urlKonfig;
  // Cadangan terakhir: alamat halaman ini sendiri, tanpa /cetak/.
  return asal + jalur.replace(/cetak\/qr\.html.*$/, '');
}

export function alamatDenganSesi(dasar, sesi) {
  const s = String(sesi ?? '').trim();
  // Sesi kosong harus menghasilkan alamat apa adanya: QR yang berakhir `?sesi=`
  // membuat kolom sesi di Sheet berisi string kosong, bukan 'umum'.
  if (!s) return String(dasar ?? '');
  const d = String(dasar ?? '');
  return d + (d.includes('?') ? '&' : '?') + 'sesi=' + encodeURIComponent(s);
}

/**
 * Geometri PNG.
 *
 * Invarian yang dijaga: `sisi` HABIS DIBAGI jumlah modul + quiet zone, jadi setiap
 * modul menempati bilangan bulat piksel. Modul berukuran 48,7 piksel berarti tepi
 * yang di-antialias, dan QR kabur = gagal scan — baru ketahuan sesudah kertasnya
 * keluar dari percetakan.
 *
 * Jumlah modul TIDAK boleh dipatok konstanta: menambahkan `?sesi=akad` mendorong
 * kode dari versi 4 (33 modul) ke versi 5 (37 modul).
 */
export function geometriPng(jumlahModul, target = PX_TARGET_PNG) {
  const total = Math.max(1, Math.round(jumlahModul)) + KUIET_MODUL * 2;
  // max(1, ...): target absurd tidak boleh menghasilkan sel 0 → kanvas 0×0 yang
  // "berhasil" diunduh sebagai berkas kosong.
  const sel = Math.max(1, Math.floor(target / total));
  return { total, sel, sisi: sel * total };
}

/**
 * `qr-foto-nikah-akad-2025px.png`
 *
 * Sesi ikut ke nama berkas karena dua standee yang diunduh berurutan akan menjadi
 * "qr.png" dan "qr (1).png" di folder Download, dan tidak ada lagi cara
 * membedakannya tanpa memindai ulang — lalu 200 undangan tercetak dengan QR sesi
 * yang salah. Ukuran piksel ikut supaya percetakan tahu resolusi masternya tanpa
 * perlu bertanya.
 */
export function namaBerkasPng(sesi, sisi) {
  // slugNama mengembalikan 'Tamu' untuk masukan kosong — benar untuk nama tamu,
  // salah total di sini. Jadi kasus kosong ditangani SEBELUM memanggilnya.
  const label = String(sesi ?? '').trim() ? slugNama(sesi) : 'umum';
  return `qr-foto-nikah-${label}-${sisi}px.png`;
}
