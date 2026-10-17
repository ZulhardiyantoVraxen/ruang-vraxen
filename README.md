# Agentic AI Platform

Perusahaan virtual berbasis agent AI: divisi dibuat dinamis (bukan hardcoded), satu divisi
bisa menjalankan beberapa pekerjaan sekaligus, dan setiap role punya tier model yang di-route
lewat OpenRouter (bisa free atau paid, tinggal di-switch per agent).

Terinspirasi dari tampilan [`ruang`](https://github.com/yugienugraha/ruang) (3D virtual
office), tapi dibangun ulang total di atas stack sendiri: Ruang murni dashboard read-only
yang shell ke `hermes` CLI dan tidak punya database/queue/agent engine sama sekali. Platform
ini punya ketiganya.

## Stack

| Layer | Teknologi | Peran |
|---|---|---|
| Frontend | Next.js | Office overview, wizard divisi baru, task board, approval queue |
| Backend | Nest.js | API + orchestrator, bicara ke semua layer lain |
| Database | Postgres (Prisma) | Divisi, role, agent, task, approval, usage — semua state persisten |
| Event bus | Kafka | `division-events`, `agent-events`, `task-events`, `usage-events` |
| Cache / pub-sub | Redis | Live status agent ke UI, cache ringan |
| Object storage | S3-compatible (MinIO lokal) | Output kerja agent: file, laporan, draft |
| Model routing | OpenRouter | Satu API key, model class per tier (ATAS/AHLI/RUTIN), free atau paid |

## Struktur monorepo

```
apps/
  api/            Nest.js backend
    src/
      divisions/      CRUD divisi + tambah role ke divisi yang sudah ada
      agents/         Provision agent, ubah status, switch model variant (FREE/PAID)
      tasks/          Task + subtask paralel, assignment, loop QA<->Spesialis
      approvals/      Antrean & keputusan persetujuan manusia
      model-routing/  OpenRouterService - satu pintu ke semua pemanggilan model
      orchestrator/   Alur onboarding divisi interaktif (lihat di bawah)
      usage/          Pencatatan token/biaya + cost cap per agent
      kafka/          Publisher event, satu topic per aggregate
      prisma/         Koneksi database
  web/            Next.js frontend (office overview, wizard, task board, approval queue)
packages/
  db/             Prisma schema - satu sumber kebenaran untuk seluruh model data
  shared/         Definisi topic Kafka + tipe event, dipakai api & (nanti) consumer lain
infra/
  docker-compose.yml   Postgres + Redis + Kafka (KRaft) + MinIO untuk dev lokal
```

## Kenapa desainnya begini

### 1. Divisi & role sepenuhnya dinamis

Tidak ada enum `Division { SOFTWARE, KONTEN, KONSTRUKSI, KESEHATAN }` di kode manapun.
`Division` dan `AgentRole` adalah baris tabel biasa. Menambah divisi baru, atau menambah
role baru ke divisi yang sudah jalan (`POST /divisions/:slug/roles`), tidak butuh deploy
ulang. Satu divisi menjalankan banyak pekerjaan sekaligus karena `Task` tidak dibatasi satu
per divisi — tiap task independen, dan subtask paralel dimodelkan lewat `Task.parentTaskId`.

### 2. Tiering model (dari "Peta Model per Agen")

Tiga tier tetap (`ATAS` / `AHLI` / `RUTIN`), tapi model konkret di baliknya adalah data
(`ModelClass`), bukan hardcode:

- **ATAS** — titik keputusan & penalaran kritis (PM, Chief of Staff, Auditor). Selalu paid.
- **AHLI** — kode/angka/dokumen formal (Developer, QA, Estimator, dll). Default: coba free
  dulu (model coder gratis), fallback ke paid untuk kasus kompleks.
- **RUTIN** — volume tinggi, risiko rendah (riset awal, publish, rekap). Di sinilah
  penghematan token terbesar (lihat `Ringkasan Tingkat` di spreadsheet: 30% agen, biasanya
  menyumbang porsi token terbesar).

Divisi yang menyentuh data sensitif (healthcare/PDP, finansial) menandai
`ModelClass.requiresZeroRetention = true`; `OpenRouterService` otomatis menolak mode FREE
untuk tier itu dan memaksa paid+zero-retention provider, apa pun permintaan agent.

Ganti model paid/free kapan saja lewat tabel `ModelClass` / kolom `Agent.modelVariant` —
tidak perlu ubah kode.

