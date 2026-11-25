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
import { dariVideo, dariBerkas, buatThumb, putarBlob, GalatGambar } from '../gambar.js';
import { gambarBingkai } from '../bingkai.js';
import * as antrean from '../antrean.js';
import { dorong } from '../unggah.js';
import { simpanKeGaleri, unduhOtomatis, bisaBagikanBerkas, iniIos } from '../simpan-galeri.js';
import { mulaiPantauOrientasi, mintaIzinSensor } from '../orientasi.js';

const KONFIG = () => globalThis.FOTO_NIKAH || {};

let taman = null;
let pemilih = null;
let fotoTerakhir = null; // { blob, nama, kunci }

/**
 * Berapa derajat kanvas perlu diputar supaya foto keluar tegak.
 *
 * Tetap 0 bila rotasi layar HP mengikuti posisi fisiknya (auto-rotate menyala),
 * dan menjadi 90/270 ketika rotasi layar dikunci sementara HP dimiringkan —
 * keadaan yang membuat foto keluar rebah sebelum ini.
 */
let rotasiFoto = 0;
let lepasPantauOrientasi = null;

export const judulHalaman = 'Ambil Foto';

export async function bongkar() {
  kamera.hentikan();
  if (taman) taman.bersihkan();
  if (pemilih) pemilih.lepas();
  if (lepasPantauOrientasi) lepasPantauOrientasi();
  taman = null;
  pemilih = null;
  fotoTerakhir = null;
  lepasPantauOrientasi = null;
  rotasiFoto = 0;
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

  const lanjut = async (nama) => {
    simpanNama(nama);
    // Izin sensor HARUS diminta dari dalam ketukan — iOS menolak permintaan yang
    // datang belakangan. Ketukan "Mulai" ini satu-satunya kesempatan alami
    // sebelum tamu mulai menjepret. Hasilnya tidak ditunggu-tunggu: ditolak pun
    // booth tetap jalan, tinggal tombol Putar manual yang mengambil alih.
    if (KONFIG().putarOtomatis !== false) await mintaIzinSensor();
    tampilkanPanel('jepret');
    await nyalakanKamera();
  };

  el('#tombol-lanjut', induk).addEventListener('click', () => lanjut(isian.value));
  el('#tombol-lewati', induk).addEventListener('click', () => lanjut(''));
  isian.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lanjut(isian.value);
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
      <!-- Tombol jepret sengaja tersembunyi sampai kamera benar-benar punya
           gambar. Kalau ditampilkan lebih awal, tamu menekannya, tidak terjadi
           apa-apa, lalu menyimpulkan booth-nya rusak. -->
      <button id="tombol-jepret" class="shutter" aria-label="Ambil foto" hidden><span></span></button>
      <p id="bidik-menyiapkan" class="redup kecil">Menyiapkan kamera…</p>
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
    pasangRasioBidik(video);
    // mulai() baru selesai setelah video punya ukuran, jadi di titik ini
    // viewfinder benar-benar hidup dan tombol jepret layak ditampilkan.
    el('#tombol-jepret').hidden = false;
    el('#bidik-menyiapkan').hidden = true;
  } catch (e) {
    // Bukan keadaan darurat: jalur kamera HP setara dan selalu tersedia.
    tampilPesanBidik(
      `${esc(e?.message || 'Kamera tidak bisa dibuka.')}<br><br>Gunakan tombol <b>Pakai kamera HP</b> di bawah — hasilnya sama, dan di Android fotonya otomatis tersimpan ke galeri Anda.`
    );
  }
}

/**
 * Samakan bentuk kotak viewfinder dengan bentuk aliran kamera.
 *
 * Inilah janji "yang terlihat = yang tersimpan": dariVideo() menyimpan seluruh
 * frame kamera tanpa crop, jadi satu-satunya cara membuat pratinjau jujur adalah
 * membuat kotaknya berbentuk sama.
 *
 * Dipasang juga dari event `resize` milik <video>, bukan hanya sekali saat
 * mulai. Memutar HP saat kamera menyala mengubah dimensi aliran, dan tanpa
 * pendengar ini ketidakcocokan yang sedang kita perbaiki akan kembali persis
 * pada saat tamu memiringkan HP untuk foto rombongan.
 */
