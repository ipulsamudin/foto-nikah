// Self-test tanpa dependensi untuk modul murni.
// Jalankan: node tools/selftest.mjs   (dipakai juga oleh GitHub Actions)
//
// Yang diuji di sini sengaja dibatasi pada hal-hal yang BISA dibuktikan tanpa
// browser: sanitasi nama, nama berkas, matematika backoff, pembacaan EXIF, dan
// mesin status antrean. Perilaku getUserMedia, navigator.share, ukuran JPEG
// nyata, dan IndexedDB TIDAK bisa diklaim di sini — itu wilayah uji perangkat
// nyata (lihat docs/uji-perangkat.md).

import {
  uuid,
  slugNama,
  capWaktu,
  namaBerkas,
  idPendek,
  backoffMs,
  TANGGA_BACKOFF,
  ukuranSingkat,
  jamSingkat,
  esc,
  jumlahFoto
} from '../assets/js/fmt.js';

import { bacaOrientasi, matriksOrientasi, orientasiMenukarSisi } from '../assets/js/exif.js';
import { pilihLayak, ringkas, STATUS } from '../assets/js/antrean.js';
import { ukuranTerskala, TANGGA_MUTU, BYTES_TARGET } from '../assets/js/gambar.js';

let lulus = 0;
const gagal = [];

function cek(nama, benar, detail = '') {
  if (benar) {
    lulus++;
    return;
  }
  gagal.push(`${nama}${detail ? ` — ${detail}` : ''}`);
}

function sama(nama, dapat, harap) {
  const a = JSON.stringify(dapat);
  const b = JSON.stringify(harap);
  cek(nama, a === b, `dapat ${a}, diharapkan ${b}`);
}

/* ------------------------------------------------------------- sanitasi nama */

sama('slugNama: biasa', slugNama('Rani Agustina'), 'Rani-Agustina');
sama('slugNama: spasi berlebih', slugNama('   Budi    Santoso  '), 'Budi-Santoso');
sama('slugNama: diakritik dilipat', slugNama('José Müller'), 'Jose-Muller');

// Apostrof dibuang, BUKAN jadi tanda hubung. Nama Indonesia penuh apostrof.
sama('slugNama: apostrof lurus', slugNama("Ma'ruf"), 'Maruf');
sama('slugNama: apostrof melengkung HP', slugNama('Nur’aini'), 'Nuraini');
sama('slugNama: gelar bertitik', slugNama('H. Ahmad S.Pd'), 'H-Ahmad-S-Pd');

