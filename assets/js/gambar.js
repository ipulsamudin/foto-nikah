// Pengolahan gambar di perangkat: ambil frame, tegakkan, kecilkan, buat
// thumbnail, ubah ke base64.
//
// Semua kompresi terjadi DI HP tamu, karena memang tidak ada server yang bisa
// melakukannya. Target ukuran dipilih dari satu tarik-ulur: foto harus cukup
// besar untuk dicetak 4R, tapi cukup kecil untuk lolos dari wifi venue yang
// dipakai dua ratus orang bersamaan.

import { bacaOrientasi, matriksOrientasi, JPEG_UJI_ORIENTASI6 } from './exif.js';

export const SISI_MAKS = 2560;   // sisi panjang hasil unggah
export const MUTU = 0.85;        // kualitas JPEG percobaan pertama
export const SISI_THUMB = 320;   // thumbnail lokal untuk halaman "Foto Saya"

/** Di atas ini unggahan hampir pasti gagal di wifi venue; tolak lebih awal dan jujur. */
export const BYTES_MAKS_BERKAS = 20 * 1024 * 1024;

/** Tangga mutu: turun sampai hasilnya masuk anggaran, maksimum empat percobaan. */
export const TANGGA_MUTU = [MUTU, 0.78, 0.7, 0.62];
export const BYTES_TARGET = 1_200_000;

function kanvas(lebar, tinggi) {
  const c = document.createElement('canvas');
  c.width = lebar;
  c.height = tinggi;
  return c;
}

/**
 * Lepas memori kanvas segera.
 *
 * iOS Safari membunuh tab di sekitar beberapa ratus MB, dan satu kanvas 2560x1920
 * sudah ~20 MB RGBA. Menahan dua kanvas plus blob adalah penyebab paling umum
 * aplikasi semacam ini mati justru saat tamu sedang antusias menjepret.
 */
function lepasKanvas(c) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

/** Skala agar sisi panjang tidak melewati `maks`; gambar kecil tidak diperbesar. */
export function ukuranTerskala(lebar, tinggi, maks = SISI_MAKS) {
  const sisi = Math.max(lebar, tinggi);
  if (!sisi || sisi <= maks) return { lebar, tinggi };
  const r = maks / sisi;
  return { lebar: Math.max(1, Math.round(lebar * r)), tinggi: Math.max(1, Math.round(tinggi * r)) };
}

function keBlob(c, mutu) {
  return new Promise((selesai) => c.toBlob(selesai, 'image/jpeg', mutu));
}

/**
 * Encode dengan penjaga ukuran: turunkan mutu sampai masuk anggaran, tapi jangan
 * pernah membuang foto hanya karena masih terlalu besar — terima apa adanya di
 * percobaan terakhir dan biarkan antrean yang mengurusnya.
 */
async function encodeJpeg(c, { target = BYTES_TARGET } = {}) {
  let blob = null;
  for (const mutu of TANGGA_MUTU) {
    blob = await keBlob(c, mutu);
    if (!blob) break;
    if (blob.size <= target) return { blob, mutu };
  }
  if (!blob) throw new Error('Browser gagal mengubah gambar menjadi JPEG');
  return { blob, mutu: TANGGA_MUTU[TANGGA_MUTU.length - 1] };
}

/**
 * Gambar sumber ke kanvas tujuan, dua tahap bila pengecilannya ekstrem.
 *
 * drawImage satu lompatan dari 4000px ke 1920px menghasilkan aliasing kasar di
 * rambut dan kain gaun — justru dua hal yang paling diperhatikan di foto
 * pernikahan. Satu tahap antara menghilangkannya dengan biaya satu kanvas.
 */