function pasangRasioBidik(video) {
  const kotak = el('.bidik');
  if (!kotak || !video) return;

  const terapkan = () => {
    const { lebar, tinggi } = kamera.ukuranAliran(video);
    if (!lebar || !tinggi) return;

    // Kotak menunjukkan bentuk AKHIR foto, bukan bentuk mentah aliran: kalau
    // kanvas nanti diputar 90°, sisi-sisinya tertukar. Tanpa ini, tamu kembali
    // melihat sesuatu yang berbeda dari yang tersimpan — hanya dengan arah
    // sebaliknya dari cacat sebelumnya.
    const tukar = rotasiFoto === 90 || rotasiFoto === 270;
    kotak.style.setProperty('--rasio-bidik', tukar ? `${tinggi} / ${lebar}` : `${lebar} / ${tinggi}`);

    // Pratinjaunya ikut diputar supaya tamu melihat gambar tegak, sama seperti
    // yang akan tersimpan.
    kotak.classList.toggle('putar-90', rotasiFoto === 90);
    kotak.classList.toggle('putar-270', rotasiFoto === 270);
    kotak.classList.toggle('putar-180', rotasiFoto === 180);
  };

  terapkan();
  video.addEventListener('resize', terapkan);

  if (KONFIG().putarOtomatis === false) return;

  // Pantau posisi fisik HP. Saat rotasi layar dikunci, inilah satu-satunya
  // sumber yang tahu bahwa HP sudah dimiringkan.
  if (lepasPantauOrientasi) lepasPantauOrientasi();
  lepasPantauOrientasi = mulaiPantauOrientasi((derajat) => {
    rotasiFoto = derajat;
    terapkan();
  });
}

function tampilPesanBidik(html) {
  const pesan = el('#bidik-pesan');
  const video = el('#bidik-video');
  const jepret = el('#tombol-jepret');
  const menyiapkan = el('#bidik-menyiapkan');
  if (!pesan) return;
  pesan.innerHTML = html;
  pesan.hidden = false;
  if (video) video.hidden = true;
  if (jepret) jepret.hidden = true;
  if (menyiapkan) menyiapkan.hidden = true;
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
      dariVideo(video, { gambarOverlay: overlay(), rotasi: rotasiFoto })
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

  // Simpan ke galeri HP tanpa menunggu ketukan. Dihitung SEBELUM panel hasil
  // digambar, supaya teks yang muncul menyatakan apa yang benar-benar terjadi
  // dan bukan janji.
  const otomatis = bolehSimpanOtomatis(sumber) && unduhOtomatis(blob, berkas);
  if (otomatis) {
    // Blob penuhnya baru dilepas setelah juga terkirim ke Drive; itu diurus
    // unggah.js lewat antrean.bersihkanBlob().
    try {
      await antrean.perbarui(kunci, { keGaleri: true });
    } catch {
      /* penandaan ini hanya untuk pembersihan penyimpanan; tidak kritis */
    }
  }

  tampilkanHasil({ blob, berkas, kunci, otomatis });
  dorong();
}

/**
 * Jalur `<input capture>` sengaja dikecualikan: app kamera bawaan Android SUDAH
 * menyimpan foto aslinya ke DCIM. Mengunduh lagi hanya menghasilkan dua salinan
 * berbeda dari satu jepretan, dan yang kedua justru berkualitas lebih rendah.
 */
function bolehSimpanOtomatis(sumber) {
  if (KONFIG().simpanOtomatis === false) return false;
  return sumber === 'kamera';
}

/* --------------------------------------------------------------- panel hasil */

