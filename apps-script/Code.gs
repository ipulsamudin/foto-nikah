/**
 * Code.gs — pintu masuk Web App.
 *
 * Urutan tahap di tanganiUnggah() ADALAH desainnya, bukan kebetulan. Yang
 * termurah dan paling sering salah diperiksa lebih dulu; yang memakan sumber
 * daya langka (slot eksekusi, tulis Drive) diperiksa paling belakang.
 */

function doPost(e) {
  var t0 = Date.now();
  try {
    return balasJson(tanganiUnggah(e, t0));
  } catch (err) {
    /**
     * Jaring terakhir. Satu pun exception tidak boleh keluar sebagai halaman
     * HTML galat Google, karena klien mengurai JSON dan akan menganggapnya
     * kegagalan jaringan lalu mengulang selamanya.
     */
    catat('GALAT_DALAM_doPost', err);
    return balasJson(galat('GALAT_DALAM', String((err && err.message) || err), true, 5000));
  }
}

function tanganiUnggah(e, t0) {
  var p = (e && e.parameter) || {};
  var cfg = {};
  var g;

  // 1. parameter — termurah; bug klien tidak boleh membakar tulis Drive
  g = periksaParam(p);
  if (g) return g;

  cfg = bacaPengaturanSheet();

  // 2-3. token & jendela — sebelum apa pun yang memakan kuota
  g = periksaToken(p, cfg);
  if (g) return g;
  g = periksaJendela();
  if (g) return g;

  // 4. ukuran — SEBELUM decode; slot eksekusi adalah sumber daya terlangka
  g = periksaUkuran(e);
  if (g) return g;

  // 5. saklar darurat
  g = periksaSaklar(cfg);
  if (g) return g;

  // 6. batas laju — global lebih dulu: saat banjir, buang beban sebelum
  //    mengerjakan pembukuan per perangkat
  g = periksaLajuGlobal(cfg);
  if (g) return g;
  g = periksaLajuPerangkat(p, cfg);
  if (g) return g;

  // 7. kuota harian
  g = periksaKuotaHarian(cfg);
  if (g) return g;

  // 8. gerbang idempotensi — HARUS sebelum decode, supaya percobaan ulang
  //    tertangkap sementara yang pertama masih bekerja
  var klaim = klaimKunci(p.kunci);
  if (klaim.status === 'SEDANG') {
    return galat('SEDANG_DIPROSES', 'Foto ini sedang diproses', true, 6000);
  }
  if (klaim.status === 'SELESAI') {
    return {
      ok: true,
      kode: 'DUPLIKAT',
      duplikat: true,
      idBerkas: klaim.idBerkas,
      namaBerkas: klaim.namaBerkas,
      url: 'https://drive.google.com/file/d/' + klaim.idBerkas + '/view',
      kunci: p.kunci,
      terindeks: true,
      ms: Date.now() - t0
    };
  }

  // Lapis awet: hanya dibayar oleh percobaan ulang, sehingga percobaan pertama
  // tidak pernah menyentuh Sheet untuk keperluan deduplikasi.
  if (p.ulang) {
    var lama = cariKunciDiSheet(p.kunci);
    if (lama && lama.idBerkas) {
      selesaikanKunci(p.kunci, lama.idBerkas, lama.namaBerkas);
      return {
        ok: true,
        kode: 'DUPLIKAT',
        duplikat: true,
        idBerkas: lama.idBerkas,
        namaBerkas: lama.namaBerkas,
        url: 'https://drive.google.com/file/d/' + lama.idBerkas + '/view',
        kunci: p.kunci,
        terindeks: true,
        ms: Date.now() - t0
      };
    }
  }

  try {
    // 9. decode
    var bytes;
    try {
      bytes = ambilBase64(e);
    } catch (err) {
      lepaskanKunci(p.kunci);
      return galat('BASE64_RUSAK', 'Data foto tidak bisa dibaca', true, 2000);
    }

    // 10. sniff — jangan pernah menulis byte non-JPEG ke Drive mempelai
    var periksa = periksaJpeg(bytes);
    if (!periksa.ok) {
      lepaskanKunci(p.kunci);
      return galat(periksa.kode, 'Berkas bukan foto JPEG', false, 0);
    }

    // 11. tulis Drive — langkah yang tidak tergantikan
    var namaBerkas = buatNamaBerkas(p.nama, p.kunci);
    var berkas = simpanKeDrive(bytes, namaBerkas);

    // 12. tandai selesai SEGERA setelah tulis Drive, sebelum Sheet. Kalau
    //     eksekusi mati di sini, percobaan ulang tetap aman.
    selesaikanKunci(p.kunci, berkas.id, berkas.nama);

    // 13. indeks — boleh gagal, TIDAK pernah menggagalkan unggahan
    var terindeks = tambahBarisIndeks([
      sekarangJakarta(),
      p.kunci,
      idPendek(p.kunci),
      potong(p.nama || 'Tamu', 100),
      bersihkanNama(p.nama),
      berkas.nama,
      berkas.id,
      berkas.url,
      bytes.length,
      potong(p.perangkat, 24),
      potong(p.sesi, 24),
      potong(p.pesan, 140),
      potong(p.w_klien, 40),
      periksa.catatan + (p.ulang ? (periksa.catatan ? ';' : '') + 'ulang' : ''),
      PENGATURAN.VERSI
    ]);

    // 14. hitung hanya yang berhasil
    naikkanKuotaHarian();

    return {
      ok: true,
      kode: 'TERSIMPAN',
      duplikat: false,
      idBerkas: berkas.id,
      namaBerkas: berkas.nama,
      url: berkas.url,
      kunci: p.kunci,
      terindeks: terindeks,
      ukuran: bytes.length,
      waktu: sekarangJakarta(),
      ms: Date.now() - t0
    };
  } catch (err) {
    lepaskanKunci(p.kunci);
    var pesan = String((err && err.message) || err);
    if (/storage|quota|space|penuh/i.test(pesan)) {
      catat('DRIVE_PENUH', err);
      return galat('DRIVE_PENUH', 'Penyimpanan Drive penuh', true, 120000);
    }
    catat('GALAT_SIMPAN', err);
    return galat('GALAT_DALAM', pesan, true, 5000);
  }
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    switch (p.aksi) {
      case 'terbaru':
        return modeTerbaru(p);
      case 'konfigurasi':
        return modeKonfigurasi(p);
      case 'status':
        return modeStatus(p);
      case 'hapus_uji':
        return modeHapusUji(p);
      case 'sehat':
      default:
        return modeSehat();
    }
  } catch (err) {
    catat('GALAT_DALAM_doGet', err);
    return balasJson(galat('GALAT_DALAM', String(err), false, 0));
  }
}

