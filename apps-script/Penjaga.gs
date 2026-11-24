/**
 * Penjaga.gs — semua pemeriksaan sebelum sebuah foto boleh masuk Drive,
 * ditambah idempotensi.
 *
 * Setiap fungsi periksa* mengembalikan null bila lolos, atau objek galat yang
 * siap dikirim bila ditolak. Dengan begitu doPost menjadi rantai datar tanpa
 * percabangan bersarang, dan tidak ada cabang yang bisa terlewat.
 *
 * PREMIS YANG JUJUR, DITULIS SEKALI DAN TERANG: desain ini tidak punya rahasia.
 * URL /exec dan token ada di dalam repo GitHub Pages yang publik. Siapa pun yang
 * membuka DevTools — atau sekadar membaca repo — bisa mengirim POST. Semua yang
 * ada di berkas ini adalah PEMBATAS DAMPAK, bukan kontrol akses.
 */

/* ---------------------------------------------------------------- parameter */

function periksaParam(p) {
  if (!p.kunci || String(p.kunci).length < 8) {
    return galat('PARAM_KURANG', 'Parameter kunci tidak ada', false, 0);
  }
  if (!p.perangkat) {
    return galat('PARAM_KURANG', 'Parameter perangkat tidak ada', false, 0);
  }
  return null;
}

/* -------------------------------------------------------------------- token */

/**
 * Dua token berlaku sekaligus, dan ini ESENSIAL: PWA yang sudah terpasang di HP
 * tamu bisa memegang data/api.json versi lama. Rotasi token tunggal akan
 * mengunci tamu sungguhan di tengah acara.
 */
function periksaToken(p, cfg) {
  var sah = {};
  sah[PENGATURAN.TOKEN_DASAR] = true;
  if (cfg.token_aktif) sah[cfg.token_aktif] = true;
  if (cfg.token_lama) sah[cfg.token_lama] = true;

  if (!p.t || !sah[String(p.t)]) {
    return galat('TOKEN_SALAH', 'Token tidak dikenali', false, 0);
  }
  return null;
}

/* ------------------------------------------------------------------ jendela */

function periksaJendela() {
  var kini = Date.now();
  var mulai = new Date(PENGATURAN.JENDELA_MULAI).getTime();
  var selesai = new Date(PENGATURAN.JENDELA_SELESAI).getTime();
  if (kini < mulai || kini > selesai) {
    return galat('DI_LUAR_JENDELA', 'Booth foto sudah ditutup. Terima kasih!', false, 0);
  }
  return null;
}

/* ------------------------------------------------------------------- ukuran */

/**
 * Diperiksa dari e.postData.length, SEBELUM base64Decode.
 *
 * Mendekode 40 MB hanya untuk tahu bahwa ukurannya berlebih membuang slot
 * eksekusi — dan slot (30 serentak per pengguna) adalah sumber daya paling
 * langka di sini, jauh lebih langka daripada kuota apa pun.
 */
function periksaUkuran(e) {
  var panjang = (e.postData && e.postData.length) || 0;
  if (!panjang) return galat('PARAM_KURANG', 'Badan permintaan kosong', false, 0);
  if (panjang > PENGATURAN.MAKS_BASE64) {
    // ulangi:true — klien boleh mengecilkan mutu lalu mengirim lagi.
    return galat('TERLALU_BESAR', 'Foto terlalu besar untuk dikirim', true, 0);
  }
  return null;
}

/* ------------------------------------------------------------ saklar matikan */

function periksaSaklar(cfg) {
  var aktif = String(cfg.aktif || 'YA').toUpperCase();
  if (aktif !== 'YA') {
    var pesan = cfg.pesan_mati || 'Booth foto sedang istirahat. Foto Anda tetap aman di HP.';
    // ulangi:true — foto tetap diantre di HP tamu, bukan dibuang.
    return galat('BOOTH_MATI', pesan, true, 300000);
  }
  return null;
}

/* --------------------------------------------------------------- batas laju */

/**
 * TTL kunci laju sengaja PALING PENDEK di seluruh sistem (90 detik).
 *
 * CacheService dibatasi 1.000 item dan saat terlampaui ia menyimpan 900 item
 * yang paling jauh dari kedaluwarsa. Dengan memberi kunci laju TTL terpendek,
 * mereka selalu menjadi yang PALING DEKAT kedaluwarsa dan karena itu yang
 * pertama dibuang — sehingga kunci idempotensi (TTL 6 jam) tidak pernah
 * tergusur. Satu pilihan TTL inilah yang membuat idempotensi tetap andal pada
 * dua ribu foto.
 */
function naikkanPencacah(cache, kunci, ttl) {
  var n = Number(cache.get(kunci) || 0) + 1;
  cache.put(kunci, String(n), ttl);
  return n;
}

function periksaLajuGlobal(cfg) {
  var cache = CacheService.getScriptCache();
  var batas = angkaPengaturan(cfg, 'maks_per_menit_global', PENGATURAN.MAKS_PER_MENIT_GLOBAL);
  var n = naikkanPencacah(cache, 'gl:' + kunciMenit(), PENGATURAN.TTL_LAJU);
  if (n > batas) {
    return galat('TERLALU_RAMAI', 'Sedang ramai, antre sebentar ya', true, denganJitter(90000));
  }
  return null;
}

