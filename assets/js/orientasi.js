// Posisi FISIK perangkat, yang tidak bisa dilihat browser saat rotasi layar
// dikunci.
//
// Kejadian yang melahirkan modul ini: tamu memiringkan HP untuk foto melebar,
// tapi auto-rotate HP-nya mati. Akibatnya `screen.orientation.angle` tetap 0,
// dimensi aliran kamera tetap portrait, dan browser tidak melihat apa pun
// berubah — padahal dunia di depan sensor sudah berputar 90°. Hasilnya foto
// tegak dengan isi rebah.
//
// Satu-satunya sumber kebenaran untuk posisi fisik adalah sensor gerak, dan
// seluruh keputusan rotasi memakai satu rumus:
//
//     rotasiTambahan = sudutLayar - sudutFisik
//
// Auto-rotate menyala  -> keduanya bergerak bersama -> 0, tidak ada yang diputar.
// Auto-rotate terkunci -> layar diam di 0, fisik 270 -> kanvas diputar 90°.
//
// Dengan begitu tidak perlu mendeteksi "apakah rotasi terkunci"; kedua keadaan
// ditangani rumus yang sama.
//
// YANG DIPUTAR HANYA BERKAS, BUKAN PRATINJAU. Kamera menempel kaku pada layar:
// apa pun posisi HP, frame mentah yang ditampilkan apa adanya SELALU benar di
// mata tamu, karena layarnya ikut miring bersama kameranya. Memutar viewfinder
// justru merusak yang sudah benar — persis cacat yang membuat pratinjau tampak
// terbalik dan kotaknya menyusut jadi pita sempit saat HP dimiringkan. Sudut di
// modul ini hanya menjawab satu pertanyaan: berapa derajat BERKAS harus diputar
// supaya tegak ketika dibuka nanti di layar yang tegak.

/**
 * Ambang kemiringan sebelum dianggap landscape.
 *
 * 45° memberi batas yang tegas: di bawah itu HP masih dianggap tegak. Yang lebih
 * penting, ambang ini juga melindungi kasus HP ditaruh DATAR di meja — saat itu
 * gamma dan beta mendekati nol dan tidak bermakna, dan tanpa ambang foto bisa
 * diputar tanpa alasan.
 */
export const AMBANG_MIRING = 45;

/**
 * Sudut fisik perangkat dari pembacaan DeviceOrientation.
 *
 * Fungsi MURNI — inilah inti bug rotasi, dan karena murni ia bisa dibuktikan di
 * tools/selftest.mjs tanpa HP sama sekali.
 *
 * @param {{beta:number, gamma:number}} baca - beta: miring depan-belakang,
 *        gamma: miring kiri-kanan. Keduanya dalam derajat.
 * @returns {0|90|180|270} sudut searah jarum jam
 */
export function sudutDariSensor(baca) {
  const beta = Number(baca?.beta);
  const gamma = Number(baca?.gamma);
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return 0;

  // Miring kiri/kanan menang lebih dulu: itu cara orang memegang HP untuk foto
  // melebar, dan gamma-lah yang menangkapnya.
  if (gamma <= -AMBANG_MIRING) return 90;
  if (gamma >= AMBANG_MIRING) return 270;

  // Terbalik (beta negatif besar) jarang disengaja, tapi kalau terjadi lebih
  // baik ditangani daripada menghasilkan foto terbalik.
  if (beta <= -AMBANG_MIRING) return 180;

  return 0;
}

/** Sudut layar menurut browser. 0 bila API-nya tidak ada. */
export function sudutLayar() {
  const a = globalThis.screen?.orientation?.angle;
  return Number.isFinite(a) ? normalkanSudut(a) : 0;
}

export function normalkanSudut(sudut) {
  const n = Number(sudut);
  // Masukan tidak valid harus jatuh ke 0, bukan menghasilkan NaN: sudut NaN
  // akan mengalir diam-diam ke dimensi kanvas dan menghasilkan foto rusak
  // tanpa satu pun pesan galat.
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n / 90) * 90) % 360 + 360) % 360;
}