/**
 * Cek kesehatan — SENGAJA tanpa token.
 *
 * Supaya klien bisa membedakan "backend mati" dari "token salah", dan supaya
 * tools/cek-endpoint.mjs bisa membandingkan `versi` di sini dengan berkas lokal.
 * Tidak pernah membocorkan token apa pun: orang asing yang menemukan URL ini
 * tidak mendapat informasi sensitif.
 */
function modeSehat() {
  var cfg = bacaPengaturanSheet();
  var kini = Date.now();
  var mulai = new Date(PENGATURAN.JENDELA_MULAI).getTime();
  var selesai = new Date(PENGATURAN.JENDELA_SELESAI).getTime();
  var prop = PropertiesService.getScriptProperties();
  var dipakai = Number(prop.getProperty('hitung_' + kunciHari()) || 0);
  var batas = angkaPengaturan(cfg, 'maks_harian', PENGATURAN.MAKS_HARIAN);

  return balasJson({
    ok: true,
    aktif: String(cfg.aktif || 'YA').toUpperCase() === 'YA',
    zona: PENGATURAN.ZONA_WAKTU,
    waktu_server: sekarangJakarta(),
    jendela: {
      mulai: PENGATURAN.JENDELA_MULAI,
      selesai: PENGATURAN.JENDELA_SELESAI,
      di_dalam: kini >= mulai && kini <= selesai
    },
    terpakai_hari_ini: dipakai,
    sisa_kuota: Math.max(batas - dipakai, 0)
  });
}

