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

/**
 * The PM/decision-point variant of executorPrompt: used for any role with
 * AgentRole.requiresApproval=true (Chief of Staff included - same flag the
 * rest of this codebase already treats as "this is the PM-tier role"). The
 * difference from a plain executor is the escape hatch - "ajukan
 * pertanyaan kepada direktur" per the director's brief that a PM should be
 * interactive, not guess when something genuinely needs their call.
 */
export function pmExecutorPrompt(params: {
  divisionName: string;
  roleName: string;
  responsibilities: string | null;
  taskTitle: string;
  taskDescription: string | null;
}) {
  return [
    `Kamu adalah "${params.roleName}" di divisi "${params.divisionName}" pada sebuah perusahaan virtual - perananmu adalah titik keputusan/PM divisi ini, melapor langsung ke direktur.`,
    params.responsibilities ? `Tanggung jawabmu: ${params.responsibilities}` : "",
    ``,
    `Judul task: ${params.taskTitle}`,
    params.taskDescription ? `Detail: ${params.taskDescription}` : "",
    ``,
    `Kerjakan/laporkan task ini. Kalau ada hal yang benar-benar butuh keputusan atau klarifikasi dari`,
    `direktur sebelum kamu bisa melanjutkan dengan yakin (bukan hal yang bisa kamu putuskan sendiri`,
    `sebagai PM), JANGAN menebak - ajukan sebagai pertanyaan ke direktur.`,
    ``,
    `Balas HANYA dengan JSON, salah satu dari dua bentuk ini, tanpa teks lain:`,
    `{"type":"result","summary":"..."}`,
    `{"type":"question","question":"..."}`,
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

/**
 * "Direktur hanya koordinasi dengan Chief of Staff, koordinasi PM hanya
 * sebatas sampai Chief of Staff" - when a division PM raises a question
 * while executing a task, it goes here FIRST instead of straight to the
 * director. Chief of Staff (also an AI agent) either settles it on the spot
 * or decides it genuinely needs the director, and only then forwards it -
 * under Chief of Staff's own name, never the original PM's.
 */
export function chiefOfStaffRelayPrompt(params: {
  askingRoleName: string;
  askingDivisionName: string;
  taskTitle: string;
  taskDescription: string | null;
  question: string;
}) {
  return [
    `Kamu adalah Chief of Staff. Semua pertanyaan dari PM divisi lain ke direktur harus lewat kamu dulu -`,
    `direktur hanya pernah koordinasi langsung denganmu, tidak dengan PM divisi satu-satu.`,
    ``,
    `"${params.askingRoleName}" di divisi "${params.askingDivisionName}" sedang mengerjakan task berikut dan bertanya:`,
    ``,
    `Judul task: ${params.taskTitle}`,
    params.taskDescription ? `Detail: ${params.taskDescription}` : "",
    `Pertanyaan PM: ${params.question}`,
    ``,
    `Kalau ini hal yang bisa kamu jawab/putuskan sendiri sebagai Chief of Staff (kebijakan internal, prioritas`,
    `operasional, hal yang levelmu), jawab langsung. Kalau ini genuinely butuh keputusan direktur (strategis,`,
    `anggaran besar, atau di luar kewenanganmu), teruskan ke direktur - tulis ulang pertanyaannya seolah KAMU`,
    `yang bertanya ke direktur (jangan menyebut nama PM aslinya, cukup "tim ${params.askingDivisionName}").`,
    ``,
    `Balas HANYA dengan JSON, salah satu dari dua bentuk ini, tanpa teks lain:`,
    `{"type":"answer","answer":"..."}`,
    `{"type":"escalate","question":"..."}`,
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
