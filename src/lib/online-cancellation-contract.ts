import { z } from "zod";

const amount = z.number().int().positive().max(2_147_483_647);
const points = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
const blocker = z.enum(["ALREADY_CANCELLED", "READERS_NOT_ENABLED", "REVIEW_REQUIRED"]);

export const onlineCancellationPreview = z.strictObject({
  orderId: z.uuid(), memberCode: z.string(), packageName: z.string().nullable(),
  amountSatang: z.number().int().nonnegative().max(2_147_483_647), pointsToReverse: points,
  confirmedAt: timestamp.nullable(), eligible: z.boolean(), blocker: blocker.nullable(),
}).refine(value => value.eligible ? value.blocker === null && value.amountSatang > 0 && value.confirmedAt !== null : value.blocker !== null);
export const onlineCancellationInput = z.strictObject({
  requestKey: z.uuidv4(), refundSatang: amount, confirmedFullExternalRefund: z.literal(true),
  reason: z.string().trim().min(1).max(240).refine(reason => !reason.includes("\0")),
});
export const onlineCancellationReceipt = z.strictObject({
  orderId: z.uuid(), source: z.literal("ONLINE_REFUND"), status: z.literal("CANCELLED"),
  cancelledAt: timestamp, refundSatang: amount, pointsReversed: points,
});
