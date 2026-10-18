/**
 * Seeds the three ModelTier -> ModelClass policies, matching "Peta Model per
 * Agen" (sheet "Ringkasan Tingkat"). Paid model ids are a sensible OpenRouter
 * default - change them any time in the ModelClass table (or an admin UI
 * later), no code change needed.
 *
 * Free-tier OpenRouter model ids drift (providers add/retire free slots), so
 * treat `openRouterModelFree` as a starting point to verify against
 * https://openrouter.ai/models?max_price=0 before going live.
 */
import { PrismaClient, ModelTier, DivisionStatus, AgentStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.modelClass.upsert({
    where: { tier: ModelTier.ATAS },
    update: {},
    create: {
      tier: ModelTier.ATAS,
      label: "Premium (Claude Sonnet/Opus atau setara)",
      openRouterModelPaid: "anthropic/claude-sonnet-4.5",
      openRouterModelFree: null, // titik keputusan - jangan dijalankan di model gratis
      requiresZeroRetention: false,
      notes:
        "Chief of Staff, 4 PM, Auditor. Titik keputusan & penalaran kritis - selalu paid.",
    },
  });

  await prisma.modelClass.upsert({
    where: { tier: ModelTier.AHLI },
    update: {},
    create: {
      tier: ModelTier.AHLI,
      label: "Menengah-premium, terutama untuk kode dan angka",
      openRouterModelPaid: "anthropic/claude-sonnet-4.5",
      openRouterModelFree: "qwen/qwen-2.5-coder-32b-instruct:free",
      // "Maksimalkan versi gratis" - rotasi acak di antara semua model gratis
      // di akun OpenRouter yang cukup mampu untuk kode/angka, bukan cuma satu.
      openRouterModelFreePool: [
        "qwen/qwen-2.5-coder-32b-instruct:free",
        "cohere/north-mini-code:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "google/gemma-4-31b-it:free",
        "dots-studio/dots-3-note-preview:free",
        "poolside/laguna-s-2.1:free",
      ],
      requiresZeroRetention: false,
      notes:
        "Developer, QA/Reviewer, Estimator, Tender & Dokumen, Billing & Klaim, Kepatuhan Data, dll.",
    },
  });

  await prisma.modelClass.upsert({
    where: { tier: ModelTier.RUTIN },
    update: {},
    create: {
      tier: ModelTier.RUTIN,
      label: "Model murah/cepat",
      openRouterModelPaid: "meta-llama/llama-3.3-70b-instruct",
      openRouterModelFree: "meta-llama/llama-3.3-70b-instruct:free",
      // Tingkat volume terbesar - rotasi di antara model gratis yang murah/cepat
      // supaya pemakaian tersebar, bukan numpuk di satu model terus.
      openRouterModelFreePool: [
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemma-4-26b-a4b-it:free",
        "liquid/lfm-2.5-2.6b:free",
        "nvidia/nemotron-3.5-lightning:free",
        "poolside/laguna-xs-2.1:free",
        "thinkingmachines/inkling-small:free",
        "thinkingmachines/inkling:free",
        "xingchen-agi/xing4.0-29b-a4b:free",
        "nvidia/nemotron-3.5-super-vl:free",
      ],
      requiresZeroRetention: false,
      notes:
        "Riset, Publisher, Front Office, Inventori, Pelaporan Lapangan, Finance (rekap). Porsi token terbesar - di sini penghematan terbesar.",
    },
  });

  console.log("Model tiers seeded.");

  await seedDefaultOrg();
  console.log("Default org (5 divisi, 23 agent) seeded.");
}

