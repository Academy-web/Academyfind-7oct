"use server"

import { prisma } from "../../prisma"
import { revalidatePath } from "next/cache"
import {
    CLAIM_APPROVED_STATUS,
    CLAIM_REJECTED_STATUS,
    validateClaimTransition,
} from "@/lib/institutes/institute-workflow"
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function getInstituteClaims () {
    try{
        const claims = await prisma.instituteClaim.findMany({
            include:{
                user:{select:{name:true,email:true,phone:true}},
                institute:{select:{name:true,address:true,phone:true}}
            },
            orderBy:{createdAt:"desc"}
        })
        return {success: true, data: claims}
    }catch(err){
        console.error("Error fetching claims:", err)
        return {success:false,error: "Failed to fetch claims"}
    }
}

export async function updateClaimStatus(claimId: string, status: "APPROVED" | "REJECTED"){
    try {
        const claim = await prisma.instituteClaim.findUnique({
            where:{id: claimId},
            include: { user: true, institute: true }
        })

        if(!claim){
            return { success: false, error: "Claim not found", statusCode: 404 }
        }

        const transition = validateClaimTransition(claim.status, status)
        if(!transition.success){
            return transition
        }

        if(status === "REJECTED"){
            await prisma.instituteClaim.update({
                where:{id:claimId},
                data:{status: CLAIM_REJECTED_STATUS}
            })
        }

        if(status === "APPROVED"){
            await prisma.$transaction([
                prisma.instituteClaim.update({
                    where: {id: claimId},
                    data:{status: CLAIM_APPROVED_STATUS}
                }),

                prisma.user.update({
                    where:{id:claim.userId},
                    data: {role: "INSTITUTE_MANAGER"}
                }),

                prisma.instituteManager.upsert({
                    where:{
                        userId_instituteId:{
                            userId:claim.userId,
                            instituteId:claim.instituteId
                        }
                    },
                    update:{},
                    create:{
                        userId:claim.userId,
                        instituteId:claim.instituteId
                    }
                }),

                prisma.instituteMembership.upsert({
                    where: {
                        userId_instituteId_role: {
                            userId: claim.userId,
                            instituteId: claim.instituteId,
                            role: 'MANAGER'
                        }
                    },
                    create: {
                        userId: claim.userId,
                        instituteId: claim.instituteId,
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
            ])

            // Also ensure institute channels exist and add manager
            const { ensureInstituteChannels } = await import("@/lib/chat/ensureInstituteChannels");
            await ensureInstituteChannels(claim.instituteId);
            
            const channels = await prisma.conversation.findMany({
                where: { instituteId: claim.instituteId, type: 'INSTITUTE' }
            });
            
            if (channels.length > 0) {
                await prisma.conversationParticipant.createMany({
                    data: channels.map((ch: any) => ({
                        conversationId: ch.id,
                        userId: claim.userId,
                        role: 'MANAGER' // manager is admin in channels
                    })),
                    skipDuplicates: true
                });
            }

            // Send Email to the new Manager & register PENDING trial with tokenized link for funnel tracking
            if (claim.user?.email) {
                try {
                    const { APPROVAL_WITH_TRIAL_SUBJECT, buildApprovalWithTrialEmailHtml } = await import("@/lib/notifications/trialEmails");
                    const { createOrReusePendingTrial, generateTrialToken } = await import("@/lib/subscription/trial");

                    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.academyfind.com";
                    const publicUrl = `${siteUrl}/institute/${claim.institute.id}-${claim.institute.slug || claim.institute.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                    const managerUrl = `${siteUrl}/manager/${claim.institute.id}`;

                    const { rawToken, tokenHash } = generateTrialToken();
                    const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                    const pendingRes = await createOrReusePendingTrial({
                        instituteId: claim.instituteId,
                        source: "NEW_CLAIM",
                        recipientEmail: claim.user.email,
                        tokenHash,
                        tokenExpiresAt,
                        markEmailSent: false,
                    });

                    const freeTrialUrl = pendingRes.success
                        ? `${siteUrl}/api/trial/open?token=${rawToken}`
                        : `${managerUrl}/subscription`;

                    await resend.emails.send({
                        from: "AcademyFind <no-reply@academyfind.com>",
                        to: claim.user.email,
                        subject: APPROVAL_WITH_TRIAL_SUBJECT,
                        html: buildApprovalWithTrialEmailHtml({
                            instituteName: claim.institute.name,
                            publicListingUrl: publicUrl,
                            managerDashboardUrl: managerUrl,
                            freeTrialUrl,
                        }),
                    });

                    if (pendingRes.success && pendingRes.trial) {
                        await prisma.instituteTrial.update({
                            where: { id: pendingRes.trial.id },
                            data: { emailSentAt: new Date() },
                        });
                    }

                    console.log(`Claim approval email sent to ${claim.user.email}`);
                } catch (emailError) {
                    console.error("Failed to send claim approval email:", emailError);
                }
            }
        }
        revalidatePath("/af-ass-manage/claims")
        revalidatePath("/af-ass-manage")
        revalidatePath("/profile")
        revalidatePath("/institute/[idSlug]")
        return { success: true, message: `Claim ${status.toLowerCase()} successfully!` }
    }catch(err){
        console.error("Error fetching claims:", err)
        return { success: false, error: "Something went wrong" }    }
}