# Checklist uji perangkat nyata

Semua yang ada di sini **tidak bisa** dibuktikan oleh `npm test` atau
`npm run smoke`. Chrome headless memakai kamera sintetis, `fetch` di Node tidak
menegakkan CORS, dan tidak ada emulator yang jujur soal share sheet iOS.

Isi kolom **Hasil** dengan apa yang benar-benar terjadi, lalu **sesuaikan teks di
aplikasi dengan kenyataan itu, bukan dengan spesifikasi**. Teks yang menjanjikan
hal yang tidak terjadi lebih buruk daripada tidak ada teks.

Tanggal uji: ______________  Penguji: ______________

---

## A. Android (Chrome)

| # | Langkah | Yang diharapkan | Hasil |
|---|---|---|---|
| A1 | Scan QR dengan kamera bawaan | Terbuka di Chrome, bukan di dalam app kamera | |
| A2 | Isi nama, tekan Mulai | Viewfinder muncul, lampu kamera menyala | |
| A3 | Jepret | Foto tampil dengan bingkai + nama mempelai | |
| A4 | Tekan **Simpan ke galeri HP** | Share sheet muncul; pilih Foto/Google Photos | |
| A5 | Buka app Galeri | Fotonya ada | |
| A6 | Tekan **Pakai kamera HP** → jepret | App kamera bawaan terbuka; **foto asli otomatis masuk galeri** | |
| A7 | Cek Sheet indeks | Ada baris baru dengan nama yang benar | |
| A8 | **Kunci rotasi layar** di portrait, lalu miringkan HP sambil melihat viewfinder | Kotak **tetap penuh** selebar layar dan tidak melompat; gambar tegak di mata | |
| A9 | Jepret dari posisi A8, lalu buka hasilnya di galeri/Drive | Foto **tegak**, watermark tegak, tidak terputar dua kali | |
| A10 | Ulangi A8 dengan auto-rotate **menyala** | Tata letak ikut berputar; viewfinder dan hasilnya tetap benar | |

Kalau A9 meleset, buka booth dengan `?diag=1`: muncul baris berisi gamma, beta,
sudut fisik, sudut layar, ukuran aliran, dan derajat putar yang dipakai. Itu
yang dipakai untuk memutuskan, bukan tebakan. Baris itu hanya muncul bila
flag-nya dipasang, jadi aman ditinggal di produksi.

## B. iPhone (Safari)

| # | Langkah | Yang diharapkan | Hasil |
|---|---|---|---|
| B1 | Scan QR | Terbuka di Safari | |
| B2 | Viewfinder | Tampil **inline**, tidak melompat fullscreen | |
| B3 | Jepret → **Simpan ke galeri HP** | Share sheet memuat **Save Image** | |
| B4 | Buka app Foto | Fotonya ada | |
| B5 | Kalau B3 gagal: tahan foto di layar | Muncul **Add to Photos** dan berhasil | |
| B6 | Pegang HP **miring** lalu jepret lewat Pakai kamera HP | Foto di Drive **tidak** miring/terputar dua kali | |
| B7 | Pilih dari galeri foto HEIC | Terkirim (dikonversi, atau apa adanya dengan pesan jujur) | |
| B8 | Tambahkan ke Home Screen → buka → jepret | Izin kamera **tidak** diminta ulang tiap pindah tab | |

## C. Jaringan buruk — ini inti produknya

| # | Langkah | Yang diharapkan | Hasil |
|---|---|---|---|
| C1 | Mode pesawat, jepret 5 foto | Semua tampil, status **Menunggu kirim**, chip "5 foto menunggu" | |
| C2 | Matikan mode pesawat, tunggu | Semua jadi **Aman di Drive** | |
| C3 | Hitung | Berkas Drive == baris Sheet == **5**, tidak ada duplikat | |
| C4 | Jepret 3 foto, **force-quit browser**, buka lagi | Ketiga foto masih ada, antrean lanjut sendiri | |
| C5 | Batasi hotspot ke 3G lambat, jepret 10 foto | Terkirim satu-satu, tidak ada yang hilang | |
| C6 | Saat ada yang **Belum terkirim**, tekan Coba kirim | Berhasil, dan **tidak** menambah berkas kedua | |

## D. Browser bermasalah

| # | Langkah | Yang diharapkan | Hasil |
|---|---|---|---|
| D1 | Kirim link ke WhatsApp, buka dari chat (Android) | Kartu "buka di Chrome/Safari" muncul; **Pakai kamera HP** tetap bisa dipakai | |
| D2 | Sama, di iPhone | Idem | |
| D3 | Buka dari Instagram DM | Idem | |
| D4 | Tolak izin kamera | Pesan jelas + tombol kamera HP, **bukan** layar hitam | |

## E. Beban (gladi bersih)

| # | Langkah | Yang diharapkan | Hasil |
|---|---|---|---|
| E1 | 3 HP × 20 foto dalam beberapa menit | Semua masuk; tidak ada baris Sheet yang bentrok | |
| E2 | Catat waktu unggah rata-rata per foto | Dipakai menentukan `SISI_MAKS` final di `assets/js/gambar.js` | |
| E3 | Buka `?aksi=status&t=<token>` di HP mempelai | Jumlah foto sesuai | |
| E4 | Set `aktif = TIDAK` di Sheet, jepret | Dalam ≤60 detik tamu melihat pesan istirahat; foto **tetap** aman di HP | |
| E5 | Set `aktif = YA`, tekan Kirim yang tertunda | Antrean terkuras | |

## F. Kartu cetak

| # | Langkah | Yang diharapkan | Hasil |
|---|---|---|---|
| F1 | Cetak `cetak/qr.html` di kertas | QR tajam, quiet zone putih jelas | |
| F2 | Scan dari **1,5 m**, cahaya indoor hangat, 3 HP berbeda | Ter-scan < 2 detik | |
| F3 | Baca teks alamat di kartu | Terbaca dan benar | |
| F4 | Scan kartu `?sesi=akad` | Sheet kolom `sesi` berisi `akad` | |
| F5 | Ctrl+P pada tiap pilihan (2, 4, 8, Poster) | Pratinjau **1 halaman** untuk semuanya; tidak ada kartu yang terbelah | |
| F6 | Cetak Poster, tempel di dinding, scan dari **1,5 m dan 3 m** | Ter-scan < 2 detik di ketiga HP | |
| F7 | **Unduh PNG** tanpa sesi lalu dengan `sesi=akad` | Dua berkas: `...-umum-2009px.png` dan `...-akad-2025px.png`. Ukuran yang berbeda itu benar — `?sesi=` menambah modul | |
| F8 | Tempel PNG ke slide/undangan berlatar **gelap** | Latar QR tetap putih, tidak ada bagian yang menghitam | |
| F9 | Kirim PNG via WhatsApp sebagai **Dokumen**, lalu sekali lagi sebagai **Foto**; scan keduanya dari galeri | Keduanya ter-scan dan membuka alamat yang benar | |

---

## Yang harus dicatat apa pun hasilnya

1. **Waktu unggah median per foto** pada wifi venue: angka ini yang menentukan
   apakah `SISI_MAKS` perlu diturunkan dari 2560 ke 1800.
2. **Apakah "Save Image" benar-benar muncul** di versi iOS tamu — kalau tidak,
   naikkan instruksi tahan-foto menjadi petunjuk utama di layar hasil.
3. **Perilaku in-app browser** per aplikasi: itu berubah antar versi, jadi catat
   versi aplikasinya juga.
