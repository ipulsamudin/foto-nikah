# Backend Apps Script — runbook pemasangan

Backend booth ini satu-satunya bagian yang tidak bisa di-deploy dari repo: ia
hidup di akun Google mempelai. Ikuti urutan di bawah **sekali**, lalu jangan
sentuh lagi kecuali untuk hal-hal yang memang bisa diubah dari Sheet.

Kenapa Apps Script dan bukan service account seperti proyek lain di `htdocs`:
repo ini publik di GitHub Pages, jadi **tidak boleh ada kunci kredensial sama
sekali**. Otorisasi Apps Script menempel pada akun pemilik script, bukan pada
berkas rahasia yang bisa ikut ter-commit.

---

## 0. Periksa sisa penyimpanan Drive — lakukan hari ini, bukan nanti

Akun Google gratis hanya punya **15 GB, dibagi bersama Gmail dan Google Photos.**
Dua ribu foto @3 MB = 6 GB. Kalau akunnya sudah terisi 11 GB oleh email, unggahan
akan gagal di tengah acara — dan ini **bukan batas Apps Script**, justru itu
sebabnya sering terlewat.

1. Buka <https://drive.google.com/settings/storage>.
2. Sisa < 10 GB? Beli Google One 100 GB (sekitar Rp 26.000/bulan, bisa dibatalkan
   Januari). Ini asuransi termurah di seluruh proyek ini.

---

## 1. Folder dan Sheet

1. My Drive → folder baru: **Foto Nikah Syaiful & Sarah**.
2. Di dalamnya: **Foto Tamu** (folder asli) dan **Foto Tamu (UJI)** (untuk latihan).
3. Di dalamnya juga: Google Sheet **Indeks Foto** dan **Indeks Foto (UJI)**.
4. Ambil ID-nya:
   - folder: bagian setelah `/folders/` pada URL;
   - sheet: bagian antara `/d/` dan `/edit`.
5. **Jangan bagikan Sheet-nya.** Isinya nama dan pesan tamu.
6. Folder `Foto Tamu`: bagikan hanya bila ingin tamu bisa melihat album
   (Share → *Anyone with the link* → **Viewer**). Anak folder mewarisi, dan script
   tidak melakukan satu pun operasi izin per berkas. Kalau dibagikan, isi
   `albumUrl` di `config.js`; kalau tidak, tombol album otomatis tidak muncul.

---

## 2. Proyek Apps Script (standalone, bukan terikat Sheet)

Standalone dipilih supaya ID folder/Sheet ditulis eksplisit. Akibatnya kode yang
**sama persis** bisa diarahkan ke folder UJI selama 13 hari latihan, lalu
dialihkan ke yang asli dengan mengganti dua baris. Script yang terikat Sheet juga
akan ikut mati kalau Sheet-nya dihapus.

1. <https://script.google.com> → **New project** → ganti nama: `Backend Foto Booth`.
2. **Project Settings** → centang **Show appsscript.json manifest file**.
3. Tempel isi `appsscript.json` dari folder ini **lebih dulu**, lalu jangan diubah
   lagi (lihat bagian 6).
4. Buat lima berkas script dan tempel isinya:
   `Pengaturan.gs`, `Alat.gs`, `Penjaga.gs`, `Berkas.gs`, `Indeks.gs`, `Code.gs`.
   Hapus isi `Code.gs` bawaan sebelum menempel.
5. Di `Pengaturan.gs`, isi:
   - `ID_FOLDER_FOTO` → ID folder **UJI** dulu;
   - `ID_SPREADSHEET` → ID Sheet **UJI** dulu;
   - `TOKEN_DASAR` → token acak. Buat dengan:
     ```bash
     node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
     ```
   - `JENDELA_MULAI` / `JENDELA_SELESAI` → sudah diisi untuk 6 Desember 2026.

---

## 3. Otorisasi

Hanya **dua** scope yang diminta:

| Scope | Kenapa |
|---|---|
| `auth/drive` | Bukan `drive.file`. `drive.file` hanya memberi akses ke berkas yang dibuat aplikasi itu sendiri, sedangkan `DriveApp.getFolderById()` pada folder yang dibuat tangan oleh pemilik tidak tercakup. |
| `auth/spreadsheets` | `openById` untuk indeks. |

