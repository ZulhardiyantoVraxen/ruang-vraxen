import { api } from "@/lib/api";
import QuestionsPanel from "./QuestionsPanel";

export default async function QuestionsPage() {
  const questions = await api.openQuestions().catch(() => []);
  return <QuestionsPanel initial={questions} />;
}