function gambarTurun(sumber, lebarSumber, tinggiSumber, lebar, tinggi) {
  const c = kanvas(lebar, tinggi);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (lebar / lebarSumber < 0.5) {
    const antara = kanvas(Math.round(lebar * 2), Math.round(tinggi * 2));
    const ctxAntara = antara.getContext('2d');
    ctxAntara.imageSmoothingEnabled = true;
    ctxAntara.imageSmoothingQuality = 'high';
    ctxAntara.drawImage(sumber, 0, 0, antara.width, antara.height);
    ctx.drawImage(antara, 0, 0, lebar, tinggi);
    lepasKanvas(antara);
  } else {
    ctx.drawImage(sumber, 0, 0, lebar, tinggi);
  }
  return { c, ctx };
}

/**
 * Frame video → JPEG, dengan overlay digambar di atasnya.
 *
 * `gambarOverlay` dipanggil dengan (ctx, lebar, tinggi) supaya pemanggil bebas
 * menentukan bingkai/watermark tanpa modul ini perlu tahu soal tema pernikahan.
 */
export async function dariVideo(video, { gambarOverlay, maks = SISI_MAKS, rotasi = 0 } = {}) {
  const lebarAsli = video.videoWidth;
  const tinggiAsli = video.videoHeight;
  if (!lebarAsli || !tinggiAsli) throw new Error('Kamera belum siap');

  const { lebar, tinggi } = ukuranTerskala(lebarAsli, tinggiAsli, maks);
  const { c, ctx } = gambarTurun(video, lebarAsli, tinggiAsli, lebar, tinggi);
  try {
    const hasil = rotasi ? putarKanvas(c, rotasi) : { c, ctx, lebar, tinggi };
    try {
      // Overlay digambar SESUDAH rotasi, di ruang kanvas final. Kalau digambar
      // sebelum, watermark ikut rebah bersama gambarnya — persis cacat yang
      // membuat foto miring terlihat makin kacau.
      if (gambarOverlay) await gambarOverlay(hasil.ctx, hasil.lebar, hasil.tinggi);
      const { blob } = await encodeJpeg(hasil.c);
      return { blob, lebar: hasil.lebar, tinggi: hasil.tinggi, rotasi, sumber: 'kamera' };
    } finally {
      if (hasil.c !== c) lepasKanvas(hasil.c);
    }
  } finally {
    lepasKanvas(c);
  }
}

/**
 * Putar isi kanvas 90/180/270 derajat ke kanvas baru.
 *
 * Dibutuhkan karena saat rotasi layar HP dikunci, aliran kamera tetap dilaporkan
 * portrait sementara pemandangannya sudah rebah. Memutar di sini — bukan
 * mengandalkan EXIF — membuat berkas yang mendarat di Drive benar apa adanya,
 * tanpa bergantung pada penampil mana pun menghormati tag orientasi.
 */
