// Kartu QR siap cetak, poster satu-QR-besar, dan unduh PNG.
//
// QR dirender dari pustaka yang di-pin di vendor/, BUKAN dari api.qrserver.com
// seperti undangan cetak: kartu ini mungkin dicetak dari laptop di venue tanpa
// internet, dan QR yang gagal muncul berarti seluruh booth tidak bisa dipakai.
//
// Logika yang tidak menyentuh DOM ada di qr-inti.js supaya bisa diassertion dari
// Node — lihat alasannya di kepala berkas itu.

import qrcode from '../vendor/qrcode-generator-1.4.4.esm.js';
import { esc } from '../assets/js/fmt.js';
import {
  alamatDasar,
  alamatDenganSesi,
  modeLembar,
  geometriPng,
  namaBerkasPng,
  KUIET_MODUL,
  PX_TARGET_PNG
} from './qr-inti.js';

const KONFIG = window.FOTO_NIKAH || {};
const acara = KONFIG.acara || {};

/** Satu-satunya tempat di berkas ini yang membaca location. */
function alamatSekarang() {
  return alamatDasar({
    cari: location.search,
    urlKonfig: KONFIG.qrUrl,
    asal: location.origin,
    jalur: location.pathname
  });
}

/** Matriks QR. Diekspor supaya uji asap bisa membandingkan kanvas dengan matriksnya sendiri. */
export function matriksQr(teks) {
  // Koreksi galat Q (bukan M): standee kertas kena jari, tumpahan minuman, dan
  // cahaya remang. Q memberi margin pemulihan yang jauh lebih longgar.
  const q = qrcode(0, 'Q');
  q.addData(teks);
  q.make();
  return q;
}

function svgQr(teks, ukuranSel) {
  const q = matriksQr(teks);
  // Quiet zone 4 modul adalah syarat spesifikasi QR, dan QR cetak yang mepet ke
  // tepi kartu adalah penyebab gagal-scan nomor satu.
  return q.createSvgTag({
    cellSize: ukuranSel,
    margin: ukuranSel * KUIET_MODUL,
    scalable: true
  });
}

/**
 * QR → <canvas>, dengan setiap modul jatuh tepat di batas piksel bulat.
 *
 * SENGAJA menggambar modul sendiri, bukan memakai q.renderTo2dContext(): fungsi
 * vendor itu menulis fillRect(baris*sel, kolom*sel) — sumbu x dan y tertukar,
 * jadi hasilnya QR TERCERMIN, dan ia juga tidak menambahkan quiet zone. Sebagian
 * pemindai memaafkan cermin, sebagian menolak; itu persis kegagalan "jalan di HP
 * saya, gagal di HP tamu" yang tidak bisa kita tanggung. tools/selftest.mjs
 * menjaga cacat vendor itu tetap terdokumentasi.
 *
 * Juga TIDAK lewat SVG → <img> → drawImage: createSvgTag({scalable:true})
 * menghapus width/height, dan WebKit merasterkan SVG tanpa ukuran intrinsik ke
 * 0×0 tanpa melempar galat — tombolnya akan tampak "berhasil" dan menghasilkan
 * PNG kosong. Perasteran berskala pecahan juga mengaburkan tepi modul, dan QR
 * kabur baru ketahuan setelah 200 undangan tercetak.
 */
export function kanvasQr(teks, target = PX_TARGET_PNG) {
  const q = matriksQr(teks);
  const modul = q.getModuleCount();
  const { sel, sisi } = geometriPng(modul, target);

  const kanvas = document.createElement('canvas');
  kanvas.width = sisi;
  kanvas.height = sisi;

  // alpha:false DAN fillRect putih, bukan salah satu saja: opsi konteks boleh
  // diabaikan browser, sementara PNG beralfa yang ditempel di undangan digital
  // bertema gelap menjadi hitam-di-atas-hitam dan tidak terpindai sama sekali.
  const ctx = kanvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sisi, sisi);

  ctx.fillStyle = '#000000';
  const geser = KUIET_MODUL * sel;
  for (let baris = 0; baris < modul; baris++) {
    for (let kolom = 0; kolom < modul; kolom++) {
      // kolom → x, baris → y. Pemetaan ini sama dengan createSvgTag, jadi kartu
      // cetak dan PNG selalu menghasilkan kode yang identik.
      if (q.isDark(baris, kolom)) {
        ctx.fillRect(geser + kolom * sel, geser + baris * sel, sel, sel);
      }
    }
  }
  return { kanvas, sisi, sel, modul };
}

function lapor(teks) {
  const kabar = document.querySelector('#kabar');
  if (kabar) kabar.textContent = teks;
}

function unduhPng() {
  const sesi = document.querySelector('#sesi').value.trim();
  const { kanvas, sisi, sel } = kanvasQr(alamatDenganSesi(alamatSekarang(), sesi));

  if (!kanvas.toBlob) {
    lapor('Peramban ini tidak bisa menyimpan PNG. Buka halaman ini di Chrome atau Edge.');
    return;
  }

  kanvas.toBlob((blob) => {
    if (!blob) {
      lapor('Gagal membuat PNG. Coba lagi, atau pakai tombol Cetak lalu "Simpan sebagai PDF".');
      return;
    }
    const nama = namaBerkasPng(sesi, sisi);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nama;
    // Anchor harus benar-benar ada di dokumen: Firefox mengabaikan click() pada
    // elemen yang masih lepas dari DOM.
    document.body.append(a);
    a.click();
    a.remove();
    // Jangan revoke di tick ini. Unduhan berjalan asinkron, dan mencabut URL
    // sebelum berkasnya selesai ditulis membatalkan unduhan di Safari.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    lapor(`Terunduh: ${nama} — ${sisi} × ${sisi} px, 1 modul = ${sel} px.`);
  }, 'image/png');
}