function periksaLajuPerangkat(p, cfg) {
  var cache = CacheService.getScriptCache();
  var batas = angkaPengaturan(cfg, 'maks_per_menit_perangkat', PENGATURAN.MAKS_PER_MENIT_PERANGKAT);
  var n = naikkanPencacah(
    cache,
    'rl:' + potong(p.perangkat, 24) + ':' + kunciMenit(),
    PENGATURAN.TTL_LAJU
  );
  if (n > batas) {
    return galat('TERLALU_SERING', 'Terlalu cepat, tunggu sebentar', true, denganJitter(45000));
  }
  return null;
}

/* -------------------------------------------------------------- kuota harian */

/**
 * Disimpan di Properties, BUKAN Cache, justru karena ini batas keras: batas
 * keras yang bisa ter-evict bukan batas keras.
 */
function periksaKuotaHarian(cfg) {
  var batas = angkaPengaturan(cfg, 'maks_harian', PENGATURAN.MAKS_HARIAN);
  var prop = PropertiesService.getScriptProperties();
  var n = Number(prop.getProperty('hitung_' + kunciHari()) || 0);
  if (n >= batas) {
    return galat('KUOTA_HARIAN', 'Kuota harian tercapai', true, 600000);
  }
  return null;
}

function naikkanKuotaHarian() {
  try {
    var prop = PropertiesService.getScriptProperties();
    var k = 'hitung_' + kunciHari();
    prop.setProperty(k, String(Number(prop.getProperty(k) || 0) + 1));
  } catch (e) {
    catat('KUOTA_GAGAL_NAIK', e);
  }
}

/* ------------------------------------------------------------- idempotensi */

/**
 * Tiga lapis, dan yang dilawan bukan "dua tamu bertabrakan".
 *
 * Kejadian yang mendominasi adalah: wifi venue tersendat, batas waktu klien
 * habis, klien mengirim ulang — SEMENTARA eksekusi pertama masih berjalan dan
 * baru akan menulis berkasnya. Skema yang hanya memeriksa "apakah kunci ini
 * sudah selesai?" melewatkan kasus ini sepenuhnya dan justru menghasilkan
 * duplikat yang ingin dicegah.
 *
 * Lapis 1 = penanda SEDANG di cache (menangkap kasus di atas).
 * Lapis 2 = kolom kunci di Sheet (menangkap cache yang ter-evict), HANYA dibayar
 *           oleh percobaan ulang, sehingga percobaan pertama tetap cepat.
 * Lapis 3 = nama berkas memuat id turunan kunci, sehingga folder Drive bisa
 *           dibaca sendiri dan indeks bisa dibangun ulang tanpa basis data.
 *
 * LockService SENGAJA TIDAK dipakai di sini. Lock yang ditahan melintasi decode
 * dan tulis Drive akan menyerialkan SELURUH unggahan: pada ~1,5 detik per tulis,
 * 300 foto menjadi 7,5 menit berurutan sementara eksekusi lain membakar
 * anggarannya sendiri sambil menunggu.
 */
function klaimKunci(kunci) {
  var cache = CacheService.getScriptCache();
  var ada = cache.get('idem:' + kunci);

  if (ada === 'SEDANG') {
    return { status: 'SEDANG' };
  }
  if (ada && ada.indexOf('OK|') === 0) {
    var b = ada.split('|');
    return { status: 'SELESAI', idBerkas: b[1], namaBerkas: b[2] };
  }

  /**
   * TTL 120 detik, bukan 600. Kalau eksekusi ini mati keras, penanda SEDANG
   * menjadi yatim; dengan 600 detik percobaan ulang yang SAH akan ditolak
   * sepuluh menit penuh. 120 detik masih jauh lebih lama dari tulis Drive
   * terburuk (~5 detik), tapi cukup singkat untuk sembuh sendiri.
   */
  cache.put('idem:' + kunci, 'SEDANG', PENGATURAN.TTL_SEDANG);
  return { status: 'BARU' };
}

function selesaikanKunci(kunci, idBerkas, namaBerkas) {
  CacheService.getScriptCache().put(
    'idem:' + kunci,
    'OK|' + idBerkas + '|' + namaBerkas,
    PENGATURAN.TTL_SELESAI
  );
}

function lepaskanKunci(kunci) {
  try {
    CacheService.getScriptCache().remove('idem:' + kunci);
  } catch (e) {
    /* biarkan TTL yang membersihkan */
  }
}

/** Lapis 2: pencarian awet di Sheet. Hanya dipanggil bila klien menandai ulang=1. */
function cariKunciDiSheet(kunci) {
  try {
    var lembar = SpreadsheetApp.openById(PENGATURAN.ID_SPREADSHEET).getSheetByName(
      PENGATURAN.LEMBAR_INDEKS
    );
    var akhir = lembar.getLastRow();
    if (akhir < 2) return null;
    var sel = lembar
      .getRange(2, 2, akhir - 1, 1)
      .createTextFinder(kunci)
      .matchEntireCell(true)
      .matchCase(true)
      .findNext();
    if (!sel) return null;
    var b = lembar.getRange(sel.getRow(), 1, 1, 15).getValues()[0];
    return { idBerkas: b[6], namaBerkas: b[5] };
  } catch (e) {
    catat('CARI_KUNCI_GAGAL', e);
    return null;
  }
}