// Satu emoji adalah pasangan surrogate; keluarga ber-ZWJ bisa 7+ unit kode.
// Hasilnya harus SATU tanda hubung, bukan deretan.
cek('slugNama: emoji tidak jadi deretan tanda hubung', !slugNama('Dewi 🌸🎉').includes('--'));
sama('slugNama: emoji dibuang rapi', slugNama('Dewi 🌸'), 'Dewi');
sama('slugNama: seluruhnya emoji', slugNama('🎉🌸'), 'Tamu');
sama('slugNama: kosong', slugNama(''), 'Tamu');
sama('slugNama: null', slugNama(null), 'Tamu');
sama('slugNama: karakter berkas berbahaya', slugNama('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
cek('slugNama: panjang dibatasi', slugNama('A'.repeat(200)).length <= 40);
cek(
  'slugNama: idempoten',
  slugNama(slugNama("José Ma'ruf 🌸")) === slugNama("José Ma'ruf 🌸"),
  slugNama(slugNama("José Ma'ruf 🌸"))
);

// Fuzz: nama apa pun tidak boleh menghasilkan karakter yang menyusahkan Drive
// atau Windows saat folder diunduh dan diekstrak.
const HURUF = [...'abcXYZ019 .-_/\\:*?"<>|\'’éü🌸🎉中', String.fromCharCode(0x0301)];
let fuzzAman = true;
for (let i = 0; i < 400; i++) {
  let s = '';
  const n = 1 + Math.floor(Math.random() * 30);
  for (let j = 0; j < n; j++) s += HURUF[Math.floor(Math.random() * HURUF.length)];
  const hasil = slugNama(s);
  if (!/^[A-Za-z0-9-]+$/.test(hasil) || hasil.length > 40 || /--|^-|-$/.test(hasil)) {
    fuzzAman = false;
    gagal.push(`slugNama fuzz: "${s}" -> "${hasil}"`);
    break;
  }
}
cek('slugNama: 400 masukan acak tetap aman', fuzzAman);

/* -------------------------------------------------------------- nama berkas */

const waktuUji = new Date(2026, 11, 6, 10, 15, 32); // 6 Des 2026 10:15:32 lokal
sama('capWaktu', capWaktu(waktuUji), '20261206-101532');
sama('idPendek', idPendek('a3f9c1d2-4e5f-4a6b-8c9d-0e1f2a3b4c5d'), 'a3f9c1d2');
sama('idPendek: kosong', idPendek(''), '00000000');
sama(
  'namaBerkas',
  namaBerkas({ waktu: waktuUji, nama: "Rani Ma'ruf", kunci: 'a3f9c1d2-4e5f-4a6b' }),
  '20261206-101532_Rani-Maruf_a3f9c1d2.jpg'
);
sama(
  'namaBerkas: ekstensi lain',
  namaBerkas({ waktu: waktuUji, nama: 'Tamu', kunci: 'ffff0000-1', ekstensi: 'heic' }),
  '20261206-101532_Tamu_ffff0000.heic'
);

// Nama berkas harus bisa dicocokkan oleh pola rekonsiliasi di Apps Script.
const POLA_REKONSILIASI = /^(\d{8}-\d{6})_(.+)_([a-z0-9]{8})\.jpg$/;
cek(
  'namaBerkas: cocok pola rekonsiliasi server',
  POLA_REKONSILIASI.test(namaBerkas({ waktu: waktuUji, nama: 'Dewi 🌸', kunci: 'abcd1234-ef' }))
);

/* ------------------------------------------------------------------- uuid */

const u = uuid();
cek('uuid: bentuk v4', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u), u);
cek('uuid: tidak berulang', new Set([uuid(), uuid(), uuid(), uuid()]).size === 4);

/* ---------------------------------------------------------------- backoff */

const acakTetap = () => 0.5; // jitter netral
cek('backoff: percobaan 1 = tangga pertama', backoffMs(1, acakTetap) === TANGGA_BACKOFF[0]);
let menaik = true;
for (let i = 2; i <= TANGGA_BACKOFF.length; i++) {
  if (backoffMs(i, acakTetap) < backoffMs(i - 1, acakTetap)) menaik = false;
}
cek('backoff: tidak pernah menurun', menaik);
cek(
  'backoff: dibatasi tangga terakhir',
  backoffMs(99, acakTetap) === TANGGA_BACKOFF[TANGGA_BACKOFF.length - 1]
);
cek('backoff: percobaan 0 tidak negatif', backoffMs(0, acakTetap) > 0);

let jitterAman = true;
for (let i = 0; i < 1000; i++) {
  const v = backoffMs(3);
  if (v < TANGGA_BACKOFF[2] * 0.8 || v > TANGGA_BACKOFF[2] * 1.2) jitterAman = false;
}
cek('backoff: jitter dalam rentang 80-120%', jitterAman);

// Jitter wajib ADA: tanpa itu ratusan HP yang gagal bersamaan akan mencoba lagi
// pada milidetik yang sama dan membuat badai tepat saat jaringan baru pulih.
const variasi = new Set();
for (let i = 0; i < 50; i++) variasi.add(backoffMs(4));
cek('backoff: benar-benar ber-jitter', variasi.size > 5, `hanya ${variasi.size} nilai berbeda`);

/* --------------------------------------------------------------------- EXIF */

function jpegDenganOrientasi(orientasi, kecil = false) {
  const tiff = [];
  if (kecil) tiff.push(0x49, 0x49, 0x2a, 0x00);
  else tiff.push(0x4d, 0x4d, 0x00, 0x2a);
  // offset ke IFD0 = 8
  if (kecil) tiff.push(8, 0, 0, 0);
  else tiff.push(0, 0, 0, 8);
  // jumlah entri = 1
  if (kecil) tiff.push(1, 0);
  else tiff.push(0, 1);
  // tag 0x0112, tipe 3 (SHORT), count 1, nilai
  if (kecil) tiff.push(0x12, 0x01, 3, 0, 1, 0, 0, 0, orientasi, 0, 0, 0);
  else tiff.push(0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientasi, 0, 0);
  // offset IFD berikutnya = 0
  tiff.push(0, 0, 0, 0);

  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00].concat(tiff);
  const panjang = exif.length + 2;
  return new Uint8Array(
    [0xff, 0xd8, 0xff, 0xe1, (panjang >> 8) & 0xff, panjang & 0xff]
      .concat(exif)
      .concat([0xff, 0xd9])
  ).buffer;
}