export function putarKanvas(sumber, derajat) {
  const d = ((Math.round(derajat / 90) * 90) % 360 + 360) % 360;
  if (d === 0) return { c: sumber, ctx: sumber.getContext('2d'), lebar: sumber.width, tinggi: sumber.height };

  const tukar = d === 90 || d === 270;
  const lebar = tukar ? sumber.height : sumber.width;
  const tinggi = tukar ? sumber.width : sumber.height;

  const c = kanvas(lebar, tinggi);
  const ctx = c.getContext('2d');
  ctx.translate(lebar / 2, tinggi / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(sumber, -sumber.width / 2, -sumber.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { c, ctx, lebar, tinggi };
}

// --- Orientasi EXIF -------------------------------------------------------
//
// Dua kegagalan yang berlawanan harus dihindari sekaligus:
//   (a) browser TIDAK menerapkan orientasi EXIF → foto potret mendarat miring;
//   (b) browser MENERAPKANNYA (Safari begitu) dan kita menerapkannya lagi →
//       foto terputar DUA KALI.
// Tidak ada daftar versi browser yang bisa dipercaya untuk ini, jadi jawabannya
// diukur langsung di perangkat: decode JPEG 3x2 bertag orientasi 6; kalau
// hasilnya terbaca 2x3, berarti browser ini menerapkannya sendiri.

let probeTersimpan = null;

export async function probeOrientasi() {
  if (probeTersimpan !== null) return probeTersimpan;
  try {
    const biner = atob(JPEG_UJI_ORIENTASI6);
    const bytes = new Uint8Array(biner.length);
    for (let i = 0; i < biner.length; i++) bytes[i] = biner.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    // Asli 3x2; bila orientasi 6 diterapkan hasilnya menjadi 2x3.
    probeTersimpan = bitmap.width === 2 && bitmap.height === 3;
    bitmap.close?.();
  } catch {
    // Probe gagal (termasuk createImageBitmap tidak ada): anggap browser TIDAK
    // menerapkannya, lalu kita tegakkan sendiri. Salah arah di sini hanya
    // berakibat foto miring, bukan foto hilang.
    probeTersimpan = false;
  }
  return probeTersimpan;
}

async function bitmapTegak(file) {
  const otomatis = await probeOrientasi();
  if (otomatis) {
    // Browser sudah menerapkan orientasi: JANGAN diputar lagi.
    return { bitmap: await createImageBitmap(file, { imageOrientation: 'from-image' }), orientasi: 1 };
  }
  // Browser mengabaikannya: baca tag sendiri (cukup 64 KB pertama) lalu putar.
  const kepala = await file.slice(0, 65536).arrayBuffer();
  const orientasi = bacaOrientasi(kepala);
  return { bitmap: await createImageBitmap(file), orientasi };
}

/**
 * Berkas dari kamera HP bawaan / galeri → JPEG yang sudah dinormalkan.
 *
 * Melempar `GalatGambar('heic')` bila berkasnya HEIC dan decoder menolaknya.
 * Pemanggil menangkapnya dan mengirim berkas aslinya apa adanya: lebih baik
 * HEIC mendarat di Drive daripada tamu kehilangan fotonya.
 */
export async function dariBerkas(file, { gambarOverlay, maks = SISI_MAKS } = {}) {
  if (file.size > BYTES_MAKS_BERKAS) {
    throw new GalatGambar('besar', 'Foto terlalu besar. Pakai tombol kamera di halaman ini.');
  }

  let hasil;
  try {
    hasil = await bitmapTegak(file);
  } catch (e) {
    const namaHeic = /\.hei[cf]$/i.test(file.name || '');
    if (/hei[cf]/i.test(file.type || '') || namaHeic) {
      throw new GalatGambar('heic', 'Format iPhone (HEIC) tidak bisa dibaca browser ini.');
    }
    throw new GalatGambar('decode', e?.message || 'Foto tidak bisa dibaca.');
  }

  const { bitmap, orientasi } = hasil;
  let tegak = null;
  try {
    // Tegakkan lebih dulu pada ukuran asli, supaya pengecilan dan overlay
    // bekerja pada gambar yang sudah benar arahnya.
    let sumber = bitmap;
    let lebarSumber = bitmap.width;
    let tinggiSumber = bitmap.height;

    if (orientasi > 1) {
      const m = matriksOrientasi(orientasi, bitmap.width, bitmap.height);
      tegak = kanvas(m.w, m.h);
      const ctxTegak = tegak.getContext('2d');
      ctxTegak.setTransform(...m.transform);
      ctxTegak.drawImage(bitmap, 0, 0);
      ctxTegak.setTransform(1, 0, 0, 1, 0, 0);
      sumber = tegak;
      lebarSumber = m.w;
      tinggiSumber = m.h;
    }

    const { lebar, tinggi } = ukuranTerskala(lebarSumber, tinggiSumber, maks);
    const { c, ctx } = gambarTurun(sumber, lebarSumber, tinggiSumber, lebar, tinggi);
    try {
      if (gambarOverlay) await gambarOverlay(ctx, lebar, tinggi);
      const { blob } = await encodeJpeg(c);

      // Pelajaran dari goofy-report/resources/js/offline/photoStore.js: hasil
      // "kompresi" bisa justru lebih besar dari aslinya (foto kecil, atau JPEG
      // yang sudah dioptimalkan). Tanpa overlay dan tanpa rotasi, berkas asli
      // lebih baik dipakai — lebih kecil dan tanpa kehilangan mutu.
      if (!gambarOverlay && orientasi <= 1 && file.type === 'image/jpeg' && blob.size >= file.size) {
        return { blob: file, lebar: lebarSumber, tinggi: tinggiSumber, sumber: 'berkas' };
      }
      return { blob, lebar, tinggi, sumber: 'berkas' };
    } finally {
      lepasKanvas(c);
    }
  } finally {
    lepasKanvas(tegak);
    bitmap.close?.();
  }
}

export class GalatGambar extends Error {
  constructor(kode, pesan) {
    super(pesan);
    this.name = 'GalatGambar';
    this.kode = kode;
  }
}

/**
 * Putar sebuah blob JPEG 90/180/270 derajat.
 *
 * Dipakai tombol Putar manual di layar hasil — jaring pengaman ketika deteksi
 * sensor tidak tersedia (izin ditolak di iOS, perangkat tanpa sensor) atau
 * ketika arah putarnya ternyata tidak sesuai di suatu perangkat.
 */
export async function putarBlob(blob, derajat) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  let antara = null;
  try {
    antara = kanvas(bitmap.width, bitmap.height);
    antara.getContext('2d').drawImage(bitmap, 0, 0);
    const hasil = putarKanvas(antara, derajat);
    try {
      const { blob: baru } = await encodeJpeg(hasil.c);
      return { blob: baru, lebar: hasil.lebar, tinggi: hasil.tinggi };
    } finally {
      if (hasil.c !== antara) lepasKanvas(hasil.c);
    }
  } finally {
    lepasKanvas(antara);
    bitmap.close?.();
  }
}

/** Thumbnail kecil yang disimpan permanen di IndexedDB untuk halaman "Foto Saya". */
export async function buatThumb(blob, sisi = SISI_THUMB) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  let c = null;
  try {
    const { lebar, tinggi } = ukuranTerskala(bitmap.width, bitmap.height, sisi);
    c = kanvas(lebar, tinggi);
    c.getContext('2d').drawImage(bitmap, 0, 0, lebar, tinggi);
    return await keBlob(c, 0.7);
  } finally {
    lepasKanvas(c);
    bitmap.close?.();
  }
}

