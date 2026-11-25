import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

export const OUTBOX_LEASE_MINUTES = 5;

export type OutboxEventType = "MEILISEARCH_SYNC_INSTITUTE";

export interface EnqueueOutboxParams {
  eventType: OutboxEventType;
  aggregateId: string;
  payload?: Prisma.InputJsonValue;
}

export interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/**
 * Computes exponential backoff with jitter (in milliseconds).
 * Base: 30s -> 60s -> 120s -> 240s -> 480s, capped at 1 hour.
 */
export function computeBackoffMs(attempts: number, randomFn: () => number = Math.random): number {
  const safeAttempts = Math.max(1, attempts);
  const baseMs = Math.min(30_000 * Math.pow(2, safeAttempts - 1), 3_600_000);
  const jitterMs = Math.floor(randomFn() * 10_000);
  return baseMs + jitterMs;
}

/**
 * Enqueues an outbox event inside the caller's Prisma transaction.
 */
export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  params: EnqueueOutboxParams
) {
  return tx.outboxEvent.create({
    data: {
      eventType: params.eventType,
      aggregateId: params.aggregateId,
      payload: params.payload ?? undefined,
      status: "PENDING",
      nextRetryAt: new Date(),
    },
  });
}

/**
 * Atomically claims up to `limit` eligible outbox events:
 * - Either PENDING & ready for retry, or PROCESSING whose lease expired (> 5 mins)
 * - Strictly serialized per aggregateId (no two PROCESSING events for the same aggregateId)
 * - Uses FOR UPDATE SKIP LOCKED to prevent concurrent worker races.
 */
export async function claimOutboxEvents(limit = 10): Promise<ClaimedOutboxEvent[]> {
  const rows = await prisma.$queryRaw<ClaimedOutboxEvent[]>`
    WITH candidates AS (
      SELECT DISTINCT ON (e."aggregateId") e.id
      FROM "outbox_event" e
      WHERE (
        (e."status" = 'PENDING' AND e."nextRetryAt" <= NOW())
        OR
        (e."status" = 'PROCESSING' AND e."lockedAt" < NOW() - (${OUTBOX_LEASE_MINUTES} * INTERVAL '1 minute'))
      )
      AND e."attempts" < e."maxAttempts"
      AND NOT EXISTS (
        SELECT 1
        FROM "outbox_event" active
        WHERE active."aggregateId" = e."aggregateId"
          AND active."status" = 'PROCESSING'
          AND active."lockedAt" >= NOW() - (${OUTBOX_LEASE_MINUTES} * INTERVAL '1 minute')
      )
      ORDER BY e."aggregateId", e."createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE OF e SKIP LOCKED
    )
    UPDATE "outbox_event" target
    SET
      "status" = 'PROCESSING',
      "lockedAt" = NOW(),
      "lastAttemptAt" = NOW(),
      "attempts" = target."attempts" + 1,
      "updatedAt" = NOW()
    FROM candidates
    WHERE target.id = candidates.id
    RETURNING
      target.id,
      target."eventType",
      target."aggregateId",
      target.payload,
      target.attempts,
      target."maxAttempts";
  `;

  return rows;
}

/**
 * Processes pending/recoverable outbox events.
 */
export async function processOutboxEvents(limit = 10): Promise<{
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
}> {
  const events = await claimOutboxEvents(limit);
  let completed = 0;
  let retried = 0;
  let failed = 0;

  if (events.length === 0) {
    return { claimed: 0, completed: 0, retried: 0, failed: 0 };
  }

  const { syncSingleInstituteToMeili } = await import("@/scripts/SyncInstitute");

  for (const event of events) {
    try {
      if (event.eventType === "MEILISEARCH_SYNC_INSTITUTE") {
        const res = await syncSingleInstituteToMeili(event.aggregateId);
        if (!res.success) {
          throw new Error(typeof res.error === "string" ? res.error : "Meilisearch sync returned failure");
        }
      } else {
        throw new Error(`Unsupported outbox eventType: ${event.eventType}`);
      }

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "COMPLETED",
          processedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
      completed += 1;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const exhausted = event.attempts >= event.maxAttempts;

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          lockedAt: null,
          lastError: errorMessage,
          nextRetryAt: exhausted ? undefined : new Date(Date.now() + computeBackoffMs(event.attempts)),
        },
      });

      if (exhausted) {
        failed += 1;
      } else {
        retried += 1;
      }
    }
  }

  return { claimed: events.length, completed, retried, failed };
}
