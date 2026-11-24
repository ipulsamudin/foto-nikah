// Rute `#/` — gerbang nama, layar jepret, dan layar hasil, SEMUA di satu rute.
//
// Ketiganya ditukar lewat DOM dan bukan lewat perubahan hash, karena di PWA
// standalone iOS izin kamera dicabut setiap hash berubah (lihat router.js).
// Konsekuensi penting lainnya: tombol "Simpan ke galeri" bisa memanggil
// navigator.share LANGSUNG di dalam handler tap, tanpa await apa pun sebelumnya —
// iOS membatalkan share yang kehilangan aktivasi pengguna.

import { buat, el, notif, tampilkanPanel, kebunUrl, denganSibuk } from '../ui.js';
import { esc, uuid, namaBerkas, ukuranSingkat } from '../fmt.js';
import { namaTersimpan, simpanNama, sudahDiisi, namaDariUrl, namaEfektif, sesiDariUrl, idPerangkat } from '../tamu.js';
import * as kamera from '../kamera.js';
import { pasangPemilih } from '../berkas-kamera.js';
import { dariVideo, dariBerkas, buatThumb, GalatGambar } from '../gambar.js';
import { gambarBingkai } from '../bingkai.js';
import * as antrean from '../antrean.js';
import { dorong } from '../unggah.js';
import { simpanKeGaleri, bisaBagikanBerkas, iniIos } from '../simpan-galeri.js';

const KONFIG = () => globalThis.FOTO_NIKAH || {};

let taman = null;
let pemilih = null;
let fotoTerakhir = null; // { blob, nama, kunci }

export const judulHalaman = 'Ambil Foto';

export async function bongkar() {
  kamera.hentikan();
  if (taman) taman.bersihkan();
  if (pemilih) pemilih.lepas();
  taman = null;
  pemilih = null;
  fotoTerakhir = null;
}

export async function render(wadah) {
  taman = kebunUrl();
  const k = KONFIG();
  const acara = k.acara || {};

  wadah.append(
    buat('section', { 'data-panel': 'nama', kelas: 'kartu tengah' }, ''),
    buat('section', { 'data-panel': 'jepret', kelas: 'panel-jepret' }, ''),
    buat('section', { 'data-panel': 'hasil', kelas: 'panel-hasil' }, '')
  );

  gambarPanelNama(el('[data-panel="nama"]'), acara);
  gambarPanelJepret(el('[data-panel="jepret"]'), acara);

  pemilih = pasangPemilih(wadah, (berkas) => dariBerkasLalu(berkas));

  if (sudahDiisi() || namaDariUrl()) {
    tampilkanPanel('jepret');
    await nyalakanKamera();
  } else {
    tampilkanPanel('nama');
  }
}

/* ------------------------------------------------------------ gerbang nama */

function gambarPanelNama(induk, acara) {
  induk.innerHTML = `
    <p class="mempelai">${esc(acara.mempelai || 'Kami')}</p>
    <p class="tanggal">${esc(acara.tanggalSingkat || '')}</p>
    <h1>Bantu kami mengumpulkan foto hari ini</h1>
    <p class="redup">Nama Anda dipakai untuk menandai foto yang Anda ambil. Cukup sekali isi.</p>
    <label class="label" for="isi-nama">Nama Anda</label>
    <input id="isi-nama" class="isian" type="text" inputmode="text" autocomplete="name"
           maxlength="60" placeholder="contoh: Rani Agustina">
    <button id="tombol-lanjut" class="tombol utama">Mulai Ambil Foto</button>
    <button id="tombol-lewati" class="tombol teks">Lewati, tanpa nama</button>
  `;

  const isian = el('#isi-nama', induk);
  isian.value = namaTersimpan() || namaDariUrl();

  const lanjut = async () => {
    simpanNama(isian.value);
    tampilkanPanel('jepret');
    await nyalakanKamera();
  };

  el('#tombol-lanjut', induk).addEventListener('click', lanjut);
  el('#tombol-lewati', induk).addEventListener('click', async () => {
    simpanNama('');
    tampilkanPanel('jepret');
    await nyalakanKamera();
  });
  isian.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lanjut();
  });
}

/* -------------------------------------------------------------- panel jepret */

