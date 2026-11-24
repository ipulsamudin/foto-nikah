/**
 * Berkas.gs — dari base64 mentah menjadi berkas di Drive.
 */

/**
 * Ambil base64 dari badan permintaan, defensif terhadap tiga hal yang sering
 * salah di sisi klien. Semuanya pernah benar-benar terjadi, jadi ditangani di
 * server dan bukan hanya diperingatkan di dokumen.
 */
function ambilBase64(e) {
  var mentah = (e.postData && e.postData.contents) || '';

  // 1. canvas.toDataURL() memberi prefix "data:image/jpeg;base64,". Klien bisa
  //    lupa memotongnya; memotong di sini lebih baik daripada menolak foto.
  mentah = mentah.replace(/^data:[^,]*,/, '');

  // 2. Badan berupa JSON (klien lain, atau uji manual) — ambil field-nya.
  if (mentah.charAt(0) === '{') {
    try {
      var j = JSON.parse(mentah);
      mentah = j.b64 || j.data || '';
    } catch (x) {
      /* biarkan apa adanya; decode di bawah yang akan menolak */
    }
  }

  // 3. `base64` tanpa -w0 menyisipkan baris baru setiap 76 karakter dan
  //    base64Decode tersedak. Ini persis yang terjadi pada uji curl.
  mentah = mentah.replace(/\s+/g, '');

  if (/[-_]/.test(mentah) && !/[+/]/.test(mentah)) {
    return Utilities.base64DecodeWebSafe(mentah);
  }
  return Utilities.base64Decode(mentah);
}

/**
 * Nama tamu → potongan aman untuk nama berkas.
 *
 * Harus menghasilkan hasil yang sama dengan slugNama() di assets/js/fmt.js —
 * kalau berbeda, nama berkas yang diprediksi klien tidak akan cocok dengan yang
 * dibuat server, dan rekonsiliasi lewat nama berkas jadi mustahil.
 */
function bersihkanNama(mentah) {
  var s = String(mentah == null ? '' : mentah).trim();
  if (!s) return 'Tamu';
  s = s.replace(/\s+/g, ' ');

  try {
    s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); // José -> Jose
  } catch (e) {
    /* runtime tanpa normalize: lanjut */
  }

  // Apostrof DIBUANG, bukan diganti tanda hubung: nama Indonesia penuh apostrof
  // (Ma'ruf, Nur'aini, Sa'adah). "Ma-ruf" terbaca aneh, "Maruf" terbaca benar.
  // Termasuk apostrof melengkung yang disisipkan papan tombol HP otomatis.
  s = s.replace(/['’ʼ՚]/g, '');

  // Daftar-putih lalu kerutkan. Urutan ini yang membuat kita tidak perlu regex
  // emoji: satu emoji adalah pasangan surrogate (2 unit kode) dan emoji keluarga
  // bisa 7+ unit dengan ZWJ, sehingga substitusi per unit menghasilkan banyak
  // tanda hubung — yang langsung dikerutkan menjadi satu di langkah berikutnya.
  s = s
    .replace(/[^A-Za-z0-9]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!s) return 'Tamu';

  if (s.length > PENGATURAN.PANJANG_NAMA) {
    s = s.slice(0, PENGATURAN.PANJANG_NAMA);
    var batas = s.lastIndexOf('-');
    if (batas > 12) s = s.slice(0, batas);
    s = s.replace(/-+$/, '');
  }
  return s || 'Tamu';
}

/**
 * Potongan id di nama berkas SENGAJA diturunkan dari kunci idempotensi, bukan
 * acak: itu yang membuat setiap berkas Drive bisa dilacak ke baris Sheet dan ke
 * catatan antrean di HP tamu tanpa pencarian, dan yang membuat rekonsiliasi()
 * mungkin ketika baris Sheet-nya hilang.
 */
function idPendek(kunci) {
  var s = String(kunci || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return s || '00000000';
}

function buatNamaBerkas(nama, kunci) {
  return capWaktuBerkas() + '_' + bersihkanNama(nama) + '_' + idPendek(kunci) + '.jpg';
}

/**
 * Periksa byte ajaib JPEG.
 *
 * Asimetrinya sengaja: ketiadaan SOI (FF D8 FF) ditolak keras, tapi ketiadaan
 * penanda akhir (FF D9) hanya DICATAT sebagai peringatan. Pemeriksaan EOI yang
 * ketat akan diam-diam membuang foto tamu sungguhan yang terpotong karena
 * toBlob dibatalkan di HP lambat — dan kehilangan foto tidak bisa diterima,
 * sementara satu berkas dengan ekor aneh bisa.
 */
function periksaJpeg(bytes) {
  if (!bytes || bytes.length < PENGATURAN.MIN_BYTE) {
    return { ok: false, keras: true, kode: 'TERLALU_KECIL', catatan: '' };
  }
  var soi = bytes[0] === -1 && bytes[1] === -40 && bytes[2] === -1; // 0xFF 0xD8 0xFF sebagai byte bertanda
  var soiTakBertanda = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!soi && !soiTakBertanda) {
    return { ok: false, keras: true, kode: 'BUKAN_JPEG', catatan: '' };
  }
  var n = bytes.length;
  var akhir =
    (bytes[n - 2] === -1 && bytes[n - 1] === -39) ||
    (bytes[n - 2] === 0xff && bytes[n - 1] === 0xd9);
  return { ok: true, keras: false, kode: '', catatan: akhir ? '' : 'tanpa-EOI' };
}

/**
 * Tulis ke Drive. INILAH langkah yang tidak tergantikan — semua yang sesudahnya
 * boleh gagal tanpa kehilangan foto.
 *
 * Tidak ada operasi pembagian akses per berkas: folder induknya dibagikan sekali
 * secara manual dan anaknya mewarisi. Dua ribu panggilan setSharing() hanya
 * menambah latensi di jalur panas, untuk manfaat yang sudah diberikan folder,
 * pada satu hari yang tidak boleh gagal.
 */
function simpanKeDrive(bytes, namaBerkas) {
  var blob = Utilities.newBlob(bytes, 'image/jpeg', namaBerkas);
  var folder = DriveApp.getFolderById(PENGATURAN.ID_FOLDER_FOTO);
  var berkas = folder.createFile(blob);
  return {
    id: berkas.getId(),
    nama: berkas.getName(),
    // URL dirakit sebagai string, bukan dibaca ulang dari Drive: satu panggilan
    // API lebih sedikit, dan formatnya stabil.
    url: 'https://drive.google.com/file/d/' + berkas.getId() + '/view'
  };
}
