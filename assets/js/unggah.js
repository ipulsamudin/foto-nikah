// Pengirim antrean: satu-satunya tempat yang memindahkan foto dari IndexedDB ke Drive.
//
// Konkurensi sengaja 1. Di wifi venue yang dipakai ratusan orang, mengirim tiga
// foto sekaligus hanya membuat ketiganya timeout; satu-satu justru lebih cepat
// selesai dan jauh lebih mudah dijelaskan ke tamu ("1 dari 3 sedang dikirim").
//
// Pengirim tidak pernah menyerah. Setelah beberapa kali gagal, baris ditandai
// "gagal" supaya tamu melihat sesuatu yang jujur, tapi tetap dicoba ulang di
// latar belakang. Yang benar-benar berhenti hanya galat permanen (token salah,
// berkas bukan JPEG) — mencoba ulang hal itu tidak akan pernah berhasil.

import { backoffMs } from './fmt.js';
import * as antrean from './antrean.js';
import { STATUS } from './antrean.js';
import { base64Dari } from './gambar.js';
import { kirimFoto, siap, GalatBackend } from './indeks.js';

const BATAS_TANDA_GAGAL = 5;

let sedangJalan = false;
let jamBerikut = null;
const pendengar = new Set();

/** UI berlangganan ke sini untuk memperbarui indikator "n foto menunggu". */
export function onPerubahan(fn) {
  pendengar.add(fn);
  return () => pendengar.delete(fn);
}

async function kabarkan() {
  const ringkasan = await antrean.hitung();
  for (const fn of pendengar) {
    try {
      fn(ringkasan);
    } catch {
      /* satu pendengar rusak tidak boleh menghentikan pengiriman */
    }
  }
}

function jadwalkan(jedaMs) {
  if (jamBerikut) clearTimeout(jamBerikut);
  jamBerikut = setTimeout(() => {
    jamBerikut = null;
    dorong();
  }, Math.max(jedaMs, 250));
}

/**
 * Kirim satu baris. Mengembalikan true bila ada kemajuan (sukses atau gagal
 * terhitung), false bila tidak ada yang bisa dikerjakan sekarang.
 */
async function kirimSatu(baris) {
  await antrean.perbarui(baris.kunci, { status: STATUS.MENGIRIM, mulaiKirim: Date.now() });
  await kabarkan();

  try {
    if (!baris.blob) {
      // Blob sudah dibersihkan padahal belum terkirim: tidak ada lagi yang bisa
      // dikirim. Tandai gagal permanen daripada mengulang selamanya.
      throw new GalatBackend('tanpa-berkas', 'Berkas foto sudah tidak ada di perangkat', { permanen: true });
    }

    const base64 = await base64Dari(baris.blob);
    const hasil = await kirimFoto({
      kunci: baris.kunci,
      nama: baris.namaTamu,
      sesi: baris.sesi,
      device: baris.device,
      mime: baris.mime || 'image/jpeg',
      lebar: baris.lebar,
      tinggi: baris.tinggi,
      base64,
      ulang: (baris.percobaan || 0) > 0,
    });

    // `duplikat:true` BUKAN kegagalan: artinya percobaan sebelumnya ternyata
    // sudah mendarat di Drive walau balasannya tidak pernah sampai ke HP tamu.
    // Inilah hasil kerja kunci idempotensi, dan ini kasus yang sering terjadi
    // di wifi venue — jadi diperlakukan persis seperti sukses.
    await antrean.perbarui(baris.kunci, {
      status: STATUS.TERKIRIM,
      idDrive: hasil?.idBerkas || '',
      urlDrive: hasil?.url || '',
      duplikat: Boolean(hasil?.duplikat),
      galatTerakhir: '',
    });
    // Baru di sini blob boleh dilepas — dan hanya kalau tamu juga sudah
    // menyimpannya ke galeri.
    await antrean.bersihkanBlob(baris.kunci);
    return true;
  } catch (e) {
    const permanen = e instanceof GalatBackend && e.permanen;

    // "Sedang diproses" berarti percobaan sebelumnya masih berjalan di server.
    // Itu bukan kegagalan dan tidak boleh menghitung percobaan — kalau dihitung,
    // satu unggahan lambat bisa menandai dirinya "gagal" padahal sedang sukses.
    const sedang = e?.kode === 'SEDANG_DIPROSES';
    const percobaan = sedang ? baris.percobaan || 0 : (baris.percobaan || 0) + 1;

    // Server boleh menentukan jedanya sendiri (tunggu_ms). Itu membuat kebijakan
    // retry bisa disetel di tengah acara dari sisi backend, tanpa menyentuh PWA
    // yang sudah terpasang di ratusan HP.
    const jeda = permanen ? 24 * 3600_000 : e?.tungguMs || backoffMs(Math.max(percobaan, 1));

    await antrean.perbarui(baris.kunci, {
      status: permanen || percobaan >= BATAS_TANDA_GAGAL ? STATUS.GAGAL : STATUS.TERTUNDA,
      percobaan,
      galatTerakhir: String(e?.message || e),
      cobaSetelah: Date.now() + jeda,
      mulaiKirim: 0,
    });
    if (!permanen) jadwalkan(jeda);
    return true;
  }
}

