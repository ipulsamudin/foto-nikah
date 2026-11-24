// Rute `#/info` — bantuan untuk tamu, dan diagnosa untuk yang menjaga booth.
//
// Halaman ini yang menyelamatkan hari-H: ketika ada yang bilang "fotonya tidak
// terkirim", satu layar ini menjawab apakah masalahnya konfigurasi, jaringan,
// izin, atau backend — tanpa perlu menyambungkan HP tamu ke laptop.

import { buat, el, notif } from '../ui.js';
import { esc, ukuranSingkat } from '../fmt.js';
import { namaTersimpan, simpanNama, lupakanSaya, idPerangkat, sesiDariUrl } from '../tamu.js';
import * as antrean from '../antrean.js';
import { muatKonfig, siap, cekSehat } from '../indeks.js';
import { probeOrientasi } from '../gambar.js';
import { bisaBagikanBerkas, iniIos } from '../simpan-galeri.js';
import { dukungKameraLangsung, iniWebviewAplikasi } from '../kamera.js';

export const judulHalaman = 'Info & Bantuan';

export async function render(wadah) {
  const k = globalThis.FOTO_NIKAH || {};
  const acara = k.acara || {};

  wadah.append(
    buat('div', {
      kelas: 'kartu',
      html: `
        <h1>Info</h1>
        <p class="mempelai kecil">${esc(acara.mempelai || '')}</p>
        <p class="redup">${esc(acara.tanggalTampil || '')}${
          acara.lokasi ? ` &middot; ${esc(acara.lokasi)}` : ''
        }</p>
        <p>Foto yang Anda ambil di halaman ini tersimpan <b>di HP Anda</b> dan dikirim ke
        Google Drive mempelai begitu sinyal memungkinkan. Sinyal jelek bukan masalah:
        foto tetap aman dan terkirim sendiri nanti.</p>
        ${
          k.albumUrl
            ? `<a class="tombol halus" href="${esc(k.albumUrl)}" target="_blank" rel="noopener">Lihat semua foto di album Drive</a>`
            : ''
        }
      `
    })
  );

  /* ------------------------------------------------------------ ganti nama */
  const kartuNama = buat('div', {
    kelas: 'kartu',
    html: `
      <h2>Nama Anda</h2>
      <label class="label" for="ganti-nama">Dipakai untuk menandai foto Anda</label>
      <input id="ganti-nama" class="isian" type="text" maxlength="60" value="${esc(namaTersimpan())}">
      <button id="simpan-nama" class="tombol halus">Simpan nama</button>
    `
  });
  wadah.append(kartuNama);
  el('#simpan-nama', kartuNama).addEventListener('click', () => {
    simpanNama(el('#ganti-nama', kartuNama).value);
    notif('Nama disimpan.', 'sukses');
  });

  /* ---------------------------------------------------------------- bantuan */
  wadah.append(
    buat('div', {
      kelas: 'kartu',
      html: `
        <h2>Kalau ada yang tidak jalan</h2>
        <p><b>Kamera tidak muncul?</b> Pakai tombol <i>Pakai kamera HP</i>. Hasilnya sama,
        dan di Android fotonya otomatis ikut tersimpan ke galeri Anda.</p>
        <p><b>Membuka dari WhatsApp/Instagram?</b> Kamera sering diblokir di dalam aplikasi
        chat. Buka alamat ini di Chrome atau Safari.</p>
        <p><b>Foto tidak masuk galeri HP?</b> ${
          iniIos()
            ? 'Di iPhone, tahan foto beberapa saat lalu pilih <b>Add to Photos</b>. Unduhan biasa masuk ke aplikasi Files, bukan ke Foto.'
            : 'Cek folder <b>Download</b> di galeri, atau tekan tombol Simpan lalu pilih Foto/Google Photos.'
        }</p>
        <p><b>Tulisan "menunggu terkirim" tidak hilang?</b> Itu normal saat sinyal padat.
        Biarkan halaman ini terbuka; pengiriman dilanjutkan sendiri. Anda juga bisa membukanya
        lagi nanti di rumah dan foto akan menyusul.</p>
      `
    })
  );

  /* --------------------------------------------------------------- diagnosa */
  const kartuDiag = buat('div', { kelas: 'kartu', html: '<h2>Diagnosa</h2><div id="diag">Memeriksa…</div>' });
  wadah.append(kartuDiag);
  gambarDiagnosa(el('#diag', kartuDiag));

  /* ------------------------------------------------------------- reset data */
  const kartuReset = buat('div', {
    kelas: 'kartu',
    html: `
      <h2>Hapus data saya di HP ini</h2>
      <p class="redup kecil">Menghapus nama, riwayat "Foto Saya", dan antrean yang belum
      terkirim di perangkat ini. Foto yang sudah masuk Drive mempelai tidak terhapus.</p>
      <button id="reset" class="tombol bahaya">Hapus data lokal</button>
    `
  });
  wadah.append(kartuReset);
  el('#reset', kartuReset).addEventListener('click', async () => {
    const r = await antrean.hitung();
    if (r.menunggu > 0) {
      notif(`Masih ada ${r.menunggu} foto yang belum terkirim. Kirim dulu sebelum menghapus.`, 'galat', 7000);
      return;
    }
    for (const b of await antrean.ambilSemua()) await antrean.hapus(b.kunci);
    lupakanSaya();
    notif('Data lokal dihapus.', 'sukses');
    location.hash = '/';
  });
}

