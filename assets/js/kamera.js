// Kamera dalam halaman (getUserMedia) + overlay bingkai pernikahan.
//
// Jalur ini yang dipakai lebih dulu karena memberi pengalaman "photo booth":
// viewfinder penuh, tombol jepret besar, hasil langsung terlihat, bisa jepret
// beruntun tanpa keluar-masuk app kamera. Tapi dia punya dua syarat yang mudah
// jatuh: konteks harus secure (https atau localhost) dan tamu harus memberi izin.
// Kalau salah satu gagal, pemanggil pindah ke berkas-kamera.js — dan itu bukan
// keadaan darurat, itu jalur cadangan yang setara.

import { dariVideo } from './gambar.js';

let aliran = null;

export function dukungKameraLangsung() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

/**
 * Deteksi in-app browser (WhatsApp, Instagram, Facebook, Line).
 *
 * Tamu yang men-scan QR memakai app kamera bawaan dan mendarat di browser biasa,
 * jadi kasus ini muncul saat link-nya di-forward ke grup lalu dibuka di dalam
 * aplikasi chat. Di situ getUserMedia sering ditolak tanpa penjelasan, dan lebih
 * baik langsung menawarkan jalur kamera HP daripada memperlihatkan layar hitam.
 */
export function iniWebviewAplikasi() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp/i.test(ua);
}

export class GalatKamera extends Error {
  constructor(kode, pesan) {
    super(pesan);
    this.name = 'GalatKamera';
    this.kode = kode;
  }
}

function terjemahkan(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new GalatKamera('ditolak', 'Izin kamera belum diberikan.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new GalatKamera('tidak-ada', 'Kamera tidak ditemukan di perangkat ini.');
    case 'NotReadableError':
    case 'AbortError':
      return new GalatKamera('dipakai', 'Kamera sedang dipakai aplikasi lain.');
    default:
      return new GalatKamera('gagal', e?.message || 'Kamera tidak bisa dibuka.');
  }
}

/**
 * Nyalakan kamera belakang dan sambungkan ke elemen <video>.
 *
 * Resolusi diminta "ideal", bukan "exact": HP kelas bawah yang tidak punya mode
 * 2560px tetap dilayani dengan resolusi terbaik yang dia punya, bukan ditolak.
 */
export async function mulai(video) {
  if (!dukungKameraLangsung()) {
    throw new GalatKamera(
      window.isSecureContext ? 'tidak-didukung' : 'tidak-aman',
      window.isSecureContext
        ? 'Browser ini tidak mendukung kamera dalam halaman.'
        : 'Kamera hanya bisa dibuka lewat https.',
    );
  }

  hentikan();
  try {
    aliran = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1920 },
      },
      audio: false,
    });
  } catch (e) {
    throw terjemahkan(e);
  }

  video.srcObject = aliran;
  // playsinline diset dari HTML juga, tapi diulang di sini supaya elemen yang
  // dibuat lewat JS tidak lolos: tanpa ini iOS membuka video fullscreen dan
  // viewfinder-nya hilang.
  video.playsInline = true;
  video.muted = true;
  try {
    await video.play();
  } catch {
    // Beberapa browser menolak play() otomatis; frame tetap datang begitu
    // elemennya terlihat, jadi ini tidak fatal.
  }

  await siapkanUkuran(video);
  return aliran;
}

/** Tunggu sampai videoWidth terisi — tanpa ini jepretan pertama bisa 0x0. */
function siapkanUkuran(video, batasMs = 4000) {
  if (video.videoWidth) return Promise.resolve();
  return new Promise((selesai) => {
    const jam = setTimeout(selesai, batasMs);
    video.addEventListener(
      'loadedmetadata',
      () => {
        clearTimeout(jam);
        selesai();
      },
      { once: true },
    );
  });
}

export function sedangMenyala() {
  return Boolean(aliran);
}

/**
 * Matikan kamera.
 *
 * Wajib dipanggil saat tamu meninggalkan panel jepret: lampu kamera yang terus
 * menyala membuat tamu curiga, dan di iOS stream yang dibiarkan hidup membuat
 * izin diminta ulang dengan cara yang aneh.
 */
export function hentikan() {
  if (!aliran) return;
  for (const jalur of aliran.getTracks()) jalur.stop();
  aliran = null;
}

/** Ambil satu frame sebagai JPEG. */
export async function jepret(video, { gambarOverlay } = {}) {
  if (!aliran) throw new GalatKamera('mati', 'Kamera belum menyala.');
  return dariVideo(video, { gambarOverlay });
}