Yang **sengaja tidak ada**: `script.external_request`. Tanpa scope itu script
tidak bisa melakukan permintaan HTTP keluar sama sekali — jadi walaupun seseorang
menguasai isi permintaan, endpoint ini tidak bisa dijadikan perantara serangan ke
tempat lain. Ini batas kemampuan, bukan pemeriksaan yang bisa dilewati.

Layar izin ini **hanya dilihat mempelai**, tidak pernah oleh tamu, karena
deployment berjalan sebagai "Execute as: Me".

1. Pilih fungsi `inisialisasi` → **Run**.
2. Review permissions → pilih akun mempelai → **Advanced** →
   *Go to Backend Foto Booth (unsafe)* → **Allow**.
   (Peringatan "unsafe" itu normal untuk script pribadi yang belum diverifikasi Google.)
3. Pastikan Sheet UJI sekarang punya tiga tab: `Foto`, `Pengaturan`, `Ringkasan`,
   dan `Pengaturan!aktif` berisi `YA`.

---

## 4. Deploy

1. **Deploy → New deployment** → ikon gerigi → **Web app**.
2. Description: `v2026-12-06.1`. Execute as: **Me**. Who has access: **Anyone**.
3. **Deploy**, lalu salin URL yang berakhiran **`/exec`**.

> Jangan pernah memakai URL `/dev`. URL itu hanya bisa diakses akun yang punya
> izin edit script, jadi ia **tidak bisa** menguji jalur tamu anonim sama sekali —
> dan uji yang lulus di `/dev` tidak membuktikan apa pun.

4. Masukkan ke `data/api.json` di repo:
   ```json
   { "dasar": "https://script.google.com/macros/s/AKfycb.../exec", "token": "token-anda" }
   ```

---

## 5. Buktikan dengan alat, bukan dengan perasaan

```bash
node tools/cek-endpoint.mjs
```

Dua belas pemeriksaan, termasuk yang paling penting: **versi yang hidup harus sama
dengan `apps-script/Pengaturan.gs` lokal**, idempotensi (kunci sama → berkas yang
sama, bukan berkas kedua), dan jendela acara benar-benar memuat 6 Desember 2026
jam 09:00 WIB (penangkap salah zona waktu, yang kalau tidak akan baru terlihat
tepat jam sembilan pagi).

Berkas uji dinamai berawalan `ZZ-UJI`. Bersihkan dengan:

```bash
node tools/cek-endpoint.mjs --bersih --admin <token_admin>
```

(`token_admin` diisi di tab `Pengaturan` Sheet, dan **tidak boleh** pernah masuk
`data/api.json`.)

Catatan kejujuran: `fetch` di Node **tidak** menegakkan CORS. Semua uji di atas
bisa hijau sementara jalur browser tetap putus. Lulus di situ membuktikan
backend-nya; hanya HP sungguhan di halaman sungguhan yang membuktikan produknya.

---

## 6. Jebakan deployment — baca sebelum hari-H

| Tindakan | URL `/exec` | Kode yang disajikan |
|---|---|---|
| **Deploy → New deployment** | **BERUBAH** | baru |
| **Manage deployments → (deployment aktif) → Edit → Version: New version** | **tetap** ✅ | baru |
| Hanya menyimpan di editor | tetap | **tidak berubah** |

Bayangkan jam 10:15, unggahan gagal, Anda temukan bugnya, perbaiki, lalu menekan
tombol yang sama seperti pertama kali: **Deploy → New deployment**. Google
menampilkan URL baru dan tanda centang hijau. Dan tidak ada yang berubah —
`data/api.json` masih menunjuk deployment lama yang masih menyajikan kode lama
yang masih rusak. Tidak ada pesan galat, tidak ada peringatan. Anda akan
menghabiskan dua puluh menit membaca ulang kode yang tidak sedang berjalan.

Karena itu: **selalu naikkan `PENGATURAN.VERSI` setiap kali mengubah kode**, dan
jalankan `node tools/cek-endpoint.mjs` yang akan gagal keras bila versi hidup
tidak sama dengan versi lokal.