function gambarPanelJepret(induk, acara) {
  induk.innerHTML = `
    <div class="bidik">
      <video id="bidik-video" playsinline muted autoplay></video>
      <div id="bidik-pesan" class="bidik-pesan" hidden></div>
      <p class="bidik-cap">${esc(acara.mempelai || '')} &middot; ${esc(acara.tanggalSingkat || '')}</p>
    </div>
    <div class="aksi-jepret">
      <button id="tombol-jepret" class="shutter" aria-label="Ambil foto"><span></span></button>
    </div>
    <div class="aksi-samping">
      <button id="tombol-kamera-hp" class="tombol halus">Pakai kamera HP</button>
      <button id="tombol-galeri" class="tombol halus">Pilih dari galeri</button>
    </div>
  `;

  el('#tombol-jepret', induk).addEventListener('click', (ev) => jepretSekarang(ev.currentTarget));
  el('#tombol-kamera-hp', induk).addEventListener('click', () => pemilih.bukaKamera());
  el('#tombol-galeri', induk).addEventListener('click', () => pemilih.bukaGaleri());
}

async function nyalakanKamera() {
  const video = el('#bidik-video');
  const pesan = el('#bidik-pesan');
  if (!video) return;

  if (kamera.iniWebviewAplikasi()) {
    tampilPesanBidik(
      'Anda membuka halaman ini dari dalam aplikasi chat. Kameranya sering tidak diizinkan di sini — pakai tombol <b>Pakai kamera HP</b> di bawah, atau buka lewat Chrome/Safari.'
    );
    return;
  }

  try {
    await kamera.mulai(video);
    pesan.hidden = true;
    video.hidden = false;
    el('#tombol-jepret').hidden = false;
  } catch (e) {
    // Bukan keadaan darurat: jalur kamera HP setara dan selalu tersedia.
    tampilPesanBidik(
      `${esc(e?.message || 'Kamera tidak bisa dibuka.')}<br><br>Gunakan tombol <b>Pakai kamera HP</b> di bawah — hasilnya sama, dan di Android fotonya otomatis tersimpan ke galeri Anda.`
    );
  }
}

function tampilPesanBidik(html) {
  const pesan = el('#bidik-pesan');
  const video = el('#bidik-video');
  const jepret = el('#tombol-jepret');
  if (!pesan) return;
  pesan.innerHTML = html;
  pesan.hidden = false;
  if (video) video.hidden = true;
  if (jepret) jepret.hidden = true;
}

function overlay() {
  const acara = KONFIG().acara || {};
  if (KONFIG().watermark === false) return undefined;
  return (ctx, w, h) =>
    gambarBingkai(ctx, w, h, {
      teks: acara.teksWatermark || `${acara.mempelai || ''} · ${acara.tanggalSingkat || ''}`,
      namaTamu: namaEfektif() === 'Tamu' ? '' : namaEfektif()
    });
}

async function jepretSekarang(tombol) {
  const video = el('#bidik-video');
  try {
    const hasil = await denganSibuk(tombol, '', () =>
      dariVideo(video, { gambarOverlay: overlay() })
    );
    await simpanFoto(hasil);
  } catch (e) {
    notif(e?.message || 'Gagal mengambil foto', 'galat');
  }
}

async function dariBerkasLalu(berkas) {
  try {
    const hasil = await dariBerkas(berkas, { gambarOverlay: overlay() });
    await simpanFoto(hasil);
  } catch (e) {
    if (e instanceof GalatGambar && e.kode === 'heic') {
      // Lebih baik HEIC mendarat di Drive daripada tamu kehilangan fotonya.
      // Mempelai bisa mengonversinya massal nanti.
      await simpanFoto({ blob: berkas, lebar: 0, tinggi: 0, sumber: 'berkas', mentah: true });
      notif('Foto iPhone (HEIC) dikirim apa adanya.', 'info');
      return;
    }
    notif(e?.message || 'Foto tidak bisa dibaca', 'galat');
  }
}

/* ----------------------------------------------------------- simpan + antre */

/**
 * URUTAN DI SINI ADALAH JANJI PRODUKNYA: tulis ke IndexedDB DULU, baru tampilkan
 * hasil, baru kirim. Tidak ada jalur kode yang boleh menampilkan "berhasil"
 * sebelum byte-nya benar-benar tersimpan di perangkat.
 */
