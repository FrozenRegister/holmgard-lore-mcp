export type PhaseTaskStatus = "open" | "in_progress" | "done";
export interface PhaseTask { id: string; description: string; status: PhaseTaskStatus; }
type PhaseState = { id: string; name: string; status: "open" | "closed"; tasks: PhaseTask[]; }

const master541: PhaseState = {
  id: "541",
  name: "Phase 0 master list",
  status: "open",
  tasks: [
    { id: "t1", description: "Clarify Phase 0 master list scope and acceptance criteria", status: "open" },
    { id: "t2", description: "Define Phase 1 reading plan and success criteria", status: "open" },
    { id: "t3", description: "Identify dependencies and blockers (CI/storage references)", status: "open" },
  ],
};

export function getPhase541MasterList(): PhaseState {
  return master541;
}

export function completePhase541Task(taskId: string): boolean {
  const t = master541.tasks.find((x) => x.id === taskId);
  if (t) { t.status = "done"; return true; }
  return false;
}

export function isPhase541Complete(): boolean {
  return master541.tasks.every((t) => t.status === "done");
}

export function resetPhase541(): void {
  master541.tasks.forEach((t) => (t.status = "open"));
}

export function phase541TaskCount(): number {
  return master541.tasks.length;
}
