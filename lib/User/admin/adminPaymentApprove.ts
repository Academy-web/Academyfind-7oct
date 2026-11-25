"use server"

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
    PAYMENT_APPROVED_STATUS,
    PAYMENT_REJECTED_STATUS,
    validatePaymentTransition,
} from "@/lib/institutes/institute-workflow";
import { lockInstituteRow } from "@/lib/subscription/trial";
import { enqueueOutboxEvent, processOutboxEvents } from "@/lib/subscription/outbox";

export async function approvePayment(paymentId: string, actorUserId?: string) {
    try{
        const payment = await prisma.subscriptionPayment.findUnique({
            where: { id: paymentId },
            include: { institute: true }
        });

        if (!payment) return { success: false, error: "Payment not found", statusCode: 404 };

        const transition = validatePaymentTransition(payment.status, "APPROVED");
        if (!transition.success) {
            return transition;
        }

        const now = new Date();
        const expiryDate = new Date(now);
        if (payment.billingCycle === "MONTHLY") {
            expiryDate.setDate(expiryDate.getDate() + 30);
        } else {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        }

        const planWeights: Record<string, number> = { "ULTRA": 4, "PREMIUM": 3, "VERIFIED": 2, "BASIC": 1 };
        const txResult = await prisma.$transaction(async (tx) => {
            await lockInstituteRow(tx, payment.instituteId);

            // Re-validate & claim payment atomically to prevent double approval
            const claimedPayment = await tx.subscriptionPayment.updateMany({
                where: { id: paymentId, status: "PENDING" },
                data: { status: PAYMENT_APPROVED_STATUS }
            });

            if (claimedPayment.count !== 1) {
                return { success: false, error: "Payment was already processed.", statusCode: 409 };
            }

            await tx.institute.update({
                where: { id: payment.instituteId },
                data: {
                    subscriptionPlan: payment.planRequested as any,
                    planWeight: planWeights[payment.planRequested] || 1,
                    planExpiresAt: expiryDate,
                    isVerified: true
                }
            });

            // Convert any ACTIVE trial atomically (never touch historical CONVERTED/EXPIRED rows)
            const activeTrial = await tx.instituteTrial.findFirst({
                where: { instituteId: payment.instituteId, status: "ACTIVE" },
                select: { id: true }
            });

            if (activeTrial) {
                const converted = await tx.instituteTrial.updateMany({
                    where: { id: activeTrial.id, status: "ACTIVE" },
                    data: {
                        status: "CONVERTED",
                        convertedAt: now,
                        convertedPlan: payment.planRequested as any,
                        convertedPaymentId: payment.id,
                    }
                });

                if (converted.count === 1) {
                    await tx.trialAuditLog.create({
                        data: {
                            trialId: activeTrial.id,
                            instituteId: payment.instituteId,
                            actorUserId: actorUserId ?? payment.userId ?? null,
                            action: "CONVERTED",
                            reason: `Converted via approved ${payment.planRequested} (${payment.billingCycle}) payment`,
                            metadata: { paymentId: payment.id, amountPaid: payment.amountPaid }
                        }
                    });
                }
            }

            // Cancel any PENDING trial since institute is now on a paid plan
            await tx.instituteTrial.updateMany({
                where: { instituteId: payment.instituteId, status: "PENDING" },
                data: { status: "CANCELLED" }
            });

            await enqueueOutboxEvent(tx, {
                eventType: "MEILISEARCH_SYNC_INSTITUTE",
                aggregateId: payment.instituteId,
                payload: { reason: "PAYMENT_APPROVED", paymentId: payment.id }
            });

            return { success: true };
        });

        if (!txResult.success) {
            return txResult;
        }

        // Best-effort immediate outbox flush (DB is already committed; retries handle downtime)
        try {
            await processOutboxEvents(5);
        } catch (syncError) {
            console.error("Best-effort outbox flush error after payment approval:", syncError);
        }

        revalidatePath("/af-ass-manage/payments");
        revalidatePath(`/af-ass-manage/payments/${paymentId}`);
        revalidatePath("/af-ass-manage");
        revalidatePath("/af-ass-manage/trials");
        revalidatePath(`/manager/${payment.instituteId}/subscription`);

        // 🔔 Notify Sales Manager & Admin about plan upgrade
        try {
            const { notifySalesManagerOnPlanUpgrade } = await import("@/lib/notifications/salesNotifications");
            await notifySalesManagerOnPlanUpgrade({
                instituteId: payment.instituteId,
                instituteName: payment.institute?.name,
                plan: payment.planRequested,
                amountPaid: payment.amountPaid,
            });
        } catch (e) {
            console.error("Sales manager plan upgrade notification error:", e);
        }

        return { success: true, message: "Payment approved and plan activated!" };
    }catch(err){
        console.error(err);
        return { success: false, error: "Failed to approve payment." };
    }
    
}

export async function rejectPayment(paymentId: string) {
    try{
          const payment = await prisma.subscriptionPayment.findUnique({
          where: { id: paymentId },
    });
        if (!payment) return { success: false, error: "Payment not found", statusCode: 404 };

        const transition = validatePaymentTransition(payment.status, "REJECTED");
        if (!transition.success) {
            return transition;
        }

        await prisma.subscriptionPayment.update({
            where: { id: paymentId },
            data: { status: PAYMENT_REJECTED_STATUS },
        });

        revalidatePath("/af-ass-manage/payments");
        revalidatePath(`/af-ass-manage/payments/${paymentId}`)
        revalidatePath("/af-ass-manage");
        return { success: true, message: "Payment rejected." };
    }catch(err){
        console.error(err);
        return { success: false, error: "Failed to reject payment." };
    }
  
}