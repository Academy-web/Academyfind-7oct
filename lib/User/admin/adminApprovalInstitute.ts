"use server"

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { syncSingleInstituteToMeili } from '@/scripts/SyncInstitute';
import { meili } from "@/lib/meilisearch";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

import {
    buildInstituteRequestLinks,
    buildInstituteRequestWhatsAppMessage,
} from "@/lib/institutes/instituteRequestLinks";

export { buildInstituteRequestLinks, buildInstituteRequestWhatsAppMessage };

export async function sendInstituteRequestApprovalEmail(params: {
    toEmail: string;
    managerName: string;
    instituteName: string;
    publicListingUrl: string;
    managerDashboardUrl: string;
}) {
    try {
        const { APPROVAL_WITH_TRIAL_SUBJECT, buildApprovalWithTrialEmailHtml } = await import("@/lib/notifications/trialEmails");
        await resend.emails.send({
            from: "AcademyFind <no-reply@academyfind.com>",
            to: params.toEmail,
            subject: APPROVAL_WITH_TRIAL_SUBJECT,
            html: buildApprovalWithTrialEmailHtml({
                instituteName: params.instituteName,
                publicListingUrl: params.publicListingUrl,
                managerDashboardUrl: params.managerDashboardUrl,
            }),
        });
        console.log(`Institute Request approval email sent successfully to ${params.toEmail}`);
    } catch (emailError) {
        console.error("Failed to send institute request approval email:", emailError);
    }
}

export async function approveInstituteRequest(requestId: string) {
    try {
        const request = await prisma.instituteRequest.findUnique({
            where: { id: requestId },
            include: { institute: true, user: { select: { email: true, name: true, phone: true } } }
        });

        if (!request) return { success: false, error: "Request record not found." };
        if (request.status !== "PENDING") {
            return { success: false, error: `Request already ${request.status.toLowerCase()}.` };
        }

        const transactionOperations: any[] = [
            prisma.institute.update({
                where: { id: request.instituteId },
                data: {
                    isActive: true,
                    isPublished: true,
                    subscriptionPlan: "BASIC",
                    planWeight: 1
                }
            }),
            prisma.instituteRequest.update({
                where: { id: requestId },
                data: { status: "APPROVED" }
            }),
            prisma.user.update({
                where: { id: request.userId },
                data: {
                    canAddInstitute: true,
                    role: "INSTITUTE_MANAGER"
                }
            }),
            prisma.instituteManager.upsert({
                where: {
                    userId_instituteId: {
                        userId: request.userId,
                        instituteId: request.instituteId
                    }
                },
                update: {},
                create: {
                    userId: request.userId,
                    instituteId: request.instituteId
                }
            }),
            prisma.instituteMembership.upsert({
                where: {
                    userId_instituteId_role: {
                        userId: request.userId,
                        instituteId: request.instituteId,
                        role: 'MANAGER'
                    }
                },
                create: {
                    userId: request.userId,
                    instituteId: request.instituteId,
                    role: 'MANAGER',
                    status: 'ACTIVE',
                    joinedAt: new Date(),
                    isActive: true
                },
                update: {
                    status: 'ACTIVE',
                    joinedAt: new Date(),
                    isActive: true
                }
            })
        ];

        // DB Transaction execute
        await prisma.$transaction(transactionOperations);

        // Also ensure institute channels exist and add manager
        const { addMemberToInstituteChannels } = await import("@/lib/chat/ensureInstituteChannels");
        await addMemberToInstituteChannels(request.userId, request.instituteId, "MANAGER");

        console.log(`Institute ${request.instituteId} approved, Syncing to Meilisearch...`);

        const syncresult = await syncSingleInstituteToMeili(request.instituteId);
        if (!syncresult.success) {
            console.error("Database updated but MeiliSync Error:", syncresult.error);
        }

        revalidatePath("/af-ass-manage/instituteRequests");
        revalidatePath("/af-ass-manage");

        // 🔔 Notify Sales Manager & Admin if this institute is assigned
        try {
            const { notifySalesManagerOnInstituteClaim } = await import("@/lib/notifications/salesNotifications");
            await notifySalesManagerOnInstituteClaim({
                instituteId: request.instituteId,
                instituteName: request.institute.name,
                ownerName: request.user?.name || request.ownerName || undefined,
            });
        } catch (e) {
            console.error("Sales manager claim notification error:", e);
        }

        const { publicListingUrl, managerDashboardUrl } = buildInstituteRequestLinks(request.institute);
        const managerName = request.ownerName || request.user?.name || "Manager";
        const instituteName = request.institute.name;
        const targetEmail = request.user?.email || request.institute.email;
        const targetPhone = request.ownerPhone || request.user?.phone || request.institute.phone;

        // Send Email to the Manager & register PENDING trial for funnel tracking
        if (targetEmail) {
            await sendInstituteRequestApprovalEmail({
                toEmail: targetEmail,
                managerName,
                instituteName,
                publicListingUrl,
                managerDashboardUrl,
            });
            try {
                const { createOrReusePendingTrial } = await import("@/lib/subscription/trial");
                await createOrReusePendingTrial({
                    instituteId: request.instituteId,
                    source: "NEW_REQUEST",
                    recipientEmail: targetEmail,
                    markEmailSent: true,
                });
            } catch (trialErr) {
                console.error("Failed to create pending trial on institute approval:", trialErr);
            }
        }

        const waMessage = buildInstituteRequestWhatsAppMessage({
            managerName,
            instituteName,
            publicListingUrl,
            managerDashboardUrl,
        });

        return {
            success: true,
            message: "Institute Approved & Assigned to Manager (Basic Plan)!",
            publicListingUrl,
            managerDashboardUrl,
            managerName,
            instituteName,
            phone: targetPhone,
            waMessage,
        };
    } catch (error) {
        console.error("Approval action error:", error);
        return { success: false, error: "Approval pipeline failed." };
    }
}

export async function rejectInstituteRequest(requestId: string) {
    try {
        const request = await prisma.instituteRequest.findUnique({
            where: { id: requestId }
        });

        if (!request) return { success: false, error: "Request not found." };
        if (request.status !== "PENDING") {
            return { success: false, error: `Request already ${request.status.toLowerCase()}.` };
        }

        await prisma.$transaction([
            prisma.instituteRequest.update({
                where: { id: requestId },
                data: { status: "REJECTED" }
            }),
            prisma.user.update({
                where: { id: request.userId },
                data: { canAddInstitute: true }
            })
        ]);

        try {
            const index = meili.index("global_search");
            const documentId = `inst-${request.instituteId}`;
            // Background cleanup bina product blocking ke
            await index.deleteDocument(documentId);
            console.log(`🗑️ Sent remove request for unapproved institute ${documentId} to Meilisearch.`);
        } catch (meiliError) {
            console.error("Failed to delete rejected institute from Meilisearch:", meiliError);
        }

        revalidatePath("/af-ass-manage/instituteRequests");
        revalidatePath("/af-ass-manage");
        return { success: true, message: "Request rejected successfully." };
    } catch (error) {
        console.error("Rejection action error:", error);
        return { success: false, error: "Rejection pipeline failed." };
    }
}
