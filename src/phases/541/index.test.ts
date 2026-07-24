import { getPhase541MasterList, completePhase541Task, isPhase541Complete, resetPhase541, phase541TaskCount } from "./index";

describe("Phase 541 Master List", () => {
  it("loads with tasks", () => {
    const list = getPhase541MasterList();
    expect(list.id).toBe("541");
    expect(list.tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("marks a task as done", () => {
    resetPhase541();
    const list = getPhase541MasterList();
    const t = list.tasks[0];
    expect(t.status).toBe("open");
    completePhase541Task(t.id);
    expect(list.tasks.find((x) => x.id === t.id)!.status).toBe("done");
  });

  it("detects completion when all done", () => {
    resetPhase541();
    const list = getPhase541MasterList();
    list.tasks.forEach((t) => completePhase541Task(t.id));
    expect(isPhase541Complete()).toBe(true);
  });
});