/** Jalankan pengurasan antrean. Aman dipanggil berkali-kali; hanya satu yang jalan. */
export async function dorong() {
  if (sedangJalan) return;
  if (!navigator.onLine) return;            // tidak ada gunanya mencoba saat offline
  if (!(await siap())) return;              // backend belum dikonfigurasi

  sedangJalan = true;
  try {
    for (;;) {
      const baris = await antrean.berikutnya();
      if (!baris) break;
      await kirimSatu(baris);
      await kabarkan();
      if (!navigator.onLine) break;
    }
  } finally {
    sedangJalan = false;
    await kabarkan();
    // Masih ada yang menunggu jadwal? Pasang alarm untuk yang paling dekat.
    const semua = await antrean.ambilSemua();
    const nanti = semua
      .filter((r) => r.status !== STATUS.TERKIRIM)
      .map((r) => (r.cobaSetelah || 0) - Date.now())
      .filter((ms) => ms > 0)
      .sort((a, b) => a - b)[0];
    if (nanti !== undefined) jadwalkan(nanti);
  }
}

/** Paksa satu baris dicoba sekarang (tombol "coba kirim lagi"). */
export async function cobaLagi(kunci) {
  await antrean.perbarui(kunci, { status: STATUS.TERTUNDA, cobaSetelah: 0, percobaan: 0 });
  await kabarkan();
  return dorong();
}

/** Paksa semua yang gagal dicoba sekarang. */
export async function cobaLagiSemua() {
  const semua = await antrean.ambilSemua();
  for (const r of semua) {
    if (r.status !== STATUS.TERKIRIM) {
      await antrean.perbarui(r.kunci, { status: STATUS.TERTUNDA, cobaSetelah: 0 });
    }
  }
  await kabarkan();
  return dorong();
}

/**
 * Pasang semua pemicu pengiriman.
 *
 * Tidak ada polling cepat: pemicunya kejadian nyata — aplikasi dibuka, jaringan
 * kembali, tab dilihat lagi. Satu denyut lambat tiap 60 detik hanya sebagai
 * jaring pengaman kalau event "online" tidak pernah datang (sering terjadi saat
 * wifi tersambung tapi tanpa internet).
 */
export async function mulaiPengirim() {
  // Bersihkan sewa "mengirim" yang yatim sebelum pemicu apa pun dipasang,
  // supaya tamu tidak melihat baris yang diam di "Mengirim…" selamanya.
  await antrean.pulihkanMacet();

  addEventListener('online', () => dorong());
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') dorong();
  });
  setInterval(() => dorong(), 60_000);
  await kabarkan();
  dorong();
}