**Jangan pernah mengubah `appsscript.json` setelah deployment pertama.** Perubahan
`oauthScopes` atau blok `webapp` dilaporkan tidak ikut ke deployment yang sudah
ada, sehingga menuntut deployment baru → URL baru → `data/api.json` berubah →
GitHub Pages dibangun ulang → cache service worker di setiap HP tamu harus
disegarkan. Di hari acara, rantai itu bencana. Kedua scope sudah dideklarasikan
di muka justru supaya ini tidak pernah perlu terjadi.

---

## 7. Yang bisa diubah saat acara berjalan, tanpa deploy

Semuanya di tab **Pengaturan** Sheet, berlaku dalam ≤ 60 detik, bisa diedit dari
aplikasi Sheets di HP:

| Kunci | Fungsi |
|---|---|
| `aktif` | `YA`/`TIDAK` — saklar darurat |
| `pesan_mati` | Pesan yang dilihat tamu saat booth dimatikan |
| `token_aktif`, `token_lama` | Rotasi token. **Dua token berlaku sekaligus** — penting, karena PWA yang sudah terpasang bisa memegang `data/api.json` lama, dan rotasi token tunggal akan mengunci tamu sungguhan |
| `maks_harian` | Batas keras jumlah foto |
| `maks_per_menit_perangkat` | Naikkan bila satu HP dipakai bergiliran serombongan |
| `maks_per_menit_global` | Rem banjir; naikkan bila banyak `TERLALU_RAMAI` |

---

## 8. Memantau saat acara

- **`?aksi=status&t=<token>`** → halaman kecil berisi jumlah foto, status aktif,
  dan 10 nama terakhir. Tambahkan ke layar utama kedua HP mempelai malam
  sebelumnya. Ini instrumen utamanya: mempelai akan sedang berdiri, memegang HP,
  di tengah kerumunan.
- Tab **Ringkasan** di Sheet, bila ada laptop.
- Halaman **Executions** di editor Apps Script, difilter `Failed` — ini pandangan
  pengembang, bukan mempelai.

| Gejala | Artinya | Tindakan |
|---|---|---|
| Jumlah berkas Drive **>** baris Sheet | indeks kehilangan baris | **foto aman.** Jalankan `rekonsiliasi()` setelah acara. Tidak darurat |
| Baris Sheet **>** berkas Drive | mustahil secara konstruksi (Drive ditulis lebih dulu) | ada yang sangat salah, berhenti dan periksa |
| Kolom `catatan` terisi | `tanpa-EOI` / `ulang` | kosmetik, tinjau nanti |
| Tidak ada eksekusi gagal **tapi** tamu mengeluh | plafon 30 eksekusi serentak, atau wifi. Permintaan ke-31 ditolak **sebelum** kode kita jalan, jadi tidak muncul di log mana pun | buka `?aksi=sehat`; kalau sehat, itu jaringan — dan antrean di HP tamu sudah menangani |
| Badge "menunggu terkirim" di HP tamu | detektor paling sensitif yang Anda punya | percayai tamu lebih dulu daripada dasbor |

Urutan tindakan saat acara (dan **jangan deploy apa pun**):

1. Buka `?aksi=sehat`. Menjawab → backend hidup, masalahnya jaringan.
2. `aktif` ternyata `TIDAK`? Balikkan di Sheet.
3. `DRIVE_PENUH`? Beli Google One dari HP atau kosongkan sampah Drive. Foto yang
   mengantre di HP tamu akan menyusul sendiri. **Tidak ada yang hilang.**
4. `KUOTA_HARIAN`? Naikkan `maks_harian`.
5. Banyak `TERLALU_RAMAI`? Naikkan `maks_per_menit_global`.
6. Backend benar-benar rusak? Set `aktif = TIDAK`. Ini terasa berlawanan tapi
   benar: tamu jadi melihat pesan jujur, bukan mengantre ke ruang hampa sambil
   percaya fotonya sudah terkirim. Fotonya tetap ada di HP mereka, dan tombol
   "Kirim yang tertunda" akan menguras antrean setelah acara.