/**
 * Blob → string base64 (tanpa prefix `data:`).
 *
 * Sengaja memakai FileReader, bukan merakit sendiri dari potongan: encoder
 * bawaan browser berjalan di luar JS heap, jadi foto 3 MB tidak membuat HP kelas
 * bawah kehabisan memori atau melewati batas argumen String.fromCharCode. Ini
 * juga meniadakan seluruh kelas bug paling berbahaya di proyek ini — potongan
 * base64 yang disambung tanpa kelipatan 3 byte menghasilkan berkas rusak yang
 * TETAP tercatat sukses.
 */
export function base64Dari(blob) {
  return new Promise((selesai, gagal) => {
    const fr = new FileReader();
    fr.onerror = () => gagal(fr.error || new Error('Gagal membaca foto'));
    fr.onload = () => {
      const hasil = String(fr.result);
      const koma = hasil.indexOf(',');
      selesai(koma >= 0 ? hasil.slice(koma + 1) : hasil);
    };
    fr.readAsDataURL(blob);
  });
}

/** Apakah byte pertama menunjukkan JPEG? Server memeriksa hal yang sama. */
export async function tampakJpeg(blob) {
  const kepala = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  return kepala[0] === 0xff && kepala[1] === 0xd8 && kepala[2] === 0xff;
}
