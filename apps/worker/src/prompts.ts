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