for (const o of [1, 3, 6, 8]) {
  sama(`exif: orientasi ${o} big endian`, bacaOrientasi(jpegDenganOrientasi(o, false)), o);
  sama(`exif: orientasi ${o} little endian`, bacaOrientasi(jpegDenganOrientasi(o, true)), o);
}
sama('exif: bukan JPEG -> 1', bacaOrientasi(new Uint8Array([1, 2, 3, 4, 5]).buffer), 1);
sama('exif: buffer kosong -> 1', bacaOrientasi(new ArrayBuffer(0)), 1);
sama(
  'exif: buffer terpotong -> 1 (tidak melempar)',
  bacaOrientasi(jpegDenganOrientasi(6).slice(0, 12)),
  1
);
sama('exif: tanpa APP1 -> 1', bacaOrientasi(new Uint8Array([0xff, 0xd8, 0xff, 0xda]).buffer), 1);

cek('exif: orientasi 6 menukar sisi', orientasiMenukarSisi(6));
cek('exif: orientasi 3 tidak menukar sisi', !orientasiMenukarSisi(3));
sama('exif: matriks 6 menukar dimensi', (({ w, h }) => ({ w, h }))(matriksOrientasi(6, 3, 2)), {
  w: 2,
  h: 3
});
sama('exif: matriks 1 identitas', matriksOrientasi(1, 4, 3), {
  w: 4,
  h: 3,
  transform: [1, 0, 0, 1, 0, 0]
});

/* ------------------------------------------------------------- geometri skala */

sama('skala: turun ke sisi panjang', ukuranTerskala(4000, 3000, 2400), { lebar: 2400, tinggi: 1800 });
sama('skala: potret', ukuranTerskala(3000, 4000, 2400), { lebar: 1800, tinggi: 2400 });
sama('skala: kecil tidak diperbesar', ukuranTerskala(800, 600, 2400), { lebar: 800, tinggi: 600 });
sama('skala: nol aman', ukuranTerskala(0, 0, 2400), { lebar: 0, tinggi: 0 });
cek('mutu: tangga menurun', TANGGA_MUTU.every((m, i) => i === 0 || m < TANGGA_MUTU[i - 1]));
cek('mutu: tangga maksimum 4 langkah', TANGGA_MUTU.length <= 4);
cek('mutu: target ukuran masuk akal', BYTES_TARGET >= 400_000 && BYTES_TARGET <= 2_000_000);

/* --------------------------------------------------- antrean: pemilihan baris */

const KINI = 1_765_000_000_000;
const baris = (p) => ({
  kunci: p.kunci,
  waktu: p.waktu ?? KINI,
  status: p.status ?? STATUS.TERTUNDA,
  cobaSetelah: p.cobaSetelah ?? 0,
  mulaiKirim: p.mulaiKirim ?? 0
});