// Semua yang disisipkan ke innerHTML di-escape. Bukan paranoia teoretis: `sesi`
// dan `?url=` datang dari query string, jadi tautan yang dikirim ke orang lain
// ("ini halaman cetaknya, tinggal tekan Cetak") bisa menjalankan skrip di laptop
// yang memegang akses Drive mempelai. Yang di-escape hanya TEKS TAMPILAN —
// string yang masuk ke addData() tidak boleh pernah di-escape, karena itu akan
// mengubah alamat yang benar-benar ter-encode ke QR.
function kartu(sesi, kecil) {
  const alamat = alamatDenganSesi(alamatSekarang(), sesi);
  const tampil = alamat.replace(/^https?:\/\//, '');
  const d = document.createElement('article');
  d.className = 'kartu' + (kecil ? ' kecil' : '');
  d.innerHTML = `
    <p class="mempelai">${esc(acara.mempelai || '')}</p>
    <p class="tanggal">${esc(acara.tanggalSingkat || '')}</p>
    <h1>Ambil Foto di Pesta Kami</h1>
    <div class="qr">${svgQr(alamat, 8)}</div>
    <p class="alamat">${esc(tampil)}</p>
    <ol class="langkah">
      <li><b>Pindai</b> QR ini dengan kamera HP.</li>
      <li><b>Tulis nama</b> Anda sekali.</li>
      <li><b>Ambil foto</b> sepuasnya.</li>
      <li>Foto <b>terkirim ke kami</b> dan bisa <b>Anda simpan sendiri</b>.</li>
    </ol>
    <p class="jaring">Sinyal lemah? <b>Tetap ambil foto</b> — foto tersimpan di HP Anda
    dan terkirim sendiri saat sinyal kembali. Jangan tutup halamannya dulu.</p>
    <p class="kaki">
      ${sesi ? `<span class="sesi">${esc(sesi)}</span>` : ''}
      ${KONFIG.bantuanWa ? `Tidak bisa kirim? WhatsApp ${esc(KONFIG.bantuanWa)}` : ''}
    </p>
    <p class="wifi">WiFi: ______________________ &nbsp; Sandi: ______________________</p>
  `;
  return d;
}

/**
 * Satu QR memenuhi halaman, untuk X-banner atau papan di pintu masuk.
 *
 * Daftar langkah, paragraf "sinyal lemah", dan baris WiFi DIBUANG: dari jarak 2-3
 * meter tidak satu pun terbaca, dan ruangnya justru dibutuhkan QR. Badge sesi
 * justru paling penting di sini — itu satu-satunya cara tahu banner mana yang
 * mana setelah semuanya tercetak dan tergulung.
 */
function poster(sesi) {
  const alamat = alamatDenganSesi(alamatSekarang(), sesi);
  const d = document.createElement('article');
  d.className = 'kartu poster';
  d.innerHTML = `
    <p class="mempelai">${esc(acara.mempelai || '')}</p>
    <p class="tanggal">${esc(acara.tanggalSingkat || '')}</p>
    <h1>Ambil Foto di Pesta Kami</h1>
    <div class="qr">${svgQr(alamat, 8)}</div>
    <p class="pindai">Pindai dengan kamera HP</p>
    <p class="alamat">${esc(alamat.replace(/^https?:\/\//, ''))}</p>
    <p class="kaki">${sesi ? `<span class="sesi">${esc(sesi)}</span>` : ''}</p>
  `;
  return d;
}

function gambar() {
  const mode = modeLembar(document.querySelector('#jumlah').value);
  const sesi = document.querySelector('#sesi').value.trim();
  const lembar = document.querySelector('#lembar');
  lembar.innerHTML = '';
  // 'poster' sengaja bukan angka: selector [data-jumlah="4"|"8"] yang sudah ada
  // tidak mungkin cocok dengannya, jadi tata letak kartu A4 tidak tersentuh.
  lembar.dataset.jumlah = mode.nilai;
  if (mode.poster) {
    lembar.append(poster(sesi));
    return;
  }
  for (let i = 0; i < mode.jumlah; i++) lembar.append(kartu(sesi, mode.jumlah >= 8));
}

const p = new URLSearchParams(location.search);
document.querySelector('#sesi').value = p.get('sesi') || '';
// Dinormalkan DAN ditulis balik: `?n=99` dulu membuat <select> kehilangan pilihan
// (selectedIndex -1) sehingga toolbar tampak kosong padahal lembarnya tergambar.
if (p.get('n')) document.querySelector('#jumlah').value = modeLembar(p.get('n')).nilai;

document.querySelector('#jumlah').addEventListener('change', gambar);
document.querySelector('#sesi').addEventListener('input', gambar);
document.querySelector('#cetak').addEventListener('click', () => window.print());
document.querySelector('#unduh').addEventListener('click', unduhPng);

gambar();
