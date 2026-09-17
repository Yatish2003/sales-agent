import { SALES_REPS } from "./policy/businessPolicy.js";

export type RoutingInput = {
  service: "Dashboard Build" | "Data Pipeline Audit" | "Fractional Analytics Support" | null | undefined;
  nextAvailableByRep: Record<string, Date | null>;
};

export type RoutingResult = {
  assignedRepId: string;
  assignedRepName: string;
  overrideReason: string | null;
};

function primaryRepIdForService(service: RoutingInput["service"]): string | null {
  if (!service) return null;
  if (service === "Data Pipeline Audit") return "marcus-webb";
  return "priya-shah";
}

export function routeLead(input: RoutingInput): RoutingResult | null {
  const primaryId = primaryRepIdForService(input.service);
  if (!primaryId) return null;

  const primary = SALES_REPS.find((r) => r.id === primaryId)!;
  const overflow = SALES_REPS.find((r) => r.id !== primaryId)!;
  const primaryNext = input.nextAvailableByRep[primary.id] ?? null;
  const overflowNext = input.nextAvailableByRep[overflow.id] ?? null;

  if (primaryNext) {
    return {
      assignedRepId: primary.id,
      assignedRepName: primary.name,
      overrideReason: null,
    };
  }

  if (overflowNext) {
    return {
      assignedRepId: overflow.id,
      assignedRepName: overflow.name,
      overrideReason: `${primary.name} has no remaining slots in the requested window; assigned overflow ${overflow.name} (next available ${overflowNext.toISOString()}).`,
    };
  }

  const fallbackDates = Object.entries(input.nextAvailableByRep)
    .filter(([, d]) => d)
    .sort((a, b) => a[1]!.getTime() - b[1]!.getTime());
  if (fallbackDates.length === 0) {
    return {
      assignedRepId: primary.id,
      assignedRepName: primary.name,
      overrideReason: "No availability computed; defaulting to primary specialist.",
    };
  }
  const [id] = fallbackDates[0];
  const rep = SALES_REPS.find((r) => r.id === id)!;
  return {
    assignedRepId: rep.id,
    assignedRepName: rep.name,
    overrideReason: `Both specialists looked fully booked in-window; assigned next available (${rep.name}).`,
  };
}
