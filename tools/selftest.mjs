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

import {
  alamatDasar,
  alamatDenganSesi,
  modeLembar,
  geometriPng,
  namaBerkasPng,
  KUIET_MODUL,
  PX_TARGET_PNG,
  NILAI_LEMBAR
} from '../cetak/qr-inti.js';

import { ukuranAliran } from '../assets/js/kamera.js';

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

/* ---------------------------------------------------- halaman cetak QR */

// Semua yang diuji di bawah ini punya satu sifat yang sama: kalau salah, baru
// ketahuan SETELAH kertasnya keluar dari percetakan, dan tidak bisa ditarik
// kembali. Itu sebabnya logikanya dipekarkan ke cetak/qr-inti.js.

/* alamat — salah = ratusan kartu menunjuk tempat yang salah */

sama(
  'alamat: ?url= mengalahkan qrUrl',
  alamatDasar({ cari: '?url=https://a.test/x', urlKonfig: 'https://b.test/' }),
  'https://a.test/x'
);
sama(
  'alamat: tanpa ?url=, qrUrl dipakai',
  alamatDasar({ cari: '', urlKonfig: 'https://ipulsamudin.github.io/foto-nikah/' }),
  'https://ipulsamudin.github.io/foto-nikah/'
);
// Jebakan nyata: ?url= yang kosong/hanya spasi tidak boleh melumpuhkan qrUrl.
sama(
  'alamat: ?url= kosong tidak mengalahkan qrUrl',
  alamatDasar({ cari: '?url=', urlKonfig: 'https://b.test/' }),
  'https://b.test/'
);
sama(
  'alamat: ?url= hanya spasi tidak mengalahkan qrUrl',
  alamatDasar({ cari: '?url=%20%20', urlKonfig: 'https://b.test/' }),
  'https://b.test/'
);
sama(
  'alamat: cadangan membuang cetak/qr.html',
  alamatDasar({ asal: 'http://localhost:8765', jalur: '/cetak/qr.html' }),
  'http://localhost:8765/'
);
sama(
  'alamat: cadangan pada subpath repo',
  alamatDasar({ asal: 'https://x.test', jalur: '/foto-nikah/cetak/qr.html' }),
  'https://x.test/foto-nikah/'
);
sama(
  'alamat: cadangan mengabaikan query halaman cetak',
  alamatDasar({ asal: 'https://x.test', jalur: '/cetak/qr.html' }),
  'https://x.test/'
);

sama(
  'sesi: ditambahkan dengan ?',
  alamatDenganSesi('https://x.test/foto/', 'akad'),
  'https://x.test/foto/?sesi=akad'
);
sama(
  'sesi: dasar yang sudah berquery memakai &',
  alamatDenganSesi('https://x.test/foto/?a=1', 'akad'),
  'https://x.test/foto/?a=1&sesi=akad'
);
// QR tidak boleh pernah berakhir `?sesi=`: kolom sesi di Sheet akan berisi string
// kosong, bukan 'umum' seperti yang dijanjikan tamu.js.
sama('sesi: kosong → dasar apa adanya', alamatDenganSesi('https://x.test/', ''), 'https://x.test/');
sama('sesi: spasi → dasar apa adanya', alamatDenganSesi('https://x.test/', '   '), 'https://x.test/');
sama(
  'sesi: di-encode',
  alamatDenganSesi('https://x.test/', 'meja 01'),
  'https://x.test/?sesi=meja%2001'
);
sama(
  'sesi: & dan = di label tidak merusak query',
  alamatDenganSesi('https://x.test/', 'a&b=c'),
  'https://x.test/?sesi=a%26b%3Dc'
);
cek(
  'sesi: alamat akhir tidak pernah mengandung spasi mentah',
  ['meja 01', ' akad ', 'VIP  2', 'a\tb'].every(
    (s) => !/\s/.test(alamatDenganSesi('https://x.test/', s))
  )
);

/* mode lembar — salah = opsi poster diam-diam mencetak 2 kartu */

sama('mode: 2', modeLembar('2'), { nilai: '2', poster: false, jumlah: 2 });
sama('mode: 8', modeLembar('8'), { nilai: '8', poster: false, jumlah: 8 });
sama('mode: poster', modeLembar('poster'), { nilai: 'poster', poster: true, jumlah: 1 });

