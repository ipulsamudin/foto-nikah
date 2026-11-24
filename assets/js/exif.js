// Pembaca orientasi EXIF — fungsi murni, tanpa DOM, tanpa pustaka.
//
// Mengapa ini ada: foto dari kamera HP (terutama iPhone) menyimpan rotasi sebagai
// TAG EXIF, bukan dengan memutar pikselnya. Kalau pikselnya digambar mentah ke
// canvas, foto potret mendarat miring di Drive.
//
// Yang membuatnya berbahaya adalah arah sebaliknya: Safari MENERAPKAN rotasi EXIF
// secara otomatis saat gambar digambar ke canvas. Kalau kita menerapkannya lagi,
// foto terputar DUA KALI — bug yang baru ketahuan saat tamu pertama memegang HP
// miring. Maka modul ini hanya MEMBACA tag; keputusan "perlu diputar atau tidak"
// diambil setelah probe nyata di perangkat (lihat gambar.js: probeOrientasi).

/** Orientasi 5–8 menukar sisi panjang dan pendek. */
export function orientasiMenukarSisi(o) {
  return o >= 5 && o <= 8;
}

/**
 * Baca tag orientasi (0x0112) dari header JPEG.
 *
 * Hanya 64 KB pertama yang perlu dibaca — EXIF selalu berada di awal berkas.
 * Buffer rusak, terpotong, atau bukan JPEG mengembalikan 1 (normal) dan TIDAK
 * melempar: foto yang sedikit miring jauh lebih baik daripada foto yang hilang.
 */
export function bacaOrientasi(buffer) {
  try {
    const d = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
    if (d.byteLength < 4) return 1;
    if (d.getUint16(0, false) !== 0xffd8) return 1; // bukan JPEG

    let pos = 2;
    while (pos + 4 <= d.byteLength) {
      if (d.getUint8(pos) !== 0xff) return 1; // marker rusak
      const marker = d.getUint8(pos + 1);
      if (marker === 0xda) return 1;          // mulai data gambar, EXIF tidak ada
      const panjang = d.getUint16(pos + 2, false);
      if (panjang < 2) return 1;

      if (marker === 0xe1) {
        const awal = pos + 4;
        // "Exif\0\0"
        if (awal + 6 > d.byteLength) return 1;
        if (d.getUint32(awal, false) !== 0x45786966) return 1;
        return bacaTiff(d, awal + 6);
      }
      pos += 2 + panjang;
    }
    return 1;
  } catch {
    return 1;
  }
}

function bacaTiff(d, awal) {
  if (awal + 8 > d.byteLength) return 1;
  const tanda = d.getUint16(awal, false);
  // 0x4949 = little endian ("II"), 0x4D4D = big endian ("MM").
  // Kedua-duanya nyata di alam: iPhone memakai big endian, banyak Android little.
  if (tanda !== 0x4949 && tanda !== 0x4d4d) return 1;
  const kecil = tanda === 0x4949;

  if (d.getUint16(awal + 2, kecil) !== 0x002a) return 1;
  const offsetIfd = d.getUint32(awal + 4, kecil);
  const ifd = awal + offsetIfd;
  if (ifd + 2 > d.byteLength) return 1;

  const jumlah = d.getUint16(ifd, kecil);
  for (let i = 0; i < jumlah; i++) {
    const entri = ifd + 2 + i * 12;
    if (entri + 12 > d.byteLength) return 1;
    if (d.getUint16(entri, kecil) === 0x0112) {
      const nilai = d.getUint16(entri + 8, kecil);
      return nilai >= 1 && nilai <= 8 ? nilai : 1;
    }
  }
  return 1;
}

/**
 * Matriks transformasi canvas untuk menegakkan gambar beroreintasi `o`.
 *
 * Dipakai HANYA bila probe membuktikan browser ini TIDAK menerapkan orientasi
 * EXIF sendiri. Mengembalikan ukuran kanvas yang benar sekaligus transform-nya.
 */
export function matriksOrientasi(o, lebar, tinggi) {
  const tukar = orientasiMenukarSisi(o);
  const w = tukar ? tinggi : lebar;
  const h = tukar ? lebar : tinggi;
  switch (o) {
    case 2: return { w, h, transform: [-1, 0, 0, 1, lebar, 0] };
    case 3: return { w, h, transform: [-1, 0, 0, -1, lebar, tinggi] };
    case 4: return { w, h, transform: [1, 0, 0, -1, 0, tinggi] };
    case 5: return { w, h, transform: [0, 1, 1, 0, 0, 0] };
    case 6: return { w, h, transform: [0, 1, -1, 0, tinggi, 0] };
    case 7: return { w, h, transform: [0, -1, -1, 0, tinggi, lebar] };
    case 8: return { w, h, transform: [0, -1, 1, 0, 0, lebar] };
    default: return { w: lebar, h: tinggi, transform: [1, 0, 0, 1, 0, 0] };
  }
}

/**
 * JPEG 3x2 piksel dengan tag orientasi 6 (harus tampil 2x3 bila orientasi
 * diterapkan). Dipakai sebagai batu uji probe di gambar.js — jauh lebih andal
 * daripada menebak dari versi browser di user agent.
 */
export const JPEG_UJI_ORIENTASI6 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/' +
  '2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0' +
  'Hyc5PTgyPDc0NP/AABEIAAIAAwMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYH' +
  'CAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtFw' +
  'JDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6' +
  'g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk' +
  '5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A3qKKKAP/2Q==';
