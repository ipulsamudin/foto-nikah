// Kartu QR siap cetak.
//
// QR dirender dari pustaka yang di-pin di vendor/, BUKAN dari api.qrserver.com
// seperti undangan cetak: kartu ini mungkin dicetak dari laptop di venue tanpa
// internet, dan QR yang gagal muncul berarti seluruh booth tidak bisa dipakai.

import qrcode from '../vendor/qrcode-generator-1.4.4.esm.js';

const KONFIG = window.FOTO_NIKAH || {};
const acara = KONFIG.acara || {};

/** Alamat yang akan dicetak. Sekali kartu dicetak, alamat ini tidak bisa diubah. */
function alamatDasar() {
  const p = new URLSearchParams(location.search);
  if (p.get('url')) return p.get('url');
  if (KONFIG.qrUrl) return KONFIG.qrUrl;
  // Cadangan terakhir: alamat halaman ini sendiri, tanpa /cetak/.
  return location.origin + location.pathname.replace(/cetak\/qr\.html.*$/, '');
}

function alamatDenganSesi(sesi) {
  const dasar = alamatDasar();
  if (!sesi) return dasar;
  return dasar + (dasar.includes('?') ? '&' : '?') + 'sesi=' + encodeURIComponent(sesi);
}

function svgQr(teks, ukuranSel) {
  // Koreksi galat Q (bukan M): standee kertas kena jari, tumpahan minuman, dan
  // cahaya remang. Q memberi margin pemulihan yang jauh lebih longgar.
  const q = qrcode(0, 'Q');
  q.addData(teks);
  q.make();
  // Quiet zone 4 modul adalah syarat spesifikasi QR, dan QR cetak yang mepet ke
  // tepi kartu adalah penyebab gagal-scan nomor satu.
  return q.createSvgTag({ cellSize: ukuranSel, margin: ukuranSel * 4, scalable: true });
}

function kartu(sesi, kecil) {
  const alamat = alamatDenganSesi(sesi);
  const tampil = alamat.replace(/^https?:\/\//, '');
  const d = document.createElement('article');
  d.className = 'kartu' + (kecil ? ' kecil' : '');
  d.innerHTML = `
    <p class="mempelai">${acara.mempelai || ''}</p>
    <p class="tanggal">${acara.tanggalSingkat || ''}</p>
    <h1>Ambil Foto di Pesta Kami</h1>
    <div class="qr">${svgQr(alamat, 8)}</div>
    <p class="alamat">${tampil}</p>
    <ol class="langkah">
      <li><b>Pindai</b> QR ini dengan kamera HP.</li>
      <li><b>Tulis nama</b> Anda sekali.</li>
      <li><b>Ambil foto</b> sepuasnya.</li>
      <li>Foto <b>terkirim ke kami</b> dan bisa <b>Anda simpan sendiri</b>.</li>
    </ol>
    <p class="jaring">Sinyal lemah? <b>Tetap ambil foto</b> — foto tersimpan di HP Anda
    dan terkirim sendiri saat sinyal kembali. Jangan tutup halamannya dulu.</p>
    <p class="kaki">
      ${sesi ? `<span class="sesi">${sesi}</span>` : ''}
      ${KONFIG.bantuanWa ? `Tidak bisa kirim? WhatsApp ${KONFIG.bantuanWa}` : ''}
    </p>
    <p class="wifi">WiFi: ______________________ &nbsp; Sandi: ______________________</p>
  `;
  return d;
}

function gambar() {
  const jumlah = Number(document.querySelector('#jumlah').value) || 2;
  const sesi = document.querySelector('#sesi').value.trim();
  const lembar = document.querySelector('#lembar');
  lembar.innerHTML = '';
  lembar.dataset.jumlah = String(jumlah);
  for (let i = 0; i < jumlah; i++) lembar.append(kartu(sesi, jumlah >= 8));
}

const p = new URLSearchParams(location.search);
document.querySelector('#sesi').value = p.get('sesi') || '';
if (p.get('n')) document.querySelector('#jumlah').value = p.get('n');

document.querySelector('#jumlah').addEventListener('change', gambar);
document.querySelector('#sesi').addEventListener('input', gambar);
document.querySelector('#cetak').addEventListener('click', () => window.print());

gambar();
