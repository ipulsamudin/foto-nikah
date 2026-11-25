/**
 * Indeks.gs — Google Sheet sebagai indeks foto, plus rekonsiliasi.
 *
 * Urutan yang jadi invarian seluruh sistem: Drive dulu, cache kedua, Sheet
 * ketiga. Fotonya tidak tergantikan; indeksnya bisa dibangun ulang. Jangan
 * pernah dibalik.
 */

var KOLOM_INDEKS = [
  'waktu_server',
  'kunci_idempotensi',
  'id_pendek',
  'nama_tamu_asli',
  'nama_tamu_bersih',
  'nama_berkas',
  'id_file_drive',
  'url_file',
  'ukuran_byte',
  'perangkat',
  'sesi',
  'pesan',
  'waktu_klien',
  'catatan',
  'versi_backend'
];

/**
 * Ambil tab indeks, BUATKAN kalau belum ada.
 *
 * Ini menutup kegagalan paling berbahaya yang pernah terjadi di proyek ini:
 * backend diarahkan ke Spreadsheet baru, inisialisasi() lupa dijalankan di sana,
 * dan sejak itu setiap unggahan tetap menjawab ok:true — karena kegagalan indeks
 * memang SENGAJA tidak menggagalkan foto tamu — sementara tidak satu pun baris
 * tercatat. Kegagalan yang tidak terlihat adalah kegagalan yang baru ketahuan
 * setelah acara selesai, saat tidak ada lagi yang bisa diperbaiki.
 *
 * Dipanggil dari dalam lock pada jalur tulis, jadi dua eksekusi tidak bisa
 * membuat tab kembar. Pada jalur baca, kegagalan membuat tab bukan masalah:
 * pemanggil cukup memperlakukan indeks sebagai kosong.
 */
function lembarIndeks(buatBilaTiada) {
  var ss = SpreadsheetApp.openById(PENGATURAN.ID_SPREADSHEET);
  var lembar = ss.getSheetByName(PENGATURAN.LEMBAR_INDEKS);
  if (lembar || !buatBilaTiada) return lembar;

  try {
    lembar = ss.insertSheet(PENGATURAN.LEMBAR_INDEKS);
    lembar.appendRow(KOLOM_INDEKS);
    lembar.setFrozenRows(1);
    lembar.getRange(1, 1, 1, KOLOM_INDEKS.length).setFontWeight('bold');
    catat('INDEKS_DIBUAT_OTOMATIS', new Error(PENGATURAN.LEMBAR_INDEKS));
  } catch (e) {
    // Eksekusi lain mungkin mendahului kita membuat tab yang sama.
    lembar = ss.getSheetByName(PENGATURAN.LEMBAR_INDEKS);
  }
  return lembar;
}

/**
 * Tambah satu baris indeks.
 *
 * getRange().setValues() DITOLAK untuk keperluan ini: ia butuh getLastRow()
 * lebih dulu, dan itu read-modify-write klasik lintas eksekusi — dua eksekusi
 * membaca baris 847, keduanya menulis baris 847, dan satu baris tamu HILANG
 * tanpa jejak. Kehilangan indeks secara senyap adalah kegagalan terburuk yang
 * tersedia.
 *
 * appendRow dipilih, tapi dokumentasinya tidak menjanjikan atomisitas apa pun,
 * jadi tetap dikurung lock pendek yang HANYA menutupi append — bukan decode,
 * bukan tulis Drive. Dengan begitu throughput tidak terpengaruh: tulis Drive
 * tetap berjalan paralel.
 */
