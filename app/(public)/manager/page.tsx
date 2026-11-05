import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";
import { ArrowRight, Badge, Building2, MapPin, Clock, Lock } from "lucide-react";
import { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HubSectionManager } from "@/components/hubs/HubSectionManager";

export const metadata: Metadata = {
  title: "Manager Control Panel | AcademyFind",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ManagerRootPage() {
    const session = await auth.api.getSession({
        headers: await headers()
    })

    if (!session) {
        redirect('/login');
    }

    if (session.user.role !== "INSTITUTE_MANAGER" && session.user.role !== "ADMIN") {
        redirect('/');
    }

    const managedInstitutes = await prisma.instituteManager.findMany({
        where: {
            userId: session.user.id
        },
        include: {
            institute: {
                include: {
                    city: true,
                    categories: true,
                }
            }
        }
    })

    if (managedInstitutes.length === 0 && session.user.role !== "ADMIN") {
        return (
            <div className="min-h-[60vh] flex items-center justify-center p-4">
                <Card className="max-w-md w-full text-center p-6 border-dashed shadow-sm">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Building2 className="w-8 h-8 text-slate-400" />
                    </div>
                    <CardTitle className="mb-2">No Claimed Institutes</CardTitle>
                    <CardDescription className="mb-6">
                        You do not have manager access to any institutes yet. If you recently claimed a profile, please wait for admin approval.
                    </CardDescription>
                    <Link href="/" className="text-blue-600 font-medium hover:underline text-sm">
                        Return to Homepage
                    </Link>
                </Card>
            </div>
        )
    }

    // 🚀 ALAG ALAG LISTS BANAYI HAIN
    const activeInstitutes = managedInstitutes.filter(m => m.institute.isActive);
    const pendingInstitutes = managedInstitutes.filter(m => !m.institute.isActive);

    const managedInstituteIds = managedInstitutes.map((m) => m.institute.id);

    // Fetch hubs created by this manager or where their institutes belong
    const hubs = await prisma.instituteHub.findMany({
        where: {
            OR: [
                { createdById: session.user.id },
                {
                    institutes: {
                        some: {
                            instituteId: { in: managedInstituteIds }
                        }
                    }
                }
            ]
        },
        include: {
            institutes: {
                include: {
                    institute: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            logo: true,
                            imageUrl: true,
                            city: { select: { name: true } }
                        }
                    }
                }
            }
        },
        orderBy: { updatedAt: "desc" }
    });

    const managedOptions = managedInstitutes.map((m) => ({
        id: m.institute.id,
        name: m.institute.name,
        slug: m.institute.slug,
        logo: m.institute.logo,
        imageUrl: m.institute.imageUrl,
        cityName: m.institute.city?.name || "Unknown City",
        isActive: m.institute.isActive,
    }));

    return (
        <div className="container mx-auto max-w-5xl py-12 px-4 space-y-12">
            
            {/* 🟢 ACTIVE WORKSPACES SECTION */}
            {activeInstitutes.length > 0 && (
                <div>
                    <div className="mb-6">
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Active Workspaces</h1>
                        <p className="text-slate-500 mt-2">You manage multiple academies. Choose one to view its dashboard.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {activeInstitutes.map(({ institute }) => (
                            <Link key={institute.id} href={`/manager/${institute.id}/profile`}>
                                <Card className="h-full rounded-2xl border-slate-200 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group bg-white">
                                    <CardHeader className="pb-3">
                                        <div className="flex justify-between items-start gap-4">
                                            <CardTitle className="text-lg leading-tight group-hover:text-blue-700 transition-colors">
                                                {institute.name}
                                            </CardTitle>
                                            <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0 border border-emerald-100">
                                                Live
                                            </span>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="flex items-center text-xs text-slate-500 mb-4">
                                            <MapPin className="w-3.5 h-3.5 mr-1" />
                                            {institute.city?.name}
                                        </div>
                                        <div className="flex items-center text-sm font-semibold text-blue-600">
                                            Manage Profile <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {/* 🟡 NETWORK HUBS & CENTERS */}
            <div className="border-t border-slate-200 pt-10">
                <HubSectionManager
                    hubs={hubs}
                    managedInstitutes={managedOptions}
                    currentUserId={session.user.id}
                />
            </div>

            {/* 🟠 UNDER VERIFICATION SECTION */}
            {pendingInstitutes.length > 0 && (
                <div>
                    <div className="mb-6 border-t border-slate-200 pt-8">
                        <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                            <Clock className="w-6 h-6 text-amber-500" /> Pending Verification
                        </h2>
                        <p className="text-slate-500 mt-2 text-sm">These institutes are currently being reviewed by the admin team. Dashboard access will unlock upon approval.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {pendingInstitutes.map(({ institute }) => (
                            <Card key={institute.id} className="h-full rounded-2xl border-slate-200 bg-slate-50/50 cursor-not-allowed opacity-90 relative overflow-hidden">
                                
                                {/* Overlay pattern for locked feel */}
                                <div className="absolute inset-0 bg-slate-100/30 pointer-events-none"></div>

                                <CardHeader className="pb-3 relative z-10">
                                    <div className="flex justify-between items-start gap-4">
                                        <CardTitle className="text-lg leading-tight text-slate-600">
                                            {institute.name}
                                        </CardTitle>
                                        <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0 border border-amber-200 flex items-center gap-1">
                                            <Lock className="w-3 h-3" /> Under Review
                                        </span>
                                    </div>
                                </CardHeader>
                                <CardContent className="relative z-10">
                                    <div className="flex items-center text-xs text-slate-400 mb-4">
                                        <MapPin className="w-3.5 h-3.5 mr-1" />
                                        {institute.city?.name}
                                    </div>
                                    <div className="flex items-center text-xs font-semibold text-slate-400">
                                        Access Locked until verified
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}
            
        </div>
    );
}