function modeTerbaru(p) {
  var cfg = bacaPengaturanSheet();
  var g = periksaToken(p, cfg);
  if (g) return balasJson(g);
  return balasJson({ ok: true, foto: ambilTerbaru(p.n) });
}

/**
 * Membuktikan dari HP, dalam sepuluh detik, bahwa build yang hidup menunjuk ke
 * folder yang benar. Mematikan seluruh kelas kegagalan "saya menyunting salinan
 * yang salah" / "foto masuk folder uji".
 */
function modeKonfigurasi(p) {
  var cfg = bacaPengaturanSheet();
  var g = periksaToken(p, cfg);
  if (g) return balasJson(g);
  var idSheet = String(PENGATURAN.ID_SPREADSHEET);
  return balasJson({
    ok: true,
    id_folder: PENGATURAN.ID_FOLDER_FOTO,
    sheet_akhiran: idSheet.slice(Math.max(idSheet.length - 6, 0)),
    jendela_mulai: PENGATURAN.JENDELA_MULAI,
    jendela_selesai: PENGATURAN.JENDELA_SELESAI,
    aktif: String(cfg.aktif || 'YA'),
    maks_harian: angkaPengaturan(cfg, 'maks_harian', PENGATURAN.MAKS_HARIAN),
    maks_base64: PENGATURAN.MAKS_BASE64
  });
}

/** Halaman mungil untuk HP mempelai saat acara. */
function modeStatus(p) {
  var cfg = bacaPengaturanSheet();
  if (periksaToken(p, cfg)) {
    return HtmlService.createHtmlOutput('<p style="font:16px sans-serif">Token salah.</p>');
  }
  var prop = PropertiesService.getScriptProperties();
  var dipakai = Number(prop.getProperty('hitung_' + kunciHari()) || 0);
  var aktif = String(cfg.aktif || 'YA').toUpperCase() === 'YA';
  var terbaru = ambilTerbaru(10);

  var baris = '';
  for (var i = 0; i < terbaru.length; i++) {
    baris +=
      '<li><b>' + terbaru[i].nama + '</b><br><small>' + terbaru[i].waktu + '</small></li>';
  }

  var html =
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font:16px/1.5 -apple-system,system-ui,sans-serif;padding:16px;max-width:520px">' +
    '<div style="background:' +
    (aktif ? '#166534' : '#991b1b') +
    ';color:#fff;padding:12px;border-radius:12px;text-align:center;font-weight:700">' +
    (aktif ? 'BOOTH AKTIF' : 'BOOTH MATI') +
    '</div>' +
    '<p style="font-size:44px;font-weight:700;margin:16px 0 0">' +
    dipakai +
    '</p><p style="margin:0;color:#555">foto hari ini</p>' +
    '<p style="color:#555">Waktu server: ' +
    sekarangJakarta() +
    '<br>Versi: ' +
    PENGATURAN.VERSI +
    '</p><h3>10 terakhir</h3><ul>' +
    (baris || '<li>Belum ada foto.</li>') +
    '</ul></div>';
  return HtmlService.createHtmlOutput(html);
}

/**
 * Pembersih berkas uji. Dijaga token_admin yang HANYA ada di Sheet dan di shell
 * pengembang — jangan pernah di data/api.json.
 *
 * Radius ledakannya dibatasi tiga lapis: hanya nama yang memuat ZZ-UJI, maksimum
 * 50 berkas, dan setTrashed (bisa dipulihkan 30 hari), bukan hapus permanen.
 * Batasnya harus datang dari kode, bukan dari kerahasiaan token.
 */
function modeHapusUji(p) {
  var cfg = bacaPengaturanSheet();
  if (!cfg.token_admin || String(p.admin) !== String(cfg.token_admin)) {
    return balasJson(galat('TOKEN_SALAH', 'Butuh token_admin', false, 0));
  }
  var folder = DriveApp.getFolderById(PENGATURAN.ID_FOLDER_FOTO);
  var iter = folder.getFiles();
  var dibuang = 0;
  while (iter.hasNext() && dibuang < 50) {
    var f = iter.next();
    if (f.getName().indexOf('ZZ-UJI') >= 0) {
      f.setTrashed(true);
      dibuang++;
    }
  }
  return balasJson({ ok: true, dibuang: dibuang });
}