sama(
  'antrean: terkirim tidak pernah dipilih',
  pilihLayak([baris({ kunci: 'a', status: STATUS.TERKIRIM })], KINI).map((r) => r.kunci),
  []
);
sama(
  'antrean: yang tertua didahulukan',
  pilihLayak(
    [baris({ kunci: 'baru', waktu: KINI }), baris({ kunci: 'tua', waktu: KINI - 10_000 })],
    KINI
  ).map((r) => r.kunci),
  ['tua', 'baru']
);
sama(
  'antrean: jadwal di masa depan dilewati',
  pilihLayak([baris({ kunci: 'a', cobaSetelah: KINI + 5_000 })], KINI).map((r) => r.kunci),
  []
);
sama(
  'antrean: mengirim yang masih segar tidak diambil ulang',
  pilihLayak([baris({ kunci: 'a', status: STATUS.MENGIRIM, mulaiKirim: KINI - 1_000 })], KINI).map(
    (r) => r.kunci
  ),
  []
);
sama(
  'antrean: mengirim yang macet diambil kembali',
  pilihLayak([baris({ kunci: 'a', status: STATUS.MENGIRIM, mulaiKirim: KINI - 300_000 })], KINI).map(
    (r) => r.kunci
  ),
  ['a']
);
sama(
  'antrean: gagal tetap dicoba lagi bila jadwalnya lewat',
  pilihLayak([baris({ kunci: 'a', status: STATUS.GAGAL, cobaSetelah: KINI - 1 })], KINI).map(
    (r) => r.kunci
  ),
  ['a']
);

sama(
  'antrean: ringkasan',
  ringkas([
    baris({ kunci: 'a', status: STATUS.TERKIRIM }),
    baris({ kunci: 'b', status: STATUS.TERTUNDA }),
    baris({ kunci: 'c', status: STATUS.GAGAL })
  ]),
  { total: 3, menunggu: 2, terkirim: 1, gagal: 1 }
);

/* ------------------------------------------------------------------- format */

sama('ukuranSingkat: byte', ukuranSingkat(900), '900 B');
sama('ukuranSingkat: KB', ukuranSingkat(2048), '2 KB');
sama('ukuranSingkat: MB', ukuranSingkat(1_572_864), '1.5 MB');
sama('ukuranSingkat: nol', ukuranSingkat(0), '0 B');
sama('jamSingkat', jamSingkat(new Date(2026, 11, 6, 9, 5)), '09:05');
sama('esc: tag', esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
sama('esc: kutip', esc(`a"b'c&d`), 'a&quot;b&#39;c&amp;d');
sama('jumlahFoto', jumlahFoto(3), '3 foto');

/* ------------------------------------------------------- pustaka QR vendor */

// Berkas vendor di-pin di repo, bukan diambil dari CDN: kartu QR mungkin dicetak
// dari laptop di venue tanpa internet. Uji ini membuktikan berkasnya tidak
// korup/terpotong saat diunduh, dengan memeriksa bahwa satu masukan yang
// diketahui menghasilkan jumlah modul yang diketahui.
try {
  const { default: qrcode } = await import('../vendor/qrcode-generator-1.4.4.esm.js');
  const q = qrcode(0, 'Q'); // koreksi galat Q: standee kertas kena jari & cahaya remang
  q.addData('https://ipulsamudin.github.io/foto-nikah/');
  q.make();
  const modul = q.getModuleCount();
  cek('vendor QR: bisa diimpor dan menghasilkan matriks', modul > 20, 'modul=' + modul);
  cek('vendor QR: versi tidak berubah diam-diam', modul === 33, 'modul=' + modul);
  cek('vendor QR: bisa menghasilkan SVG', typeof q.createSvgTag === 'function');
  const svg = q.createSvgTag({ cellSize: 4, margin: 16 });
  cek('vendor QR: SVG berisi elemen svg', svg.includes('<svg'), svg.slice(0, 60));
} catch (e) {
  gagal.push('vendor QR tidak bisa diimpor: ' + e.message);
}

/* -------------------------------------------------------------------- hasil */

console.log(`\nSelf-test: ${lulus} lulus, ${gagal.length} gagal`);
if (gagal.length) {
  for (const g of gagal) console.error('  GAGAL ' + g);
  process.exit(1);
}