---

## 9. Setelah acara

1. **Biarkan `aktif = YA` sampai 7 Desember pagi.** `JENDELA_SELESAI` (06:00
   tanggal 7) menutup pintu otomatis. Mematikan saklar di tengah resepsi akan
   menolak justru unggahan susulan yang jendela lebarnya memang disiapkan untuk
   itu — satu-satunya kesalahan urutan di runbook ini yang benar-benar
   menghilangkan foto.
2. Setelah jendela tertutup: set `aktif = TIDAK`.
3. Jalankan `rekonsiliasi()` dari editor. Ia menelusuri folder, membaca
   `id_pendek` dari nama berkas, dan menambahkan baris indeks yang hilang. Aman
   dijalankan berulang kali.
4. Unduh: klik kanan folder `Foto Tamu` → Download. **Siapkan waktu satu jam,
   bukan lima menit**: Drive mengemas di sisi server, memecah arsip di sekitar
   2 GB, dan pekerjaan zip bisa gagal pada ~6 GB. Untuk folder sebesar itu,
   **Google Takeout** (pilih Drive → hanya folder ini) atau aplikasi Drive desktop
   jauh lebih andal.
5. Sheet → File → Download → CSV (tab `Foto`).
6. **Verifikasi sebelum menghapus apa pun:** jumlah berkas lokal `ls | wc -l`
   **harus sama dengan** jumlah baris Sheet **dan** `rekonsiliasi().jumlah_drive`.
   Ketiganya. Kalau berbeda, `rekonsiliasi()` memberi tahu baris mana yang hilang.
7. Simpan salinan Drive minimal 90 hari: biayanya nol dan itu satu-satunya salinan
   yang tidak berada di satu hard disk di satu rumah.
8. Tiga hari setelah acara: `maks_harian = 0` dan kosongkan `token_aktif`, sebagai
   kancing terakhir pada endpoint yang URL-nya hidup selamanya di repo publik.

---

## 10. Batas yang sudah diverifikasi (dan satu kesalahpahaman yang mahal)

| Batas | Nilai | Pemakaian terburuk kita |
|---|---|---|
| **Panggilan UrlFetch/hari** | 20.000 | **0** |
| **Eksekusi serentak per pengguna** | **30** | **inilah plafon sebenarnya** |
| Waktu jalan per eksekusi | 6 menit | ~1,5 detik |
| Waktu trigger/hari | 90 menit | **0** (tidak ada trigger) |
| Properties baca-tulis/hari | 50.000 | ~6.000 |
| Item cache | 1.000 | ~2.400 → terlampaui, ditangani lewat desain TTL |
| Blob `createFile` | 50 MB | dibatasi sendiri 8 MB base64 |
| Unggah Drive/hari | 750 GB | ~6 GB |
| Berkas per folder | 500.000 | ~2.000 |

**Kesalahpahaman yang mahal:** kuota 20.000/hari itu menghitung
`UrlFetchApp.fetch` — panggilan **keluar** yang dibuat *oleh* script. Permintaan
masuk ke Web App bukan panggilan UrlFetch, dan script ini tidak melakukan satu
pun panggilan keluar. Jadi pemakaiannya **0 dari 20.000**, dan rencana kapasitas
yang memakai angka itu sebagai plafon unggahan sedang menjawab pertanyaan yang
salah.

Yang benar-benar mengikat adalah **30 eksekusi serentak**. Throughput-nya
≈ 20 unggahan/detik, jadi 2.000 foto hanya ~100 detik backend bekerja penuh —
**bottleneck-nya wifi venue, bukan backend**, dengan selisih dua sampai tiga orde.
Tapi ledakan sesaat nyata: saat akad selesai, seratus HP mengirim dalam beberapa
detik, dan permintaan ke-31 ditolak **sebelum** kode kita berjalan sehingga tidak
muncul di log mana pun. Itulah alasan klien mengirim satu-satu per perangkat,
memakai backoff ber-jitter, dan **menyimpan foto di HP sampai server
mengonfirmasi**. Dengan tiga hal itu, ledakan hanya berbiaya detik, bukan foto.