/**
 * Default headcount, straight from "Peta Model per Agen" (sheet "Ringkasan
 * Tingkat": Atas 6 / Ahli 10 / Rutin 7 = 23 total) and the exact role names
 * from the "Alur Kerja Startup Virtual" org chart. One Agent per AgentRole by
 * default - scale a role horizontally later via POST /agents, this just gets
 * the office out of "empty" on first boot.
 *
 * requiresApproval is set only on the roles the spreadsheet/artifact call
 * explicit decision points ("Titik keputusan & laporan approval": Chief of
 * Staff + the four PMs) - everything else works autonomously and only rolls
 * up to human approval at the TASK level (Task.requiresApproval), per the
 * "Daftar tetap: apa yang wajib naik" table, not at the role level.
 */
async function seedDefaultOrg() {
  const tiers = await prisma.modelClass.findMany();
  const modelClassId = (tier: ModelTier) => tiers.find((t) => t.tier === tier)!.id;

  type RoleSeed = { name: string; tier: ModelTier; responsibilities: string; requiresApproval?: boolean; agent: string };
  type DivisionSeed = { slug: string; name: string; description: string; metadata?: Record<string, unknown>; roles: RoleSeed[] };

  const divisions: DivisionSeed[] = [
    {
      slug: "pusat",
      name: "Pusat",
      description: "Chief of Staff, Finance, dan Auditor - melayani semua divisi, menggabungkan laporan untuk antrean persetujuan Anda.",
      roles: [
        { name: "Chief of Staff", tier: ModelTier.ATAS, responsibilities: "Menggabungkan laporan 4 PM jadi antrean persetujuan Anda", requiresApproval: true, agent: "Raka Pratama" },
        { name: "Auditor", tier: ModelTier.ATAS, responsibilities: "Cek acak semua divisi, butuh penalaran kritis", agent: "Dewi Anggraini" },
        { name: "Finance", tier: ModelTier.RUTIN, responsibilities: "Rekap invoice, biaya proyek, token", agent: "Budi Santoso" },
      ],
    },
    {
      slug: "software",
      name: "Software",
      description: "Kode, test, dokumentasi, dan deploy ke staging berjalan sendiri; arsitektur dan deploy produksi wajib persetujuan Anda.",
      roles: [
        { name: "PM Software", tier: ModelTier.ATAS, responsibilities: "Titik keputusan & laporan approval", requiresApproval: true, agent: "Andi Wijaya" },
        { name: "Analis", tier: ModelTier.AHLI, responsibilities: "Analisis kebutuhan memengaruhi seluruh pengerjaan", agent: "Sari Kusuma" },
        { name: "Desainer UI/UX", tier: ModelTier.AHLI, responsibilities: "Desain antarmuka & pengalaman pengguna - koordinasi dengan PM Software & Analis; wajib persetujuan Anda sebelum lanjut ke Developer", agent: "Dinda Permatasari" },
        { name: "Developer", tier: ModelTier.AHLI, responsibilities: "Menulis kode", agent: "Fajar Ramadhan" },
        { name: "QA / Reviewer", tier: ModelTier.AHLI, responsibilities: "Pemeriksaan teliti; batasi iterasi revisi", agent: "Lina Marlina" },
        { name: "DevOps", tier: ModelTier.AHLI, responsibilities: "Konfigurasi server & deploy, kesalahan mahal", agent: "Doni Setiawan" },
      ],
    },
    {
      slug: "konten",
      name: "Konten",
      description: "Riset, naskah, dan draf video berjalan sendiri; publish dan materi wajah/suara orang nyata wajib persetujuan Anda.",
      roles: [
        { name: "PM Konten", tier: ModelTier.ATAS, responsibilities: "Titik keputusan & laporan approval", requiresApproval: true, agent: "Maya Puspita" },
        { name: "Riset & Script", tier: ModelTier.RUTIN, responsibilities: "Naik ke Ahli bila kualitas naskah kurang", agent: "Dian Permata" },
        { name: "Produksi Visual", tier: ModelTier.RUTIN, responsibilities: "Model teks hanya untuk prompt; video/gambar pakai model generatif terpisah", agent: "Rizky Firmansyah" },
        { name: "Editor / QC", tier: ModelTier.AHLI, responsibilities: "Peran QA di divisi konten", agent: "Nadia Ayu" },
        { name: "Publisher", tier: ModelTier.RUTIN, responsibilities: "Penjadwalan & unggah (publish tetap wajib disetujui)", agent: "Agus Hidayat" },
      ],
    },
    {
      slug: "konstruksi",
      name: "Konstruksi",
      description: "Pantau tender dan draf dokumen berjalan sendiri; RAB final dan keselamatan wajib persetujuan insinyur/ahli K3.",
      roles: [
        { name: "PM Konstruksi", tier: ModelTier.ATAS, responsibilities: "Titik keputusan & laporan approval", requiresApproval: true, agent: "Hendra Gunawan" },
        { name: "Tender & Dokumen", tier: ModelTier.AHLI, responsibilities: "Dokumen formal & syarat tender", agent: "Siti Rahma" },
        { name: "Estimator", tier: ModelTier.AHLI, responsibilities: "Perhitungan angka/RAB draf", agent: "Taufik Hidayat" },
        { name: "Pengadaan", tier: ModelTier.AHLI, responsibilities: "Membandingkan harga & spesifikasi material", agent: "Yulia Safitri" },
        { name: "Pelaporan Lapangan", tier: ModelTier.RUTIN, responsibilities: "Merangkum laporan lapangan", agent: "Bayu Saputra" },
      ],
    },
    {
      slug: "kesehatan",
      name: "Kesehatan",
      description: "Jadwal dan draf tagihan berjalan sendiri; semua hal klinis dan akses data pasien wajib persetujuan tenaga medis.",
      metadata: { requiresZeroDataRetention: true, note: "Data pasien lewat OpenRouter diteruskan ke penyedia lain - berkaitan dengan UU PDP." },
      roles: [
        { name: "PM Kesehatan", tier: ModelTier.ATAS, responsibilities: "Titik keputusan & laporan approval", requiresApproval: true, agent: "Indah Lestari" },
        { name: "Front Office", tier: ModelTier.RUTIN, responsibilities: "Jadwal & pengingat; jangan kirim data pasien teridentifikasi", agent: "Putri Wulandari" },
        { name: "Billing & Klaim", tier: ModelTier.AHLI, responsibilities: "Aturan klaim rumit; pakai penyedia zero data retention", agent: "Arief Rahman" },
        { name: "Inventori", tier: ModelTier.RUTIN, responsibilities: "Usulan stok", agent: "Wahyu Nugroho" },
        { name: "Kepatuhan Data", tier: ModelTier.AHLI, responsibilities: "Terkait UU PDP; pakai penyedia zero data retention", agent: "Citra Dewi" },
      ],
    },
  ];

  for (const d of divisions) {
    const division = await prisma.division.upsert({
      where: { slug: d.slug },
      update: { name: d.name, description: d.description, status: DivisionStatus.ACTIVE, metadata: d.metadata as any },
      create: { slug: d.slug, name: d.name, description: d.description, status: DivisionStatus.ACTIVE, metadata: d.metadata as any },
    });

    for (const r of d.roles) {
      const role = await prisma.agentRole.upsert({
        where: { divisionId_name: { divisionId: division.id, name: r.name } },
        update: {
          tier: r.tier,
          modelClassId: modelClassId(r.tier),
          responsibilities: r.responsibilities,
          requiresApproval: r.requiresApproval ?? false,
        },
        create: {
          divisionId: division.id,
          name: r.name,
          tier: r.tier,
          modelClassId: modelClassId(r.tier),
          responsibilities: r.responsibilities,
          requiresApproval: r.requiresApproval ?? false,
        },
      });

      // Agent has no natural unique key, so upsert by hand: one default agent
      // per role, safe to re-run without creating duplicates on every seed.
      const existing = await prisma.agent.findFirst({ where: { agentRoleId: role.id, displayName: r.agent } });
      if (!existing) {
        await prisma.agent.create({ data: { agentRoleId: role.id, displayName: r.agent, status: AgentStatus.IDLE } });
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