async function gambarDiagnosa(kotak) {
  const baris = [];
  const konfig = await muatKonfig();
  const terkonfigurasi = await siap();

  baris.push(['Perangkat', idPerangkat().slice(0, 8)]);
  baris.push(['Sesi (dari QR)', sesiDariUrl()]);
  baris.push(['Konteks aman (https)', window.isSecureContext ? 'ya' : 'TIDAK — kamera diblokir']);
  baris.push(['Kamera dalam halaman', dukungKameraLangsung() ? 'didukung' : 'tidak didukung']);
  baris.push(['Webview aplikasi chat', iniWebviewAplikasi() ? 'ya' : 'tidak']);
  baris.push([
    'Simpan ke galeri',
    bisaBagikanBerkas(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'uji.jpg')
      ? 'lewat share sheet'
      : iniIos()
        ? 'tahan foto → Add to Photos'
        : 'lewat unduhan'
  ]);
  baris.push(['Orientasi EXIF ditangani browser', (await probeOrientasi()) ? 'ya' : 'tidak (kami tegakkan sendiri)']);

  const r = await antrean.hitung();
  baris.push(['Antrean', `${r.total} total, ${r.menunggu} menunggu, ${r.gagal} gagal`]);

  try {
    if (navigator.storage?.estimate) {
      const s = await navigator.storage.estimate();
      baris.push(['Penyimpanan terpakai', `${ukuranSingkat(s.usage || 0)} dari ${ukuranSingkat(s.quota || 0)}`]);
    }
  } catch {
    /* tidak semua browser punya estimate */
  }

  baris.push(['Alamat backend', terkonfigurasi ? 'terisi' : 'BELUM DIISI (data/api.json)']);

  kotak.innerHTML = tabel(baris);

  if (!terkonfigurasi) {
    kotak.insertAdjacentHTML(
      'beforeend',
      '<p class="redup kecil">Backend belum dipasang. Foto tetap tersimpan di HP dan bisa disimpan ke galeri; pengiriman ditahan sampai alamat diisi.</p>'
    );
    return;
  }

  // Panggilan sehat SENGAJA tanpa token, supaya "backend mati" bisa dibedakan
  // dari "token salah".
  try {
    const s = await cekSehat();
    kotak.innerHTML = tabel(
      baris.concat([
        ['Backend', `hidup, versi ${s.versi || '?'}`],
        ['Booth aktif', s.aktif ? 'ya' : 'TIDAK (saklar dimatikan)'],
        ['Dalam jendela acara', s.jendela?.di_dalam ? 'ya' : 'TIDAK'],
        ['Foto hari ini', String(s.terpakai_hari_ini ?? '?')],
        ['Waktu server', String(s.waktu_server || '?')]
      ])
    );
  } catch (e) {
    kotak.innerHTML = tabel(baris.concat([['Backend', `TIDAK MENJAWAB — ${esc(e?.message || '')}`]]));
  }

  if (konfig?.dasar) {
    kotak.insertAdjacentHTML(
      'beforeend',
      `<p class="redup kecil">Endpoint: ${esc(String(konfig.dasar).slice(0, 72))}…</p>`
    );
  }
}

function tabel(baris) {
  return `<table class="diag">${baris
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`)
    .join('')}</table>`;
}