function tampilkanHasil({ blob, berkas, kunci, tanpaAntrean, otomatis }) {
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

  // Dua tampilan berbeda, karena keadaannya memang berbeda. Menampilkan tombol
  // "Simpan" besar padahal fotonya sudah tersimpan hanya membuat tamu ragu.
  const bagianSimpan = otomatis
    ? `<p class="petunjuk"><b>Tersimpan ke galeri HP Anda.</b></p>
       <p class="petunjuk redup">Cek folder <b>Download</b> di app Galeri atau Files.</p>
       <button id="tombol-simpan" class="tombol halus">Simpan sekali lagi</button>`
    : `<button id="tombol-simpan" class="tombol utama">Simpan ke galeri HP</button>
       <p class="petunjuk">${petunjuk}</p>
       <p class="petunjuk redup">Atau <b>tahan foto di atas</b> lalu pilih simpan gambar.</p>`;

  induk.innerHTML = `
    <img id="hasil-gambar" class="hasil-gambar" src="${url}" alt="Foto yang baru diambil">
    <div class="baris-putar">
      <button id="putar-kiri" class="tombol mini" aria-label="Putar ke kiri">&#8634; Putar</button>
      <button id="putar-kanan" class="tombol mini" aria-label="Putar ke kanan">Putar &#8635;</button>
    </div>
    <p class="redup kecil">${ukuranSingkat(blob.size)} &middot; ${
      tanpaAntrean ? 'belum masuk antrean' : 'tersimpan di HP, menunggu terkirim'
    }</p>
    ${bagianSimpan}
    <button id="tombol-lagi" class="tombol halus">Ambil foto lagi</button>
  `;

  el('#putar-kiri', induk).addEventListener('click', (ev) =>
    denganSibuk(ev.currentTarget, '…', () => putarHasil(270))
  );
  el('#putar-kanan', induk).addEventListener('click', (ev) =>
    denganSibuk(ev.currentTarget, '…', () => putarHasil(90))
  );

  // Blob sudah siap sebelum tombol muncul, jadi handler di bawah bisa memanggil
  // share tanpa await apa pun — syarat mutlak agar share sheet iOS tidak batal.
  el('#tombol-simpan', induk).addEventListener('click', () => simpanLalu());
  el('#tombol-lagi', induk).addEventListener('click', async () => {
    tampilkanPanel('jepret');
    if (!kamera.sedangMenyala()) await nyalakanKamera();
  });

  tampilkanPanel('hasil');
}

/**
 * Putar foto yang baru saja diambil.
 *
 * Jaring pengaman untuk perangkat yang sensornya tidak tersedia, izinnya
 * ditolak, atau arah putar otomatisnya meleset.
 *
 * Perlakuan berbeda untuk foto yang SUDAH terkirim: berkas yang sudah mendarat
 * di Drive tidak bisa disunting dari sini, dan berpura-pura bisa akan membuat
 * tamu mengira yang lama sudah tergantikan. Jadi versi terputarnya dikirim
 * sebagai foto baru, dan itu dikatakan apa adanya.
 */
async function putarHasil(derajat) {
  if (!fotoTerakhir) return;
  const { blob, nama, kunci } = fotoTerakhir;

  let baru;
  try {
    baru = await putarBlob(blob, derajat);
  } catch (e) {
    notif(e?.message || 'Foto tidak bisa diputar', 'galat');
    return;
  }

  let thumb = null;
  try {
    thumb = await buatThumb(baru.blob);
  } catch {
    /* thumbnail hanya kenyamanan halaman "Foto Saya" */
  }

  const baris = await antrean.ambil(kunci).catch(() => null);

  if (baris && baris.status !== antrean.STATUS.TERKIRIM) {
    // Server belum pernah melihat kunci ini, jadi menimpa isinya aman dan
    // idempotensinya tetap utuh.
    await antrean.perbarui(kunci, {
      blob: baru.blob,
      thumb,
      ukuran: baru.blob.size,
      lebar: baru.lebar,
      tinggi: baru.tinggi,
      keGaleri: false
    });
    tampilkanHasil({ blob: baru.blob, berkas: nama, kunci, otomatis: false });
    notif('Foto diputar.', 'sukses');
    return;
  }

  const kunciBaru = uuid();
  const berkasBaru = namaBerkas({ waktu: Date.now(), nama: namaEfektif(), kunci: kunciBaru });
  await antrean.tambah({
    kunci: kunciBaru,
    waktu: Date.now(),
    namaTamu: namaEfektif(),
    sesi: sesiDariUrl(),
    device: idPerangkat(),
    mime: 'image/jpeg',
    lebar: baru.lebar,
    tinggi: baru.tinggi,
    ukuran: baru.blob.size,
    namaBerkas: berkasBaru,
    sumber: 'kamera',
    blob: baru.blob,
    thumb
  });
  tampilkanHasil({ blob: baru.blob, berkas: berkasBaru, kunci: kunciBaru, otomatis: false });
  notif('Foto yang sudah terkirim tidak bisa diubah, jadi versi terputarnya dikirim sebagai foto baru.', 'info', 7000);
  dorong();
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
