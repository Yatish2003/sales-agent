import { prisma } from "../prisma.js";
import { Prisma } from "@prisma/client";

export async function logAction(args: {
  leadId?: string;
  runId?: string;
  actor: string;
  action: string;
  detail?: Prisma.InputJsonValue;
}) {
  return prisma.actionLogEntry.create({
    data: {
      leadId: args.leadId,
      runId: args.runId,
      actor: args.actor,
      action: args.action,
      detail: args.detail,
    },
  });
}