// Inilah alasan `Number(nilai) || 2` harus hilang: tanpa modeLembar, memilih
// Poster akan jatuh ke 2 kartu tanpa satu pun galat yang terlihat.
cek('mode: Number("poster") memang NaN (sebab modeLembar ada)', Number.isNaN(Number('poster')));

// `?n=99` dulu membuat <select> kehilangan pilihan (selectedIndex -1), sehingga
// toolbar tampak kosong padahal lembarnya tergambar 2 kartu.
for (const buruk of ['99', '', '  ', '0', '3', 'POSTER', 'pos', null, undefined]) {
  sama(`mode: nilai tak dikenal → 2 (${JSON.stringify(buruk)})`, modeLembar(buruk).nilai, '2');
}
// Spasi dimaafkan: `?n=poster%20` dari tautan yang disalin-tempel tetap poster.
sama('mode: spasi di sekitar nilai dimaafkan', modeLembar(' poster ').nilai, 'poster');
sama('mode: spasi di sekitar angka dimaafkan', modeLembar(' 8 ').nilai, '8');
cek(
  'mode: bulat-balik semua nilai <option>',
  NILAI_LEMBAR.every((v) => modeLembar(v).nilai === v)
);
cek(
  'mode: jumlah selalu bilangan bulat positif',
  NILAI_LEMBAR.every((v) => Number.isInteger(modeLembar(v).jumlah) && modeLembar(v).jumlah >= 1)
);

/* geometri PNG — salah = QR kabur, gagal scan di percetakan */

sama('geometri: 33 modul (alamat tanpa sesi)', geometriPng(33), { total: 41, sel: 49, sisi: 2009 });
sama('geometri: 37 modul (alamat dengan ?sesi=)', geometriPng(37), { total: 45, sel: 45, sisi: 2025 });

// Rentang versi QR 1..40 = 21..177 modul, langkah 4.
const modulSah = [];
for (let m = 21; m <= 177; m += 4) modulSah.push(m);

cek(
  'geometri: sisi habis dibagi total modul (invarian ketajaman)',
  modulSah.every((m) => {
    const g = geometriPng(m);
    return g.sisi % g.total === 0;
  })
);
cek(
  'geometri: sisi tidak pernah melebihi target',
  modulSah.every((m) => geometriPng(m).sisi <= PX_TARGET_PNG)
);
cek(
  'geometri: sel tetap layak cetak di seluruh rentang',
  modulSah.every((m) => geometriPng(m).sel >= 8),
  'sel terkecil = ' + Math.min(...modulSah.map((m) => geometriPng(m).sel))
);
cek(
  'geometri: quiet zone tidak pernah hilang',
  modulSah.every((m) => geometriPng(m).total - m === KUIET_MODUL * 2)
);
// Target absurd tidak boleh menghasilkan kanvas 0×0 yang "berhasil" diunduh kosong.
sama('geometri: target 1 tetap menghasilkan sel 1', geometriPng(33, 1).sel, 1);
sama('geometri: KUIET_MODUL sesuai spesifikasi QR', KUIET_MODUL, 4);

/* nama berkas — salah = QR sesi yang salah dikirim ke percetakan */

