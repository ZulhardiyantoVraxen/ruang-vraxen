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
  api/            Nest.js backend (REST, pemilik semua business rule/state transition)
    src/
      divisions/      CRUD divisi + tambah role ke divisi yang sudah ada
      agents/         Provision agent, ubah status, switch model variant (FREE/PAID)
      tasks/          Task + subtask paralel, assignment, loop QA<->Spesialis, simpan hasil
      approvals/      Antrean & keputusan persetujuan manusia
      model-routing/  OpenRouterService - satu pintu ke semua pemanggilan model dari API
      orchestrator/   Alur onboarding divisi interaktif (lihat di bawah)
      usage/          Pencatatan token/biaya + cost cap per agent
      kafka/          Publisher event, satu topic per aggregate
      prisma/         Koneksi database
  worker/         Task executor - Kafka CONSUMER, proses terpisah dari api (lihat di bawah)
  web/            Next.js frontend (office overview, wizard, task board, approval queue)
packages/
  db/             Prisma schema - satu sumber kebenaran untuk seluruh model data
  shared/         Topic Kafka + tipe event + OpenRouterClient + ObjectStorageClient +
                  resolveModel() - dipakai bersama oleh api & worker, tanpa duplikasi logic
infra/
  docker-compose.yml   Postgres + Redis + Kafka (KRaft) + MinIO untuk dev lokal
```

### Task executor (`apps/worker`)

Proses Node terpisah dari `apps/api`, sengaja - supaya jumlah worker bisa discale naik/turun independen dari API (banyak task jalan bersamaan = perlu banyak worker; trafik dashboard tinggi tidak otomatis butuh lebih banyak worker, begitu juga sebaliknya).

Alurnya:
1. `TasksService.assign()` di API meng-assign agent ke task (role `EXECUTOR` atau `REVIEWER`) dan publish event `task.assigned` ke topic `task-events`.
2. Worker consume event itu. Kalau role-nya `EXECUTOR`: ambil agent + role + divisi + task dari Postgres, `resolveModel()` tier role itu ke model OpenRouter yang tepat (lihat `packages/shared/src/model-routing.ts` - fungsi yang sama dipakai API untuk onboarding), lalu panggil model lewat `OpenRouterClient`.
3. Output disimpan: ringkasan pendek di `Task.resultSummary`, teks lengkap ke Object Storage (MinIO lokal) lewat `ObjectStorageClient`, key-nya disimpan di `Task.resultObjectKey`. Pemakaian token dilaporkan ke `POST /usage` (di situ cost cap dicek, bukan di worker).
4. Kalau task itu sudah punya agent dengan role `REVIEWER` ter-assign, worker langsung jalankan QA (`reviewerPrompt`, model dari role reviewer itu sendiri - bisa beda tier/model dari executor, sesuai aturan "QA pakai model berbeda dari pembuatnya"). Reviewer balas JSON `{"verdict":"PASS"|"FAIL","notes":"..."}`.
5. `PASS` -> `POST /tasks/:id/qa-passed` (API yang putuskan lanjut ke `DONE` atau `APPROVAL_PENDING`, sesuai `Task.requiresApproval`). `FAIL` -> `POST /tasks/:id/qa-failed` (API yang naikkan `revisionCount` dan hentikan loop di `maxRevisions`, sesuai Catatan Penting di spreadsheet).
6. Kalau task itu TIDAK punya reviewer ter-assign, output executor langsung dianggap final (`qa-passed` dipanggil langsung) - cocok untuk role tier `RUTIN` yang memang tidak perlu QA berlapis.

Worker tidak pernah menulis langsung ke `Task`/`Approval`/`CostCap` - itu tetap wewenang `apps/api` (`TasksService`, `UsageService`). Worker hanya baca Postgres untuk konteks, dan menulis lewat endpoint API supaya semua aturan bisnis (batas revisi, cost cap, pembuatan Approval) tetap di satu tempat.

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

- **Pemilihan agent otomatis** — `POST /tasks/:id/assign` masih butuh `agentId` eksplisit.
  Belum ada logic "pilih agent idle dengan role yang cocok, atau provision agent baru kalau
  semuanya sibuk" - saat ini orchestrator/manusia yang menentukan siapa mengerjakan apa.
- **Auth** — belum ada; semua endpoint terbuka. Perlu sebelum deploy ke luar localhost.
- **3D/2D office view** — halaman `/` di web masih list sederhana, belum visualisasi seperti
  Ruang. Bisa ditambah setelah data dari API-nya stabil (three.js / react-three-fiber, sama
  seperti referensi).
- **Biaya real per model** — `estimateCostUsd` di `usage.service.ts` masih placeholder;
  ganti dengan tabel harga OpenRouter yang sebenarnya.
