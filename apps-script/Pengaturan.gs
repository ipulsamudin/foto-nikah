/**
 * Pengaturan.gs — satu-satunya berkas yang perlu disentuh saat memasang backend ini.
 *
 * Kenapa semua ID ditulis eksplisit dan bukan memakai getActiveSpreadsheet():
 * proyek ini STANDALONE, bukan terikat ke Sheet. Dengan ID eksplisit, kode yang
 * sama persis bisa diarahkan ke folder + Sheet UJI selama latihan, lalu
 * diarahkan ke yang sungguhan pada hari-H hanya dengan mengganti dua baris.
 * Dalam 13 hari kita akan menjalankan uji asap puluhan kali; foto uji tidak
 * boleh mengotori galeri tamu yang asli.
 *
 * ATURAN KERAS: jangan pernah menjalankan apa pun di tingkat atas berkas .gs
 * selain deklarasi const/function. Apps Script menggabungkan semua .gs menjadi
 * satu scope global dengan urutan muat alfabetis; `function` ter-hoist tapi
 * `const` tidak, sehingga kode tingkat-atas bisa meledak hanya karena nama
 * berkasnya kebetulan urut lebih awal.
 */

var PENGATURAN = {
  /**
   * Dinaikkan SETIAP kali kode diubah. Dikembalikan oleh ?aksi=sehat, dan
   * tools/cek-endpoint.mjs membandingkannya dengan berkas lokal. Inilah
   * satu-satunya cara membuktikan bahwa URL di data/api.json benar-benar
   * menjalankan kode terbaru — lihat apps-script/README.md bagian "jebakan
   * deployment", yang tanpa penanda ini mustahil didiagnosis saat acara.
   */
  VERSI: '2026-12-06.2',

  /**
   * DUA ID DI BAWAH SENGAJA DIBIARKAN KOSONG DI REPO.
   *
   * Bukan karena rahasia — ID folder album memang sudah terbit di config.js,
   * sebab link-nya diberikan ke semua tamu. Alasannya operasional: berkas ini
   * harus bisa diarahkan ke folder + Sheet UJI selama latihan, lalu dialihkan ke
   * yang asli pada 5 Desember, tanpa commit dan tanpa risiko seseorang menempel
   * berkas ini lalu menjalankan uji asap ke folder foto tamu yang sungguhan.
   *
   * Nilai sebenarnya ada di editor Apps Script dan di `pemasangan.local.md`
   * (di-gitignore). Isi keduanya SETELAH menempel berkas ini ke editor.
   *
   * Yang WAJIB tetap sama antara repo dan editor hanyalah VERSI di atas —
   * itulah yang dibandingkan oleh tools/cek-endpoint.mjs untuk membuktikan
   * deployment yang hidup benar-benar menjalankan kode terbaru.
   */
  ID_FOLDER_FOTO: 'ISI_ID_FOLDER',
  ID_SPREADSHEET: 'ISI_ID_SHEET',
  LEMBAR_INDEKS: 'Foto',
  LEMBAR_PENGATURAN: 'Pengaturan',
  LEMBAR_RINGKASAN: 'Ringkasan',

  /** Harus sama dengan timeZone di appsscript.json, kalau tidak nama berkas beda 7 jam. */
  ZONA_WAKTU: 'Asia/Jakarta',

  /**
   * Lantai token. Sheet boleh MENAMBAH token kedua dan boleh MEMATIKAN booth,
   * tapi tidak bisa membuat token ini tidak berlaku. Jadi kalau Sheet-nya rusak,
   * booth tetap menerima foto. Kehilangan foto tidak bisa diterima.
   */
  TOKEN_DASAR: 'xTciJx5LZAOgqPvq-lcD3I-n',

  /**
   * Jendela acara. Akad 09:00; dibuka 06:00 untuk gladi, ditutup 06:00 besoknya
   * supaya foto yang masih nyangkut di antrean HP tamu bisa menyusul semalaman.
   *
   * Ini mitigasi paling berharga dan paling murah di seluruh desain: URL dan
   * token akan hidup selamanya di repo publik, dan jendela ini membuat endpoint
   * benar-benar mati 364 hari setahun.
   */
  JENDELA_MULAI: '2026-12-06T06:00:00+07:00',
  JENDELA_SELESAI: '2026-12-07T06:00:00+07:00',

  MAKS_BASE64: 8 * 1024 * 1024, // ~6 MB JPEG; base64 memuai 4/3
  MIN_BYTE: 100,
  MAKS_PER_MENIT_PERANGKAT: 12,
  MAKS_PER_MENIT_GLOBAL: 60,
  MAKS_HARIAN: 3000,

  TTL_SEDANG: 120, // penanda "sedang diproses" — sengaja pendek, lihat Penjaga.gs
  TTL_SELESAI: 21600, // 6 jam = batas maksimum CacheService
  TTL_LAJU: 90, // sengaja terpendek, lihat catatan eviksi di Penjaga.gs
  TTL_PENGATURAN: 60, // keterlambatan maksimum saklar darurat
  BATAS_LOCK_MS: 25000,
  PANJANG_NAMA: 40
};