function tambahBarisIndeks(baris) {
  var kunci = LockService.getScriptLock();

  // tryLock, BUKAN waitLock. waitLock MELEMPAR exception saat habis waktu, dan
  // di sini exception berarti permintaan gagal — padahal fotonya SUDAH aman di
  // Drive. Kita tidak akan pernah menggagalkan unggahan hanya karena indeksnya
  // sibuk. tryLock mengembalikan false, dan false itu bisa ditangani.
  if (!kunci.tryLock(PENGATURAN.BATAS_LOCK_MS)) {
    catat('LOCK_INDEKS_GAGAL', new Error('id_pendek=' + baris[2]));
    return false;
  }
  try {
    // Dibuat di sini bila belum ada — di dalam lock, jadi tidak mungkin kembar.
    var lembar = lembarIndeks(true);
    if (!lembar) throw new Error('Tab "' + PENGATURAN.LEMBAR_INDEKS + '" tidak bisa dibuat');
    lembar.appendRow(baris);
    SpreadsheetApp.flush(); // paksa tulis sebelum lock dilepas
    return true;
  } catch (e) {
    catat('APPEND_GAGAL', e);
    return false;
  } finally {
    // WAJIB di finally: lock yang nyangkut memblokir semua eksekusi lain
    // sampai TTL-nya habis.
    kunci.releaseLock();
  }
}

/**
 * N baris terakhir. Dibaca dengan rentang terbatas, bukan getDataRange():
 * pada 2.000 baris, membaca seluruh data hanya untuk mengambil 24 baris
 * terakhir adalah pemborosan yang akan terasa tepat saat acara ramai.
 *
 * Tidak mengembalikan URL gambar untuk dirender. Itu konsisten dengan keputusan
 * tidak pernah memakai drive.google.com/thumbnail, yang kena rate-limit pada
 * halaman dengan 10+ gambar.
 */
function ambilTerbaru(n) {
  n = Math.min(Math.max(Number(n) || 24, 1), 100);
  // Jalur baca tidak membuat tab: indeks yang belum ada sama saja dengan indeks
  // kosong, dan melempar TypeError di sini hanya menyamarkan penyebabnya.
  var lembar = lembarIndeks(false);
  if (!lembar) return [];
  var akhir = lembar.getLastRow();
  if (akhir < 2) return [];
  var mulai = Math.max(2, akhir - n + 1);
  var nilai = lembar.getRange(mulai, 1, akhir - mulai + 1, KOLOM_INDEKS.length).getValues();
  var keluar = [];
  for (var i = nilai.length - 1; i >= 0; i--) {
    keluar.push({
      waktu: String(nilai[i][0]),
      nama: String(nilai[i][3]),
      sesi: String(nilai[i][10]),
      idBerkas: String(nilai[i][6]),
      namaBerkas: String(nilai[i][5])
    });
  }
  return keluar;
}

/**
 * Bangun ulang baris indeks yang hilang dari isi folder Drive.
 *
 * Bisa dijalankan karena nama berkas memuat id_pendek yang berasal dari kunci
 * idempotensi — folder Drive-nya bisa dibaca sendiri, tanpa basis data. Aman
 * dijalankan berulang kali.
 *
 * Dijalankan manual dari editor setelah acara, bukan lewat trigger: ini
 * keputusan manusia, dan trigger per menit akan memakan lebih dari separuh
 * anggaran trigger harian akun konsumen (90 menit) tanpa alasan.
 */
function rekonsiliasi() {
  var lembar = SpreadsheetApp.openById(PENGATURAN.ID_SPREADSHEET).getSheetByName(
    PENGATURAN.LEMBAR_INDEKS
  );
  var akhir = lembar.getLastRow();
  var adaId = {};
  if (akhir >= 2) {
    var kolom = lembar.getRange(2, 3, akhir - 1, 1).getValues();
    for (var i = 0; i < kolom.length; i++) adaId[String(kolom[i][0])] = true;
  }

  var folder = DriveApp.getFolderById(PENGATURAN.ID_FOLDER_FOTO);
  var iter = folder.getFiles();
  var jumlahDrive = 0;
  var ditambahkan = 0;
  var namaTerlihat = {};
  var duplikatNama = 0;

  while (iter.hasNext()) {
    var berkas = iter.next();
    jumlahDrive++;
    var nama = berkas.getName();
    if (namaTerlihat[nama]) duplikatNama++;
    namaTerlihat[nama] = true;

    var cocok = nama.match(/^(\d{8}-\d{6})_(.+)_([a-z0-9]{8})\.jpg$/);
    if (!cocok) continue;
    var id8 = cocok[3];
    if (adaId[id8]) continue;

    tambahBarisIndeks([
      cocok[1],
      '',
      id8,
      cocok[2],
      cocok[2],
      nama,
      berkas.getId(),
      'https://drive.google.com/file/d/' + berkas.getId() + '/view',
      berkas.getSize(),
      '',
      '',
      '',
      '',
      'dari-rekonsiliasi',
      PENGATURAN.VERSI
    ]);
    adaId[id8] = true;
    ditambahkan++;
  }

  var hasil = {
    jumlah_drive: jumlahDrive,
    jumlah_sheet: Math.max(lembar.getLastRow() - 1, 0),
    ditambahkan: ditambahkan,
    duplikat_nama: duplikatNama
  };
  console.log(JSON.stringify(hasil));
  return hasil;
}