### 3. Onboarding divisi interaktif (`apps/api/src/orchestrator`)

Ini yang menjawab permintaan "bisa bertanya apa yang dibutuhkan, lalu rekomendasi roster":

1. `POST /onboarding/start { brief }` — ceritakan singkat divisi apa yang mau dibuat.
2. Orkestrator (model tier ATAS) balas berupa pertanyaan klarifikasi (maks 4) **atau**
   langsung rekomendasi roster kalau informasinya sudah cukup.
3. `POST /onboarding/:id/answer { answer }` — jawab, ulangi sampai dapat rekomendasi.
4. Rekomendasi berisi daftar role lengkap dengan tier, tanggung jawab, dan apakah role itu
   butuh approval manusia.
5. `POST /onboarding/:id/confirm { slug, name }` — baru di titik ini `Division` dan
   `AgentRole` benar-benar dibuat di database.

Prompt orkestrator ada di `orchestrator.prompt.ts` — ini satu-satunya tempat yang perlu
disetel kalau mau mengubah gaya pertanyaan atau aturan rekomendasi (mis. wajib ada role
ATAS, tandai `requiresApproval` untuk data sensitif, dsb).

### 4. Kafka: topic per aggregate, bukan per event

Lihat `packages/shared/src/events/topics.ts`. Daripada topic meledak setiap kali ada fitur
baru (`division.created`, `division.renamed`, ...), setiap aggregate (`division`, `agent`,
`task`, `usage`) punya satu topic; jenis event spesifik ada di field `eventType` dalam
payload. Partition key selalu `aggregateId`, jadi event untuk satu task/divisi/agent yang
sama tetap berurutan.

### 5. Guardrail biaya (dari "Catatan Penting" di spreadsheet)

- `Task.maxRevisions` + `Task.revisionCount` — loop QA ↔ Spesialis berhenti otomatis,
  emit `task.revision_limit.reached` dan task masuk `BLOCKED` alih-alih berputar selamanya.
- `CostCap` per agent — `UsageService` cek total biaya tiap kali mencatat usage; di 80% dari
  batas kirim `usage.cost_cap.warning`, di 100% agent otomatis di-`PAUSE` dan kirim
  `usage.cost_cap.exceeded`.

## Menjalankan secara lokal

```bash
cp infra/.env.example apps/api/.env
pnpm install
pnpm infra:up                 # Postgres, Redis, Kafka, MinIO
pnpm db:migrate                # bikin tabel dari schema.prisma
pnpm --filter @platform/db prisma:seed   # isi 3 ModelClass (ATAS/AHLI/RUTIN)
pnpm dev:api                   # Nest.js di :4000
pnpm dev:web                   # Next.js di :3000
```

Isi `OPENROUTER_API_KEY` di `apps/api/.env` (dari https://openrouter.ai/keys) sebelum
mencoba alur onboarding — itu satu-satunya kredensial yang dibutuhkan untuk memanggil model,
baik versi gratis maupun berbayar.

## Yang belum ada / langkah lanjutan

Ini scaffold struktural, bukan implementasi penuh. Yang sengaja belum dibangun:

- **Task executor** — service yang benar-benar menjalankan pekerjaan agent (ambil task
  `RUNNING`, panggil `OpenRouterService.chat()`, tulis hasil ke Object Storage, catat usage,
  lempar ke QA). Saat ini endpoint `tasks` hanya mengubah state, belum mengeksekusi.
- **Kafka consumer** — publisher sudah jalan (`KafkaService.publish`), tapi belum ada service
  yang `consume` topic-topic itu untuk memicu langkah berikutnya (mis. task.assigned ->
  jalankan agent). Ini jembatan antara "data berubah" dan "kerjaan beneran dilakukan".
  Sengaja dipisah modulnya supaya scaling konsumer independen dari API.
- **Auth** — belum ada; semua endpoint terbuka. Perlu sebelum deploy ke luar localhost.
- **3D/2D office view** — halaman `/` di web masih list sederhana, belum visualisasi seperti
  Ruang. Bisa ditambah setelah data dari API-nya stabil (three.js / react-three-fiber, sama
  seperti referensi).
- **Biaya real per model** — `estimateCostUsd` di `usage.service.ts` masih placeholder;
  ganti dengan tabel harga OpenRouter yang sebenarnya.
