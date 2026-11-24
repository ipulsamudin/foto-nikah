// Identitas tamu: nama yang dia tulis sendiri + id perangkat.
//
// Tidak ada login dan tidak ada akun. "Galeri saya" berarti "foto yang diambil dari
// perangkat ini", jadi id perangkat-lah yang jadi pengenal, bukan nama. Nama hanya
// label untuk nama berkas di Drive dan untuk ditampilkan.

import { uuid } from './fmt.js';

const KUNCI_NAMA = 'foto-nikah:nama';
const KUNCI_DEVICE = 'foto-nikah:device';
const KUNCI_SESI = 'foto-nikah:sesi';

function bacaLokal(kunci) {
  try {
    return localStorage.getItem(kunci);
  } catch {
    // Safari mode privat bisa melempar saat localStorage diakses. Jangan sampai
    // seluruh aplikasi mati hanya karena nama tamu tidak bisa disimpan.
    return null;
  }
}

function tulisLokal(kunci, nilai) {
  try {
    localStorage.setItem(kunci, nilai);
    return true;
  } catch {
    return false;
  }
}

/** Id perangkat, dibuat sekali lalu dipakai selamanya. */
export function idPerangkat() {
  let id = bacaLokal(KUNCI_DEVICE);
  if (!id) {
    id = uuid();
    tulisLokal(KUNCI_DEVICE, id);
  }
  return id;
}

/** `?to=Rani` — konvensi yang sudah dipakai undangan cetak maupun undangan digital. */
export function namaDariUrl() {
  const p = new URLSearchParams(location.search);
  return (p.get('to') || p.get('nama') || '').trim();
}

/** `?sesi=akad|resepsi|meja-01` — tag dari QR mana tamu masuk. */
export function sesiDariUrl() {
  const p = new URLSearchParams(location.search);
  const sesi = (p.get('sesi') || p.get('s') || '').trim().slice(0, 24);
  if (sesi) tulisLokal(KUNCI_SESI, sesi);
  return sesi || bacaLokal(KUNCI_SESI) || 'umum';
}

export function namaTersimpan() {
  return (bacaLokal(KUNCI_NAMA) || '').trim();
}

export function simpanNama(nama) {
  const bersih = String(nama ?? '').trim().slice(0, 60);
  tulisLokal(KUNCI_NAMA, bersih);
  return bersih;
}

/** Sudah pernah lewat gerbang nama? (nama kosong karena di-skip tetap dihitung sudah.) */
export function sudahDiisi() {
  return bacaLokal(KUNCI_NAMA) !== null;
}

/** Nama final yang dipakai untuk unggah: isian tamu → `?to=` → "Tamu". */
export function namaEfektif() {
  return namaTersimpan() || namaDariUrl() || 'Tamu';
}

export function lupakanSaya() {
  for (const k of [KUNCI_NAMA, KUNCI_DEVICE, KUNCI_SESI]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* diamkan: tidak ada yang bisa dilakukan */
    }
  }
}