async function simpanFoto({ blob, lebar, tinggi, sumber, mentah }) {
  const kunci = uuid();
  const waktu = Date.now();
  const nama = namaEfektif();
  const berkas = namaBerkas({ waktu, nama, kunci, ekstensi: mentah ? 'heic' : 'jpg' });

  let thumb = null;
  try {
    thumb = await buatThumb(blob);
  } catch {
    // Thumbnail hanya untuk kenyamanan halaman "Foto Saya". Kegagalannya tidak
    // boleh menggagalkan penyimpanan foto.
  }

  try {
    await antrean.tambah({
      kunci,
      waktu,
      namaTamu: nama,
      sesi: sesiDariUrl(),
      device: idPerangkat(),
      mime: blob.type || 'image/jpeg',
      lebar,
      tinggi,
      ukuran: blob.size,
      namaBerkas: berkas,
      sumber,
      blob,
      thumb
    });
  } catch (e) {
    // IndexedDB diblokir atau penuh. Jangan pura-pura sukses: tampilkan fotonya
    // dan minta tamu menyimpannya ke galeri sekarang, sebelum halaman ditutup.
    tampilkanHasil({ blob, berkas, kunci, tanpaAntrean: true });
    notif('Foto ini belum bisa disimpan di HP Anda. Simpan ke galeri sekarang.', 'galat', 8000);
    return;
  }

  tampilkanHasil({ blob, berkas, kunci });
  dorong();
}

/* --------------------------------------------------------------- panel hasil */

function tampilkanHasil({ blob, berkas, kunci, tanpaAntrean }) {
  fotoTerakhir = { blob, nama: berkas, kunci };
  const induk = el('[data-panel="hasil"]');
  const url = taman.url(blob);
  const ios = iniIos();
  const bisaBagi = bisaBagikanBerkas(blob, berkas);

  const petunjuk = bisaBagi
    ? ios
      ? 'Di menu yang muncul, pilih <b>Save Image</b>.'
      : 'Pilih <b>Foto</b> atau <b>Google Photos</b> di menu yang muncul.'
    : ios
      ? 'Di iPhone, cara termudah: <b>tahan foto di atas</b> lalu pilih <b>Add to Photos</b>.'
      : 'Foto akan masuk ke folder <b>Download</b> dan terlihat di galeri.';

  induk.innerHTML = `
    <img id="hasil-gambar" class="hasil-gambar" src="${url}" alt="Foto yang baru diambil">
    <p class="redup kecil">${ukuranSingkat(blob.size)} &middot; ${
      tanpaAntrean ? 'belum masuk antrean' : 'tersimpan di HP, menunggu terkirim'
    }</p>
    <button id="tombol-simpan" class="tombol utama">Simpan ke galeri HP</button>
    <p class="petunjuk">${petunjuk}</p>
    <p class="petunjuk redup">Atau <b>tahan foto di atas</b> lalu pilih simpan gambar.</p>
    <button id="tombol-lagi" class="tombol halus">Ambil foto lagi</button>
  `;

  // Blob sudah siap sebelum tombol muncul, jadi handler di bawah bisa memanggil
  // share tanpa await apa pun — syarat mutlak agar share sheet iOS tidak batal.
  el('#tombol-simpan', induk).addEventListener('click', () => simpanLalu());
  el('#tombol-lagi', induk).addEventListener('click', async () => {
    tampilkanPanel('jepret');
    if (!kamera.sedangMenyala()) await nyalakanKamera();
  });

  tampilkanPanel('hasil');
}

function simpanLalu() {
  if (!fotoTerakhir) return;
  const { blob, nama, kunci } = fotoTerakhir;
  simpanKeGaleri(blob, nama)
    .then(async ({ cara, dibatalkan }) => {
      if (dibatalkan) return;
      if (cara === 'manual') {
        notif('Tahan foto di atas, lalu pilih "Add to Photos".', 'info', 6000);
        return;
      }
      notif('Tersimpan ke galeri HP Anda.', 'sukses');
      try {
        await antrean.perbarui(kunci, { keGaleri: true });
        await antrean.bersihkanBlob(kunci);
      } catch {
        /* penandaan ini hanya untuk pembersihan penyimpanan; tidak kritis */
      }
    })
    .catch(() => notif('Gagal menyimpan. Coba tahan foto di atas.', 'galat'));
}
