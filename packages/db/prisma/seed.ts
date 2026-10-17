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
import { PrismaClient, ModelTier } from "@prisma/client";

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
      requiresZeroRetention: false,
      notes:
        "Riset, Publisher, Front Office, Inventori, Pelaporan Lapangan, Finance (rekap). Porsi token terbesar - di sini penghematan terbesar.",
    },
  });

  console.log("Model tiers seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
