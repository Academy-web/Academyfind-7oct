"use server"
import { prisma } from "@/lib/prisma";
import { v2 as cloudinary } from "cloudinary"
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
function generateSlug(name: string) {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

export async function findOrCreateCity(input: {
    name: string;
    state: string;
    country?: string;
    latitude?: number | null;
    longitude?: number | null;
}) {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });

        if (!session?.user) {
            return { success: false as const, error: "Please sign in to select a city." };
        }

        const name = input.name?.trim();
        const state = input.state?.trim() || "India";
        const country = input.country?.trim() || "India";

        if (!name || name.length > 100) {
            return { success: false as const, error: "Valid city name is required." };
        }

        // 1. Check if city already exists with same name & state (case-insensitive)
        const existingByNameAndState = await prisma.city.findFirst({
            where: {
                name: { equals: name, mode: "insensitive" },
                state: { equals: state, mode: "insensitive" },
            },
            select: { id: true, name: true, slug: true, state: true },
        });

        if (existingByNameAndState) {
            return { success: true as const, city: existingByNameAndState, created: false };
        }

        // 2. Check if slug already exists
        const baseSlug = generateSlug(name) || `city-${Date.now()}`;
        const existingBySlug = await prisma.city.findUnique({
            where: { slug: baseSlug },
            select: { id: true, name: true, slug: true, state: true },
        });

        if (
            existingBySlug &&
            existingBySlug.state.toLowerCase() === state.toLowerCase()
        ) {
            return { success: true as const, city: existingBySlug, created: false };
        }

        // 3. Ensure unique slug if another state already uses baseSlug
        let slug = baseSlug;
        if (existingBySlug) {
            const stateSlug = generateSlug(state);
            slug = stateSlug ? `${baseSlug}-${stateSlug}` : `${baseSlug}-1`;
            let collision = await prisma.city.findUnique({ where: { slug } });
            let counter = 1;
            while (collision) {
                slug = `${baseSlug}-${counter}`;
                collision = await prisma.city.findUnique({ where: { slug } });
                counter++;
            }
        }

        const latitude =
            typeof input.latitude === "number" && !Number.isNaN(input.latitude)
                ? input.latitude
                : null;
        const longitude =
            typeof input.longitude === "number" && !Number.isNaN(input.longitude)
                ? input.longitude
                : null;

        const newCity = await prisma.city.create({
            data: {
                name,
                slug,
                state,
                country,
                latitude,
                longitude,
            },
            select: { id: true, name: true, slug: true, state: true },
        });

        revalidatePath("/user/create-institute");
        revalidatePath("/cities");

        return { success: true as const, city: newCity, created: true };
    } catch (error) {
        console.error("findOrCreateCity Error:", error);
        return { success: false as const, error: "Failed to save selected city." };
    }
}

async function uploadImageToCloudinary(file: File, folderName: string, idPrefix: string) {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    // Cloudinary SDK requires a Data URI for buffers
    const dataUri = `data:${file.type};base64,${buffer.toString('base64')}`;

    const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: `academyfind/${folderName}`,
        public_id: `${idPrefix}-${Date.now()}`, 
        overwrite: true,
        format: "webp", 
    });

    return uploadResult.secure_url;
}

export async function addInstitute(userId: string, formData: FormData,selectedCategoryIds: string[]){
    try{
        // Apply Rate Limiting: Max 3 joins per 5 minutes per IP
        const rateLimit = await checkRateLimit("addInstitute", 3, 5 * 60 * 1000);
        if (!rateLimit.success) {
            return { success: false, error: rateLimit.message };
        }
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const phone = formData.get("phone") as string;
        const email = formData.get("email") as string;
        const website = formData.get("website") as string;
        const feeInfo = formData.get("feeInfo") as string;
        const address = formData.get("address") as string;
        const googleMapsUrl = formData.get("googleMapsUrl") as string;
        const cityId = formData.get("cityId") as string;
        const imageFile = formData.get("imageFile") as File;
        const ownerName = (formData.get("ownerName") as string)?.trim();
        const ownerPhone = (formData.get("ownerPhone") as string)?.trim();
        const ownerDesignation = (formData.get("ownerDesignation") as string)?.trim();
        const providerType = (formData.get("providerType") as string) === "INDIVIDUAL" ? "INDIVIDUAL" : "INSTITUTE";

        const latitude = formData.get("latitude") ? parseFloat(formData.get("latitude") as string) : null;
        const longitude = formData.get("longitude") ? parseFloat(formData.get("longitude") as string) : null;

        if (!name || !cityId || !address || !ownerName || !ownerPhone || !ownerDesignation) {
            return { success: false, error: "Institute and owner details are required." };
        }

        let slug = generateSlug(name);
        let existing = await prisma.institute.findFirst({ where: { slug } });
        let counter = 1;
        while (existing) {
            slug = `${generateSlug(name)}-${counter}`;
            existing = await prisma.institute.findFirst({ where: { slug } });
            counter++;
        }

        let secureUrl = null;
        if (imageFile && imageFile.size > 0) {
            // Humne ID pehle nahi banayi, isliye slug+timestamp ka use kar rahe image ke naam ke liye
            secureUrl = await uploadImageToCloudinary(imageFile, "institutes", `inst-${slug}-${Date.now()}`);
        }

        // Transaction to create Institute AND link categories
        const newInstitute = await prisma.$transaction(async (tx) => {
            const institute = await tx.institute.create({
                data: {
                    name, slug, description, phone, email, website, address, feeInfo,
                    googleMapsUrl, cityId, latitude, longitude,
                    providerType,
                    isActive: false,
                    subscriptionPlan: "BASIC",
                    imageUrl: secureUrl
                }
            });

            if (selectedCategoryIds.length > 0) {
                await tx.instituteCategory.createMany({
                    data: selectedCategoryIds.map(catId => ({
                        instituteId: institute.id,
                        categoryId: catId
                    }))
                });
            }

            await tx.adminNotification.create({
                data: {
                    type: "NEW_INSTITUTE_REQUEST",
                    title: "New Institute Request",
                    message: `${name} has been requested by ${ownerName} (${ownerDesignation}) to be added as a new institute.`,
                }
            });

            // await tx.instituteManager.create({
            //     data: { userId, instituteId: institute.id }
            // });

            await tx.instituteRequest.create({
                data: {
                    userId: userId,
                    instituteId: institute.id,
                    ownerName,
                    ownerPhone,
                    ownerDesignation,
                    status: "PENDING"
                }
            });

            await tx.user.update({
                where: { id: userId },
                data: { canAddInstitute: false }
            });

            return institute;
        });

        revalidatePath("/user/create-institute");
        return { success: true, message: "Institute created successfully!", id: newInstitute.id, slug: slug };
    } catch (error) {
        console.error("Create Institute Error:", error);
        return { success: false, error: "Failed to create institute." };
    }
}


export async function addImage(instituteId: string, imageFile: File) {
    try {
        if (!imageFile || imageFile.size === 0) return { success: false, error: "No image found." };

        const secureUrl = await uploadImageToCloudinary(imageFile, "results", `inst-${instituteId}-res`);

        await prisma.institute.update({
            where: { id: instituteId },
            data: { imageUrl: secureUrl  }
        });

        revalidatePath(`/user/create-institute`,'layout');
        return { success: true, message: "Result image uploaded!" };
    } catch (error) {
        return { success: false, error: "Failed to upload image." };
    }
}