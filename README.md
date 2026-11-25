# Foto Nikah

Photo booth pernikahan tanpa aplikasi. Tamu **scan satu QR di meja** → kamera
terbuka → sekali jepret, fotonya **tersimpan ke galeri HP tamu** dan **terkirim
ke Google Drive mempelai**.

Foto pernikahan yang paling banyak justru ada di HP tamu, dan hampir semuanya
tidak pernah sampai ke mempelai. Grup WhatsApp penuh foto terkompres, dan yang
asli hilang bersama HP yang penuh. Aplikasi ini mengisi kekosongan itu.

- **Sinyal jelek bukan masalah.** Foto disimpan di HP lebih dulu, lalu dikirim
  sendiri saat sinyal memungkinkan — termasuk setelah tamu pulang.
- **Tamu tidak perlu login, tidak perlu install.** Buka link, tulis nama, jepret.
- **Tanpa proses build.** HTML + CSS + JavaScript biasa. Push ke GitHub, situsnya
  langsung hidup.
- **Nol kredensial di repo.** Backend-nya Google Apps Script milik mempelai.

---

## Daftar isi

1. [Cara kerjanya](#cara-kerjanya)
2. [Coba cepat di komputer](#coba-cepat-di-komputer)
3. [Pasang backend Drive](#pasang-backend-drive)
4. [Deploy ke GitHub Pages](#deploy-ke-github-pages)
5. [Cetak kartu QR](#cetak-kartu-qr)
6. [Pengembangan dan pengujian](#pengembangan-dan-pengujian)
7. [Struktur proyek](#struktur-proyek)
8. [Batasan yang perlu diketahui](#batasan-yang-perlu-diketahui)

---

## Cara kerjanya

```
Tamu scan QR di meja
   │  https://<akun>.github.io/foto-nikah/?sesi=akad
   ▼
GitHub Pages (statis, https)  ── PWA, bisa jalan tanpa internet
   │
   ├─(1)─► Galeri/album HP si pemfoto
   │         navigator.share({files}) → "Save Image"
   │         atau unduhan, atau tahan foto → Add to Photos
   │
   ├─(2)─► IndexedDB: foto penuh + thumbnail + status
   │         tertunda → mengirim → terkirim
   │         halaman "Foto Saya" dibaca dari sini (instan, offline)
   │
   └─(3)─► POST base64 (text/plain, tanpa preflight CORS)
             ▼
        Apps Script Web App milik mempelai
             ├─► folder Google Drive
             └─► Google Sheet sebagai indeks (1 baris per foto)
```

Tiga keputusan yang membentuk seluruh aplikasi, dan alasannya:

| Keputusan | Alasan |
|---|---|
| Foto ditulis ke IndexedDB **sebelum** dikirim | Wifi venue akan padat dan tamu akan menutup tab. Tidak ada jalur kode yang menampilkan "berhasil" sebelum byte-nya benar-benar ada di perangkat. |
| Setiap unggahan membawa **kunci idempotensi** | Kejadian paling sering bukan dua tamu bertabrakan, tapi: batas waktu klien habis lalu mengirim ulang padahal yang pertama sedang menulis ke Drive. Tanpa kunci ini, satu foto jadi dua berkas. |
| Jepret, beranda, dan hasil berada di **satu rute** | Di PWA standalone iOS, izin kamera dicabut setiap kali hash URL berubah. Kalau menjepret melewati perubahan hash, tamu ditanya izin berulang-ulang dan booth terasa rusak. |

---

## Coba cepat di komputer

Aplikasi memakai ES module, jadi **tidak bisa** dibuka lewat `file://` — harus
lewat http.

```bash
# server bawaan proyek, sekaligus tiruan backend (butuh Node 18+)
node tools/serve.mjs 8765 --stub
# buka http://localhost:8765/

# atau lewat XAMPP: taruh folder ini di htdocs, buka
# http://localhost/foto-nikah/
```

`--stub` membuat `/data/api.json` dijawab dengan backend tiruan di server yang
sama, jadi seluruh alur (antrean, retry, idempotensi, status di "Foto Saya") bisa
dicoba **tanpa menyentuh Google**. Berkas yang di-commit tetap `"dasar": null`.

**Menguji dari HP** butuh https, karena kamera dalam halaman hanya jalan di
konteks aman. `http://192.168.x.x:8765` tidak akan bisa membuka kamera. Pakai
salah satu:

```bash
cloudflared tunnel --url http://localhost:8765     # https instan
# atau uji langsung di URL GitHub Pages yang sudah https
```

Tanpa https pun, tombol **Pakai kamera HP** tetap berfungsi: `<input capture>`
tidak butuh konteks aman.

---

## Pasang backend Drive

Langkah lengkapnya ada di **[apps-script/README.md](apps-script/README.md)** —
termasuk daftar scope, jebakan deployment yang bisa mematikan booth secara
senyap, dan runbook hari-H.

Ringkasnya: buat folder Drive + Sheet, buat proyek Apps Script standalone, tempel
enam berkas `.gs`, deploy sebagai Web App (**Execute as: Me**, **Anyone, even
anonymous**), lalu isi URL `/exec` dan token ke `data/api.json`:

```json
{ "dasar": "https://script.google.com/macros/s/AKfycb.../exec", "token": "..." }
```

Lalu buktikan dengan alat, bukan dengan perasaan:

```bash
node tools/cek-endpoint.mjs
```

**Sebelum backend ada pun aplikasi tetap berguna**: `"dasar": null` membuat booth
tetap bisa menjepret dan menyimpan ke galeri HP; hanya pengiriman yang ditahan,
dan fotonya tetap aman di antrean.

---

## Deploy ke GitHub Pages

1. Buat repo (mis. `foto-nikah`), push isi folder ini ke branch `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Push berikutnya menjalankan [.github/workflows/pages.yml](.github/workflows/pages.yml):
   job `uji` (self-test, cek impor, uji asap browser) lalu `deploy`. Tidak ada
   proses build — seluruh isi repo adalah situsnya.

**Pertimbangkan domain sendiri sebelum kartu QR dicetak.** Begitu kartunya
tersebar di meja, URL-nya beku. `foto.domain-anda` sebagai custom domain Pages
membuat alamat itu bisa dialihkan ke mana saja kalau Pages bermasalah pada hari
acara — tanpa mencetak ulang kartu.

---

## Cetak kartu QR

Buka **[cetak/qr.html](cetak/qr.html)** (lewat http, bukan `file://`), pilih
bentuk keluaran dan label sesi, lalu tekan Cetak atau Unduh PNG.

Tiga bentuk keluaran dari halaman yang sama:

| Pilihan | Untuk apa | Ukuran QR |
|---|---|---|
| 2 / 4 / 8 kartu per lembar | kartu A4 untuk digunting — standee meja sampai tiap kursi | 45 / 36 / 32 mm |
| **Poster** | satu QR besar memenuhi A4 — X-banner atau papan di pintu masuk | 170 mm |
| **Unduh PNG** | QR-nya saja, sekitar 2000 px — percetakan, undangan digital, WhatsApp, Instagram | bebas |

### Berkas A4 tanpa membuka browser

```bash
npm run cetak                      # poster, tanpa label sesi
node tools/cetak-pdf.mjs 8 meja-01 # lembar 8 kartu, sesi "meja-01"
node tools/cetak-pdf.mjs semua     # poster + 2 + 4 + 8 sekaligus
```

Menghasilkan `qr-a4-<pilihan>-<sesi>.pdf` di akar proyek (diabaikan git — berkas
hasil, bukan sumber). Tool ini mencetak **halaman yang sama** lewat Chrome
headless, bukan perender PDF kedua yang bisa menyimpang dari yang terlihat di
layar, dan ia **gagal** kalau PDF-nya bukan tepat satu halaman 210 × 297 mm.

Setiap lembar dijamin **satu halaman**: `#lembar` adalah kotak A4 dengan tinggi
tetap dan `grid-auto-rows: 1fr`, bukan `min-height`. Sebelumnya lembar tumbuh
mengikuti isi sampai 339 mm (2 kartu) dan 358 mm (4 kartu), jadi kartu paling
bawah terbelah dan satu halaman tambahan ikut keluar dari printer tiap lembar.
`tools/smoke.mjs` menjaga keduanya: lembar tidak melebihi A4, dan isi kartu tidak
meluber melewati garis potong.

- **Untuk banner besar, pilih Poster lalu Cetak → Simpan sebagai PDF**, jangan
  PNG: QR di dalam PDF masih vektor, jadi percetakan bisa membesarkannya ke A1
  atau A0 tanpa kehilangan ketajaman sama sekali.
- PNG dinamai `qr-foto-nikah-<sesi>-<ukuran>px.png` (sesi kosong jadi `umum`).
  Sesi ikut ke nama berkas karena dua standee yang diunduh berurutan akan menjadi
  `qr.png` dan `qr (1).png`, dan sesudah itu tidak ada lagi cara membedakannya
  tanpa memindai ulang. Ukurannya berubah mengikuti panjang alamat — itu normal:
  menambahkan `?sesi=` mendorong QR dari versi 4 ke versi 5.
- **Kirim PNG via WhatsApp sebagai Dokumen, bukan Foto**, supaya tidak
  direkompresi.
- QR dirender dari pustaka yang di-pin di `vendor/`, bukan dari layanan QR
  online: kartu ini mungkin dicetak dari laptop di venue tanpa internet.
  Unduh PNG juga bekerja offline — kanvas tidak butuh jaringan.
- Koreksi galat **Q**, quiet zone 4 modul — standee kertas kena jari, tumpahan,
  dan cahaya remang.
- Label sesi (`akad`, `resepsi`, `meja-01`) ikut masuk ke tautan, jadi foto dari
  standee berbeda bisa dipilah di Sheet.
- Alamatnya juga dicetak sebagai teks, untuk tamu yang kameranya enggan memindai.
- Isi `bantuanWa` di `config.js` supaya nomor bantuan ikut tercetak. Itu asuransi
  yang tetap bekerja ketika GitHub Pages, Apps Script, dan wifi venue sama-sama
  bermasalah.

**Uji scan kartu yang sudah tercetak dari jarak 1,5 meter dengan tiga HP berbeda
sebelum memesan banyak.** Untuk PNG, uji juga sesudah dikirim via WhatsApp —
sekali sebagai Dokumen dan sekali sebagai Foto — supaya terbukti masternya
selamat melewati rekompresi, bukan hanya terbaca di layar laptop.

`tools/selftest.mjs` menjaga bagian yang tidak bisa diperbaiki setelah tercetak:
prioritas alamat QR (`?url=` → `qrUrl` → halaman ini), geometri PNG (setiap modul
wajib jatuh di piksel bulat), nama berkas, dan orientasi matriks pustaka vendor.
`tools/smoke.mjs` membandingkan kanvas PNG modul-per-modul dengan matriksnya
sendiri di browser sungguhan — itu yang membuktikan PNG-nya tidak tercermin.

---

## Pengembangan dan pengujian

```bash
npm test        # selftest.mjs (160 pemeriksaan) + cek-impor.mjs
npm run smoke   # 50 pemeriksaan di Chrome/Edge headless, kamera palsu
npm run cek     # cek-endpoint.mjs terhadap backend yang ter-deploy
npm run icons   # regenerasi ikon PWA dari geometri di tools/make-icons.mjs
```

| Alat | Yang dibuktikan |
|---|---|
| `tools/selftest.mjs` | Fungsi murni: sanitasi nama (apostrof, emoji, 400 masukan acak), nama berkas, matematika backoff + jitter, pembacaan EXIF big/little endian, pemilihan baris antrean, keutuhan pustaka QR di `vendor/`, serta alamat, geometri PNG, dan nama berkas halaman cetak. |
| `tools/cek-impor.mjs` | Tanpa bundler tidak ada yang memvalidasi jalur import. Memeriksa setiap import & ekspor, kelengkapan daftar precache `sw.js`, rujukan HTML, kontrak view, kemurnian modul, larangan CDN, dan larangan hotlink thumbnail Drive. |
| `tools/smoke.mjs` | Di browser sungguhan: kamera palsu → JPEG, watermark benar-benar terbakar ke gambar (dibandingkan per piksel), base64 byte-identik, antrean terkuras sampai `terkirim`, kirim ulang kunci yang sama **tidak** membuat berkas kedua, seluruh daftar precache benar-benar masuk cache, dan endpoint backend **tidak** ikut ter-cache. |
| `tools/cek-endpoint.mjs` | Terhadap backend nyata: versi hidup == versi lokal, jendela acara memuat 6 Des 2026 09:00 WIB, idempotensi dua lapis, token salah ditolak, bukan-JPEG ditolak. |

`tools/smoke.mjs` memakai CDP lewat WebSocket bawaan Node, bukan `--dump-dom`:
waktu virtual Chrome tidak menggerakkan antrean tugas IndexedDB, sehingga
`--dump-dom` selalu membaca halaman kosong dan hanya membuktikan bahwa HTML
terkirim. Yang perlu dibuktikan justru yang sesudah itu.

**Yang tidak bisa diklaim oleh alat apa pun di sini** — dan karena itu ada
[docs/uji-perangkat.md](docs/uji-perangkat.md): perilaku `navigator.share` di
iOS, apakah Safari menerapkan orientasi EXIF sendiri, CORS Apps Script yang
sebenarnya (`fetch` di Node tidak menegakkan CORS), dan arah sensor gerak di HP
sungguhan.

Untuk yang terakhir, buka booth dengan **`?diag=1`**: muncul satu baris kecil di
bawah viewfinder berisi gamma, beta, sudut fisik, sudut layar, ukuran aliran
kamera, dan derajat putar yang akan dipakai saat menjepret. Baris itu hanya
muncul bila flag-nya dipasang, jadi aman ditinggal di produksi. Perlu diingat
satu aturan yang mudah dilanggar ulang: **pratinjau tidak pernah diputar**.
Kamera menempel kaku pada layar, jadi frame mentah selalu tegak di mata tamu;
yang diputar hanya berkas yang disimpan, supaya tegak saat dibuka nanti.

---

## Struktur proyek

```
foto-nikah/
├─ index.html  config.js  sw.js  manifest.webmanifest
├─ data/api.json           satu-satunya sumber URL backend; null = mode terdegradasi
├─ assets/
│  ├─ css/app.css          palet Pink Floral Watercolor dari undangan
│  ├─ icons/               ikon PWA (dibuat tools/make-icons.mjs)
│  └─ js/
│     ├─ app.js  router.js  ui.js  fmt.js
│     ├─ tamu.js            identitas tamu + ?to= / ?sesi=
│     ├─ kamera.js          getUserMedia + penerjemah galat
│     ├─ berkas-kamera.js   jalur <input capture> dan galeri
│     ├─ gambar.js          crop/skala/tangga mutu/thumbnail/base64
│     ├─ exif.js            pembacaan orientasi (murni, teruji)
│     ├─ orientasi.js       posisi FISIK HP dari sensor; memutar BERKAS, bukan pratinjau
│     ├─ bingkai.js         watermark Canvas 2D
│     ├─ antrean.js         IndexedDB + mesin status
│     ├─ unggah.js          pengirim: backoff, pemicu online/visible
│     ├─ indeks.js          satu-satunya pintu ke backend
│     ├─ simpan-galeri.js   tiga jalur simpan ke galeri HP
│     └─ views/             beranda (+jepret +hasil), saya, info
├─ cetak/qr.html            kartu QR, poster, unduh PNG (qr-inti.js = logika murni)
├─ vendor/                  pustaka pihak ketiga di-pin, tanpa CDN
├─ apps-script/             backend + runbook pemasangan
├─ docs/uji-perangkat.md    checklist uji manual di HP nyata
└─ tools/                   serve, selftest, cek-impor, smoke, cek-endpoint, make-icons
```

---

## Batasan yang perlu diketahui

- **Endpoint-nya publik.** URL dan token ada di repo publik dan di browser tamu;
  siapa pun yang membacanya bisa mengirim POST. Yang menjaga bukan token itu,
  melainkan jendela tanggal acara, batas laju, batas harian, dan saklar darurat
  di Sheet. Lihat tabel jujur di
  [apps-script/README.md](apps-script/README.md#8-memantau-saat-acara).
- **iOS tidak punya API "tulis ke galeri".** Jalur terbaiknya share sheet →
  *Save Image*, tapi itu tidak dijamin: pada sebagian iOS target share mengambil
  tautan alih-alih berkas. Karena itu foto selalu ditampilkan utuh di layar
  dengan instruksi **tahan foto → Add to Photos**, yang selalu bekerja.
- **Simpan otomatis ke galeri hanya sejauh yang diizinkan browser.** Di Android
  dan desktop, foto langsung terunduh begitu jepretan jadi — tanpa tamu menekan
  apa pun. Tapi unduhan mendarat di folder **Download**: app Galeri dan Files
  menampilkannya, sedangkan **Google Photos sering tidak mengindeks folder itu**,
  jadi fotonya bisa saja tidak muncul di sana. Chrome juga dapat bertanya sekali
  "izinkan situs ini mengunduh banyak berkas". Matikan lewat `simpanOtomatis` di
  `config.js` bila mengganggu.
- **Satu-satunya jalur yang pasti masuk DCIM** (dan karena itu pasti terlihat di
  Google Photos) adalah tombol **Pakai kamera HP**: app kamera bawaan Android
  menyimpan foto aslinya sendiri, kualitas penuh. Tombol itu selalu ada di layar.
  Foto dari jalur ini sengaja tidak diunduh ulang supaya tidak menjadi dua salinan.
- **"Foto Saya" bukan arsip jangka panjang.** Isinya ada di penyimpanan browser
  perangkat itu. Membersihkan data situs akan menghapusnya, dan iOS membuang
  penyimpanan situs yang tidak dibuka berminggu-minggu. Salinan yang awet ada di
  Drive mempelai dan di galeri HP tamu.
- **Kamera dalam halaman butuh https** dan sering diblokir di dalam browser
  aplikasi chat (WhatsApp/Instagram). Jalur `<input capture>` selalu ditampilkan,
  bukan hanya muncul setelah gagal.
- **Google Drive gratis 15 GB dibagi dengan Gmail dan Google Photos.** Dua ribu
  foto bisa 6 GB. Periksa sisa penyimpanan jauh sebelum hari acara.
- **Portrait dan landscape dua-duanya didukung, dan pratinjaunya jujur.** Kotak
  viewfinder mengambil bentuknya dari rasio aliran kamera yang sebenarnya, lalu
  mengikutinya lagi setiap kali HP diputar (lewat event `resize` milik
  `<video>`). Jadi apa yang dibingkai tamu di layar adalah apa yang tersimpan —
  bukan sekadar mirip. Jepretan tidak pernah dipotong; yang disimpan adalah
  seluruh frame kamera.
- Foto diunggah pada sisi panjang maks 2560 px, JPEG mutu 0,85 (sekitar
  600 KB–1,2 MB): cukup untuk cetak 4R, bukan berkas asli kamera. Angkanya ada di
  `assets/js/gambar.js`.
