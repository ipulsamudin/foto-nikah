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
//     rotasiTambahan = sudutFisik - sudutLayar
//
// Auto-rotate menyala  -> keduanya bergerak bersama -> 0, tidak ada yang diputar.
// Auto-rotate terkunci -> layar diam di 0, fisik 90 -> kanvas diputar 90°.
//
// Dengan begitu tidak perlu mendeteksi "apakah rotasi terkunci"; kedua keadaan
// ditangani rumus yang sama.

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
 * Berapa derajat kanvas perlu diputar supaya foto keluar tegak.
 *
 * MURNI. Dua kasus yang paling penting diuji eksplisit:
 *   auto-rotate menyala  : fisik 90, layar 90 -> 0
 *   auto-rotate terkunci : fisik 90, layar 0  -> 90
 */
export function rotasiTambahan(fisik, layar) {
  return normalkanSudut(normalkanSudut(fisik) - normalkanSudut(layar));
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
 * Pantau rotasi yang perlu diterapkan, dan panggil `onUbah` hanya ketika
 * nilainya BERUBAH.
 *
 * Event deviceorientation datang puluhan kali per detik; tanpa penyaringan ini,
 * viewfinder akan digambar ulang terus-menerus dan HP kelas bawah ikut panas.
 *
 * @returns {Function} pembongkar
 */
export function mulaiPantauOrientasi(onUbah) {
  let terakhir = null;
  let sudutFisikTerakhir = 0;

  const nilai = () => {
    const r = rotasiTambahan(sudutFisikTerakhir, sudutLayar());
    if (r === terakhir) return;
    terakhir = r;
    onUbah(r);
  };

  const dariSensor = (ev) => {
    sudutFisikTerakhir = sudutDariSensor(ev);
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
