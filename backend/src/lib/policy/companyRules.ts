export const EMPLOYEE_ROSTER = [
  { id: "ava-chen", name: "Ava Chen", role: "Engineering" },
  { id: "jordan-patel", name: "Jordan Patel", role: "Product" },
  { id: "samir-okonkwo", name: "Samir Okonkwo", role: "Data" },
  { id: "riley-nguyen", name: "Riley Nguyen", role: "Design" },
  { id: "morgan-ellis", name: "Morgan Ellis", role: "Ops" },
] as const;

export const COMPANY_RULES = {
  sprintCadenceWeeks: 2,
  maxConcurrentTasksPerPerson: 3,
  allowedOwners: EMPLOYEE_ROSTER.map((e) => e.name),
  deadlinesMustLandOnSprintEnd: true,
  noOwnerInvention:
    "Owners must come from the fixed roster. Never invent people. If ownership is unclear, mark the task sourceType as unresolved_question and assign Morgan Ellis as temporary coordinator.",
  factVsRecommendation:
    "Tasks that rest on a transcript decision are sourceType=fact. Tasks the planner adds to make the plan executable are recommendation. Tasks blocked by a flag are unresolved_question.",
} as const;

export function companyRulesPrompt(): string {
  return `Company operating rules (hard constraints):
1. Work is planned in ${COMPANY_RULES.sprintCadenceWeeks}-week sprints. Deadlines must land on a sprint end date (Friday of week 2, 4, 6, … from today).
2. Max ${COMPANY_RULES.maxConcurrentTasksPerPerson} concurrent tasks per person.
3. Owners MUST be one of: ${COMPANY_RULES.allowedOwners.join(", ")}.
4. ${COMPANY_RULES.noOwnerInvention}
5. ${COMPANY_RULES.factVsRecommendation}

These rules are also enforced in TypeScript after you propose a plan. Violations will be rewritten and logged.`;
}

export type ProposedTask = {
  title: string;
  owner: string;
  deadline: string;
  dependencies: string[];
  sourceType: "fact" | "recommendation" | "unresolved_question";
  justification: string;
};

export type RuleFix = { taskTitle: string; rule: string; fix: string };

function nextSprintFridays(count: number, from = new Date()): Date[] {
  const dates: Date[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const toFriday = (5 - day + 7) % 7;
  d.setDate(d.getDate() + toFriday);
  for (let i = 0; i < count * 2; i++) {
    if (i % 2 === 1) dates.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  while (dates.length < count) {
    d.setDate(d.getDate() + 14);
    dates.push(new Date(d));
  }
  return dates.slice(0, count);
}

export function applyCompanyRules(tasks: ProposedTask[]): {
  tasks: ProposedTask[];
  fixes: RuleFix[];
} {
  const fixes: RuleFix[] = [];
  const roster = new Set<string>(COMPANY_RULES.allowedOwners);
  const sprintEnds = nextSprintFridays(6);
  const counts = new Map<string, number>();
  const out: ProposedTask[] = [];

  for (const task of tasks) {
    const copy = { ...task, dependencies: [...task.dependencies] };

    if (!roster.has(copy.owner)) {
      fixes.push({
        taskTitle: copy.title,
        rule: "owners-must-be-on-roster",
        fix: `Rewrote owner "${copy.owner}" → Morgan Ellis (coordinator)`,
      });
      copy.owner = "Morgan Ellis";
      if (copy.sourceType === "fact") copy.sourceType = "unresolved_question";
    }

    const parsed = Date.parse(copy.deadline);
    const nearest = sprintEnds[0];
    if (Number.isNaN(parsed) && nearest) {
      copy.deadline = nearest.toISOString().slice(0, 10);
      fixes.push({
        taskTitle: copy.title,
        rule: "sprint-cadence",
        fix: `Invalid deadline replaced with next sprint end ${copy.deadline}`,
      });
    } else if (!Number.isNaN(parsed)) {
      const date = new Date(parsed);
      const match = sprintEnds.find((s) => s.toISOString().slice(0, 10) === date.toISOString().slice(0, 10));
      if (!match) {
        const next = sprintEnds.find((s) => s >= date) ?? sprintEnds[sprintEnds.length - 1];
        copy.deadline = next.toISOString().slice(0, 10);
        fixes.push({
          taskTitle: copy.title,
          rule: "sprint-cadence",
          fix: `Moved deadline to sprint end ${copy.deadline}`,
        });
      }
    }

    let owner = copy.owner;
    if ((counts.get(owner) ?? 0) >= COMPANY_RULES.maxConcurrentTasksPerPerson) {
      const fallback = COMPANY_RULES.allowedOwners.find(
        (n) => (counts.get(n) ?? 0) < COMPANY_RULES.maxConcurrentTasksPerPerson,
      );
      if (fallback) {
        fixes.push({
          taskTitle: copy.title,
          rule: "max-3-per-owner",
          fix: `Reassigned ${owner} → ${fallback} (cap ${COMPANY_RULES.maxConcurrentTasksPerPerson})`,
        });
        owner = fallback;
        copy.owner = fallback;
      }
    }
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
    out.push(copy);
  }

  return { tasks: out, fixes };
}

export const MAX_REVIEW_ATTEMPTS = 3;

export function nextReviewDecision(args: {
  approved: boolean;
  attemptNumber: number;
  maxAttempts?: number;
}): "approved" | "replan" | "needs_human_review" {
  const max = args.maxAttempts ?? MAX_REVIEW_ATTEMPTS;
  if (args.approved) return "approved";
  if (args.attemptNumber >= max) return "needs_human_review";
  return "replan";
}