sama('nama PNG: dengan sesi', namaBerkasPng('akad', 2025), 'qr-foto-nikah-akad-2025px.png');
// slugNama('') mengembalikan 'Tamu' — benar untuk nama tamu, salah total di sini.
sama('nama PNG: tanpa sesi → umum, bukan Tamu', namaBerkasPng('', 2009), 'qr-foto-nikah-umum-2009px.png');
sama('nama PNG: sesi spasi → umum', namaBerkasPng('   ', 2009), 'qr-foto-nikah-umum-2009px.png');
sama(
  'nama PNG: label kotor dibersihkan',
  namaBerkasPng('meja 01 / VIP', 2025),
  'qr-foto-nikah-meja-01-VIP-2025px.png'
);
cek(
  'nama PNG: selalu aman untuk sistem berkas',
  ['akad', 'meja 01', 'a/b\\c', '🌸 VIP', 'Ma’ruf', '', '   '].every((s) =>
    /^qr-foto-nikah-[A-Za-z0-9-]+-\d+px\.png$/.test(namaBerkasPng(s, 2009))
  )
);
// Dua standee berbeda tidak boleh saling menimpa di folder Download.
cek(
  'nama PNG: sesi berbeda → nama berbeda',
  namaBerkasPng('akad', 2025) !== namaBerkasPng('resepsi', 2025)
);

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

  // --- orientasi matriks: penjaga anti-cermin untuk kanvasQr() di cetak/qr.js ---
  //
  // Cari modul yang ASIMETRIS terhadap transpose. Finder dan timing pattern
  // simetris, jadi hanya modul data yang bisa membuktikan sumbu x/y tidak
  // tertukar. Tanpa modul semacam ini, seluruh pemeriksaan di bawah tidak
  // membuktikan apa pun.
  let rA = -1;
  let kA = -1;
  for (let b = 0; b < modul && rA < 0; b++) {
    for (let k = 0; k < modul; k++) {
      if (q.isDark(b, k) && !q.isDark(k, b)) {
        rA = b;
        kA = k;
        break;
      }
    }
  }
  cek('vendor QR: matriks tidak simetris terhadap transpose', rA >= 0, `baris=${rA} kolom=${kA}`);

  // createSvgTag memetakan kolom → x dan baris → y. Ini REFERENSI yang diikuti
  // kanvasQr() di cetak/qr.js, supaya kartu cetak dan PNG selalu menghasilkan
  // kode yang identik. Kalau pustaka vendor diganti dan pemetaan ini berubah,
  // uji ini gagal sebelum ada QR tercermin yang tercetak.
  const sel = 4;
  const margin = sel * KUIET_MODUL;
  const svgO = q.createSvgTag({ cellSize: sel, margin });
  cek(
    'vendor QR: SVG memetakan kolom→x, baris→y',
    svgO.includes(`M${kA * sel + margin},${rA * sel + margin}l`) &&
      !svgO.includes(`M${rA * sel + margin},${kA * sel + margin}l`)
  );

  // renderTo2dContext vendor menulis fillRect(baris*sel, kolom*sel) — sumbunya
  // TERTUKAR, alias QR tercermin, dan ia juga tidak menambahkan quiet zone sama
  // sekali. Uji ini MENDOKUMENTASIKAN cacat itu supaya tidak ada yang
  // "menyederhanakan" kanvasQr dengan memakainya. Kalau uji ini gagal, berarti
  // pustaka vendor sudah diganti dan keputusan itu harus ditinjau ulang —
  // bukan di-comment.
  const jejak = [];
  const ctxTiruan = {
    fillStyle: '',
    fillRect(x, y) {
      if (ctxTiruan.fillStyle === 'black') jejak.push(`${x},${y}`);
    }
  };
  q.renderTo2dContext(ctxTiruan, sel);
  cek(
    'vendor QR: renderTo2dContext masih tertranspos (sebab itu TIDAK dipakai)',
    jejak.includes(`${rA * sel},${kA * sel}`) && !jejak.includes(`${kA * sel},${rA * sel}`)
  );
} catch (e) {
  gagal.push('vendor QR tidak bisa diimpor: ' + e.message);
}

/* ------------------------------------------------- ukuran aliran kamera */

// Bentuk kotak viewfinder diambil dari angka-angka ini. Kalau salah, pratinjau
// berbohong kepada tamu: dia membingkai sesuatu yang berbeda dari yang tersimpan.
sama('ukuranAliran: landscape 16:9', ukuranAliran({ videoWidth: 1920, videoHeight: 1080 }), {
  lebar: 1920,
  tinggi: 1080,
  rasio: 1920 / 1080
});
sama('ukuranAliran: portrait 3:4', ukuranAliran({ videoWidth: 1536, videoHeight: 2048 }), {
  lebar: 1536,
  tinggi: 2048,
  rasio: 0.75
});
sama('ukuranAliran: belum siap -> rasio 0', ukuranAliran({ videoWidth: 0, videoHeight: 0 }), {
  lebar: 0,
  tinggi: 0,
  rasio: 0
});
sama('ukuranAliran: elemen tidak ada', ukuranAliran(null), { lebar: 0, tinggi: 0, rasio: 0 });
cek('ukuranAliran: landscape rasio > 1', ukuranAliran({ videoWidth: 2560, videoHeight: 1920 }).rasio > 1);
cek('ukuranAliran: portrait rasio < 1', ukuranAliran({ videoWidth: 1920, videoHeight: 2560 }).rasio < 1);

/* -------------------------------------------------------------------- hasil */

console.log(`\nSelf-test: ${lulus} lulus, ${gagal.length} gagal`);
if (gagal.length) {
  for (const g of gagal) console.error('  GAGAL ' + g);
  process.exit(1);
}