/**
 * Siapkan ketiga tab beserta judul kolomnya. Aman dijalankan berulang.
 * Jalankan sekali dari editor — sekaligus memicu layar otorisasi scope.
 */
function inisialisasi() {
  var ss = SpreadsheetApp.openById(PENGATURAN.ID_SPREADSHEET);

  var indeks = ss.getSheetByName(PENGATURAN.LEMBAR_INDEKS) || ss.insertSheet(PENGATURAN.LEMBAR_INDEKS);
  if (indeks.getLastRow() === 0) {
    indeks.appendRow(KOLOM_INDEKS);
    indeks.setFrozenRows(1);
    indeks.getRange(1, 1, 1, KOLOM_INDEKS.length).setFontWeight('bold');
  }

  var atur = ss.getSheetByName(PENGATURAN.LEMBAR_PENGATURAN) || ss.insertSheet(PENGATURAN.LEMBAR_PENGATURAN);
  if (atur.getLastRow() === 0) {
    atur.appendRow(['kunci', 'nilai', 'catatan']);
    atur.appendRow(['aktif', 'YA', 'YA/TIDAK — saklar darurat, berlaku dalam 60 detik']);
    atur.appendRow([
      'pesan_mati',
      'Booth foto sedang istirahat. Foto Anda tetap aman di HP.',
      'Ditampilkan ke tamu saat aktif=TIDAK'
    ]);
    atur.appendRow(['token_aktif', '', 'Token tambahan yang berlaku; boleh dirotasi kapan saja']);
    atur.appendRow(['token_lama', '', 'Token sebelumnya, tetap diterima agar PWA lama tidak terkunci']);
    atur.appendRow(['token_admin', '', 'Hanya untuk aksi=hapus_uji. JANGAN pernah ditaruh di data/api.json']);
    atur.appendRow(['maks_harian', String(PENGATURAN.MAKS_HARIAN), 'Batas keras jumlah foto per hari']);
    atur.appendRow([
      'maks_per_menit_perangkat',
      String(PENGATURAN.MAKS_PER_MENIT_PERANGKAT),
      'Naikkan bila satu HP dipakai bergiliran serombongan tamu'
    ]);
    atur.appendRow([
      'maks_per_menit_global',
      String(PENGATURAN.MAKS_PER_MENIT_GLOBAL),
      'Rem banjir; naikkan bila banyak TERLALU_RAMAI saat acara'
    ]);
    atur.setFrozenRows(1);
    atur.getRange(1, 1, 1, 3).setFontWeight('bold');
  }

  var ring = ss.getSheetByName(PENGATURAN.LEMBAR_RINGKASAN) || ss.insertSheet(PENGATURAN.LEMBAR_RINGKASAN);
  if (ring.getLastRow() === 0) {
    ring.appendRow(['Jumlah foto', '=COUNTA(Foto!A2:A)']);
    ring.appendRow(['Total GB', '=IFERROR(SUM(Foto!I2:I)/1073741824,0)']);
    ring.appendRow(['Baris bermasalah', '=COUNTIF(Foto!N2:N,"<>")']);
    ring.appendRow(['Jumlah berkas di Drive (isi manual dari rekonsiliasi)', '']);
    ring.appendRow(['Selisih Drive - Sheet', '=IFERROR(B4-B1,"")']);
    ring.getRange(1, 1, 5, 1).setFontWeight('bold');
  }

  console.log('inisialisasi selesai: ' + ss.getName());
  return true;
}
