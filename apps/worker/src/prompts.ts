/** Prompt builders kept in one file so the "voice" of executor vs reviewer agents is easy to tune in one place. */

export function executorPrompt(params: {
  divisionName: string;
  roleName: string;
  responsibilities: string | null;
  taskTitle: string;
  taskDescription: string | null;
}) {
  return [
    `Kamu adalah "${params.roleName}" di divisi "${params.divisionName}" pada sebuah perusahaan virtual.`,
    params.responsibilities ? `Tanggung jawabmu: ${params.responsibilities}` : "",
    `Kerjakan task berikut dan hasilkan output yang langsung bisa dipakai (bukan rencana, bukan "akan saya kerjakan").`,
    ``,
    `Judul task: ${params.taskTitle}`,
    params.taskDescription ? `Detail: ${params.taskDescription}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function chiefOfStaffTriagePrompt(params: {
  taskTitle: string;
  taskDescription: string | null;
  divisions: {
    slug: string;
    name: string;
    description: string | null;
    roles: { name: string; responsibilities: string | null; isPM: boolean; hasAgent: boolean }[];
  }[];
}) {
  const divisionsList = params.divisions
    .map((d) => {
      const roles = d.roles
        .map(
          (r) =>
            `  - ${r.name}${r.isPM ? " (PM/pengambil keputusan)" : ""}${r.hasAgent ? "" : " [belum ada agent]"}: ${r.responsibilities ?? "-"}`,
        )
        .join("\n");
      return `- "${d.slug}" - ${d.name}${d.description ? `: ${d.description}` : ""}\n${roles}`;
    })
    .join("\n\n");

  return [
    `Permintaan kerja berikut baru masuk ke mejamu sebagai Chief of Staff:`,
    ``,
    `Judul: ${params.taskTitle}`,
    params.taskDescription ? `Detail: ${params.taskDescription}` : "",
    ``,
    `Divisi yang ada beserta role di dalamnya:`,
    ``,
    divisionsList,
    ``,
    `Tugasmu: pilih SATU divisi (pakai slug persis seperti di atas) yang paling tepat menangani permintaan ini.`,
    `Kalau permintaan ini genuinely lintas-divisi, strategis, atau audit/finansial yang memang levelmu sendiri`,
    `(bukan pekerjaan teknis satu divisi), pilih "pusat".`,
    `Jangan pilih divisi yang semua role-nya ditandai [belum ada agent].`,
    ``,
    `Balas HANYA dengan JSON, tanpa teks lain:`,
    `{"divisionSlug":"...","reasoning":"satu-dua kalimat singkat kenapa"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function reviewerPrompt(params: {
  divisionName: string;
  reviewerRoleName: string;
  taskTitle: string;
  taskDescription: string | null;
  executorOutput: string;
}) {
  return [
    `Kamu adalah "${params.reviewerRoleName}" di divisi "${params.divisionName}" - perananmu adalah QA/reviewer.`,
    `Periksa hasil kerja di bawah ini untuk task "${params.taskTitle}"` +
      (params.taskDescription ? ` (${params.taskDescription})` : "") +
      `.`,
    ``,
    `--- HASIL KERJA ---`,
    params.executorOutput,
    `--- AKHIR HASIL KERJA ---`,
    ``,
    `Balas HANYA dengan JSON: {"verdict":"PASS"|"FAIL","notes":"..."}`,
    `PASS kalau hasil sudah layak dipakai. FAIL kalau ada kesalahan nyata (bukan soal gaya penulisan semata) - sebutkan apa yang harus diperbaiki di "notes".`,
  ].join("\n");
}
