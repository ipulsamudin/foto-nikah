// Menyimpan foto ke galeri/album HP si pemfoto.
//
// Di web tidak ada API "tulis ke galeri". Yang ada tiga jalan, dan ketiganya
// dipakai berurutan karena masing-masing gagal di tempat yang berbeda:
//
//   1. navigator.share({files}) — Web Share Level 2. Di iOS Safari 15+ memunculkan
//      share sheet yang berisi "Save Image"; di Android Chrome menyimpan ke
//      Photos/Files. Ini jalan terbaik, tapi TIDAK dijamin: pada sebagian iOS,
//      target share mengambil link alih-alih berkas dan "Save Image" tidak muncul.
//   2. <a download> — Android menyimpannya ke Downloads (terlihat di galeri),
//      desktop ke folder unduhan. Di iOS masuk app Files, bukan Photos.
//   3. Instruksi manual: foto ditampilkan sebagai <img> dan tamu diminta menahan
//      jarinya lalu memilih "Add to Photos". Ini satu-satunya cara yang selalu
//      ada di iOS, jadi instruksinya tidak pernah disembunyikan.
//
// SEMUA fungsi di sini wajib dipanggil langsung di dalam handler tap. iOS
// membatalkan share() yang dipanggil setelah await panjang (dianggap bukan lagi
// gestur pengguna) — itu sebabnya foto disiapkan lebih dulu, tombol baru muncul
// setelah blob siap, dan fungsi ini hanya menerima blob yang sudah jadi.

/** Platform yang butuh instruksi "tahan foto → Add to Photos". */
export function iniIos() {
  const ua = navigator.userAgent || '';
  const iPadBaru = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadBaru;
}

function keFile(blob, nama) {
  // navigator.share butuh File, bukan Blob biasa.
  return new File([blob], nama, { type: blob.type || 'image/jpeg', lastModified: Date.now() });
}

export function bisaBagikanBerkas(blob, nama = 'foto.jpg') {
  try {
    if (!navigator.canShare || !navigator.share) return false;
    return navigator.canShare({ files: [keFile(blob, nama)] });
  } catch {
    return false;
  }
}

function unduh(blob, nama) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nama;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Jangan dicabut terlalu cepat: Safari masih membaca blob-nya saat unduhan mulai.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Simpan satu foto. Mengembalikan cara yang akhirnya dipakai, supaya UI bisa
 * menampilkan pesan yang tepat ("tersimpan" vs "pilih Save Image" vs "tahan foto").
 *
 * @returns {Promise<{cara:'share'|'unduh'|'manual', dibatalkan:boolean}>}
 */
export async function simpanKeGaleri(blob, nama = 'foto.jpg') {
  if (bisaBagikanBerkas(blob, nama)) {
    try {
      await navigator.share({ files: [keFile(blob, nama)] });
      return { cara: 'share', dibatalkan: false };
    } catch (e) {
      // AbortError = tamu menutup share sheet. Itu keputusan dia, bukan kegagalan:
      // jangan diam-diam mengunduh berkas yang baru saja dia tolak.
      if (e?.name === 'AbortError') return { cara: 'share', dibatalkan: true };
      // Galat lain (share tidak didukung sebenarnya, berkas terlalu besar) → turun
      // ke jalan berikutnya.
    }
  }

  if (!iniIos()) {
    unduh(blob, nama);
    return { cara: 'unduh', dibatalkan: false };
  }

  // iOS tanpa share yang berfungsi: unduhan hanya mendarat di Files, jadi lebih
  // jujur meminta tamu menahan foto yang sudah tampil di layar.
  return { cara: 'manual', dibatalkan: false };
}

/**
 * Simpan tanpa menunggu ketukan, dipanggil tepat setelah jepretan jadi.
 *
 * SENGAJA tidak memakai share sheet, walaupun share sheet mendarat lebih rapi di
 * app Foto: share sheet menuntut ketukan, dan yang diminta justru "langsung
 * tersimpan". Jadi di sini hanya jalur unduhan.
 *
 * Mengembalikan false di iOS, dan itu bukan kemalasan: unduhan otomatis di iOS
 * mendarat di app Files, bukan app Foto, dan Safari memblokir unduhan yang tidak
 * berasal dari gestur. Di iOS, tombol satu-ketukan + instruksi tahan-foto tetap
 * jalan terbaik yang tersedia.
 *
 * @returns {boolean} true bila unduhan benar-benar dimulai
 */
export function unduhOtomatis(blob, nama = 'foto.jpg') {
  if (iniIos()) return false;
  try {
    unduh(blob, nama);
    return true;
  } catch {
    // Browser bisa menolak unduhan otomatis (mis. pengaturan "unduh banyak
    // berkas" belum diizinkan). Tombol manual di panel hasil tetap ada sebagai
    // jaring pengaman, jadi kegagalan di sini tidak menghilangkan apa pun.
    return false;
  }
}

/**
 * Simpan beberapa foto sekaligus ("Simpan semua ke galeri").
 *
 * iOS menerima beberapa berkas dalam satu share sheet dan menampilkan
 * "Save N Images" — jauh lebih nyaman daripada menekan tombol sepuluh kali.
 * Dibatasi 10 berkas per panggilan karena share sheet mulai menolak muatan besar.
 */
export const MAKS_PER_BAGI = 10;

export async function simpanBanyak(daftar) {
  const potongan = daftar.slice(0, MAKS_PER_BAGI);
  if (!potongan.length) return { cara: 'manual', dibatalkan: false, jumlah: 0 };

  const files = potongan.map(({ blob, nama }) => keFile(blob, nama));
  try {
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files });
      return { cara: 'share', dibatalkan: false, jumlah: files.length };
    }
  } catch (e) {
    if (e?.name === 'AbortError') return { cara: 'share', dibatalkan: true, jumlah: 0 };
  }

  if (!iniIos()) {
    for (const { blob, nama } of potongan) unduh(blob, nama);
    return { cara: 'unduh', dibatalkan: false, jumlah: potongan.length };
  }
  return { cara: 'manual', dibatalkan: false, jumlah: 0 };
}