/**
 * Berapa derajat kanvas perlu diputar supaya BERKAS keluar tegak.
 *
 * Arahnya diturunkan dari satu kasus yang bisa dibayangkan tanpa alat: HP
 * diputar SEARAH jarum jam 90° (sisi atas ke kanan) dengan rotasi layar
 * terkunci portrait. Di frame mentah, kepala orang yang berdiri tegak menunjuk
 * ke tepi KIRI gambar — jadi berkasnya harus diputar 90° searah jarum jam.
 * Posisi itu dibaca `sudutDariSensor` sebagai 270, maka yang benar adalah
 * `layar - fisik`, bukan sebaliknya. Sebelumnya terbalik, dan hasilnya meleset
 * tepat 180°.
 *
 * MURNI. Dua kasus yang paling penting diuji eksplisit:
 *   auto-rotate menyala  : fisik 90, layar 90 -> 0
 *   auto-rotate terkunci : fisik 270, layar 0 -> 90
 *
 * Perhatikan bahwa pembalikan tanda ini tidak bisa merusak kasus auto-rotate
 * menyala: di sana kedua sudutnya sama, dan selisihnya nol ke arah mana pun.
 */
export function rotasiTambahan(fisik, layar) {
  return normalkanSudut(normalkanSudut(layar) - normalkanSudut(fisik));
}

/**
 * Minta izin sensor.
 *
 * iOS 13+ mewajibkan izin eksplisit dan HANYA menerima permintaan yang berasal
 * dari ketukan pengguna. Di tempat lain tidak ada yang perlu diminta.
 *
 * @returns {Promise<'diberi'|'ditolak'|'tidak-perlu'>}
 */
export async function mintaIzinSensor() {
  const D = globalThis.DeviceOrientationEvent;
  if (!D || typeof D.requestPermission !== 'function') return 'tidak-perlu';
  try {
    const hasil = await D.requestPermission();
    return hasil === 'granted' ? 'diberi' : 'ditolak';
  } catch {
    // Dipanggil di luar ketukan, atau pengguna menutup dialog.
    return 'ditolak';
  }
}

export function dukungSensor() {
  return typeof globalThis.DeviceOrientationEvent !== 'undefined';
}

/**
 * Pembacaan mentah terakhir, untuk penunjuk diagnosa `?diag=1`.
 *
 * Disimpan di lingkup modul supaya baris diagnosa bisa membacanya kapan saja
 * tanpa memasang pendengar kedua — satu-satunya cara menjawab "sensornya baca
 * apa?" di HP tamu tanpa kabel dan tanpa menebak.
 */
let bacaan = { beta: null, gamma: null, fisik: 0, layar: 0, rotasi: 0 };

export function bacaanOrientasi() {
  return { ...bacaan, layar: sudutLayar() };
}

/**
 * Pantau rotasi yang perlu diterapkan, dan panggil `onUbah` hanya ketika
 * nilainya BERUBAH.
 *
 * Event deviceorientation datang puluhan kali per detik; tanpa penyaringan ini,
 * pemanggil akan bekerja terus-menerus dan HP kelas bawah ikut panas.
 *
 * @returns {Function} pembongkar
 */
export function mulaiPantauOrientasi(onUbah) {
  let terakhir = null;
  let sudutFisikTerakhir = 0;

  const nilai = () => {
    const layar = sudutLayar();
    const r = rotasiTambahan(sudutFisikTerakhir, layar);
    bacaan = { ...bacaan, fisik: sudutFisikTerakhir, layar, rotasi: r };
    if (r === terakhir) return;
    terakhir = r;
    onUbah(r);
  };

  const dariSensor = (ev) => {
    sudutFisikTerakhir = sudutDariSensor(ev);
    bacaan = { ...bacaan, beta: Number(ev?.beta), gamma: Number(ev?.gamma) };
    nilai();
  };
  const dariLayar = () => nilai();

  addEventListener('deviceorientation', dariSensor);
  addEventListener('orientationchange', dariLayar);
  globalThis.screen?.orientation?.addEventListener?.('change', dariLayar);

  nilai();

  return () => {
    removeEventListener('deviceorientation', dariSensor);
    removeEventListener('orientationchange', dariLayar);
    globalThis.screen?.orientation?.removeEventListener?.('change', dariLayar);
  };
}