/**
 * Lapisan pengaturan yang bisa diubah saat acara berjalan, dari aplikasi Sheets
 * di HP, tanpa deploy ulang. Dibaca lewat cache sehingga beban Sheet tetap satu
 * kali per menit berapa pun ramainya.
 */
function bacaPengaturanSheet() {
  var cache = CacheService.getScriptCache();
  var mentah = cache.get('cfg:v1');
  if (mentah) {
    try {
      return JSON.parse(mentah);
    } catch (e) {
      /* lanjut baca ulang dari Sheet */
    }
  }
  try {
    var lembar = SpreadsheetApp.openById(PENGATURAN.ID_SPREADSHEET).getSheetByName(
      PENGATURAN.LEMBAR_PENGATURAN
    );
    // getSheetByName mengembalikan null kalau tabnya tidak ada, dan pesan bawaan
    // Apps Script untuk itu ("Cannot read properties of null") tidak memberi tahu
    // apa pun tentang penyebabnya. Sembilan dari sepuluh kali penyebabnya satu:
    // inisialisasi() belum pernah dijalankan, jadi tab Pengaturan belum dibuat.
    if (!lembar) {
      throw new Error(
        'Tab "' + PENGATURAN.LEMBAR_PENGATURAN + '" belum ada di Spreadsheet ini. ' +
          'Jalankan fungsi inisialisasi() lebih dulu (pilih di dropdown fungsi, lalu Jalankan).'
      );
    }
    var baris = Math.max(lembar.getLastRow() - 1, 1);
    var nilai = lembar.getRange(2, 1, baris, 2).getValues();
    var p = {};
    for (var i = 0; i < nilai.length; i++) {
      var k = String(nilai[i][0] || '').trim();
      if (k) p[k] = String(nilai[i][1] === null ? '' : nilai[i][1]).trim();
    }
    cache.put('cfg:v1', JSON.stringify(p), PENGATURAN.TTL_PENGATURAN);
    return p;
  } catch (e) {
    /**
     * GAGAL-TERBUKA, dan ini keputusan sadar.
     *
     * Kalau Sheet tidak bisa dibaca, kita TETAP menerima foto. Konsekuensinya
     * jujur: saklar darurat yang tidak bisa dibaca adalah saklar darurat yang
     * tidak menyala. Risiko itu diterima karena di sistem ini tidak ada rahasia
     * yang bisa bocor — kerugian terburuknya adalah sampah di Drive, dan sampah
     * bisa dihapus. Foto tamu yang hilang tidak bisa dikembalikan.
     */
    catat('PENGATURAN_TIDAK_TERBACA', e);
    return {};
  }
}

function angkaPengaturan(p, kunci, bawaan) {
  var n = Number(p[kunci]);
  return isFinite(n) && n > 0 ? n : bawaan;
}
