export function getProductionBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl && !envUrl.includes("localhost")) {
    return envUrl.replace(/\/$/, "");
  }
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    !window.location.origin.includes("localhost")
  ) {
    return window.location.origin;
  }
  return "https://www.academyfind.com";
}

export function buildInstituteRequestLinks(institute: { id: string; name?: string | null; slug?: string | null }) {
  const baseUrl = getProductionBaseUrl();
  const instituteId = institute.id;
  const rawSlug = institute.slug || institute.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "";
  const slug = rawSlug.replace(/^-+|-+$/g, "");
  const publicListingUrl = slug ? `${baseUrl}/institute/${instituteId}-${slug}` : `${baseUrl}/institute/${instituteId}`;
  const managerDashboardUrl = `${baseUrl}/manager/${instituteId}`;
  const freeTrialUrl = `${baseUrl}/manager/${instituteId}/subscription`;
  return { publicListingUrl, managerDashboardUrl, freeTrialUrl, baseUrl };
}

export function buildInstituteRequestWhatsAppMessage(params: {
  managerName: string;
  instituteName: string;
  publicListingUrl: string;
  managerDashboardUrl: string;
  freeTrialUrl?: string;
}): string {
  const trialLink = params.freeTrialUrl || `${params.managerDashboardUrl.replace(/\/$/, "")}/subscription`;

  return `Hello ${params.instituteName}! 👋

Congratulations! Your institute has been successfully approved and is now live on *AcademyFind*.

🎓 *Your Institute Profile:*
${params.publicListingUrl}

🔐 *Manager Dashboard Login:*
${params.managerDashboardUrl}

With AcademyFind, you can do much more than just create an online listing!

Here are some key features you can explore:

✅ *Online Visibility:* Help students discover your institute through category, location-based searches and get countless leads.

✅ *Professional Profile:* Showcase your courses, batches, faculty, facilities, photos, achievements and results.

✅ *CRM & Enquiry Management:* Organise student enquiries, track leads, maintain enquiry history and manage follow-ups.

✅ *Student Connections:* Connect with prospective students and build meaningful relationships.

✅ *Reviews & Ratings:* Build credibility through student feedback.

✅ *Notice Board & Promotions:* Share admissions, new batches, offers and important announcements.

✅ *Community Features:* Engage with students and teachers through groups, forums and discussions.

✅ *Analytics & Enhanced Visibility:* Explore additional tools and promotional opportunities available through your subscription.

🎁 *EXCITING: Your 7-Day Free Trial!*

You can explore our one-week free subscription trial:

• No payment required.
• No credit/debit card details required.
• Available to institutes on the Basic plan.
• Activate it anytime from your Manager Dashboard.

👉 *Activate Your 7-Day Free Trial Here:*
${trialLink}

Simply log in to your Manager Dashboard, find the free subscription offer and activate your trial!

We encourage you to complete your institute profile and explore the platform to make the most of AcademyFind.

*Great education deserves to be discovered. Let students discover you!*

Warm regards,
*Team AcademyFind*
🌐 www.academyfind.com
📞 9045699938`;
}

export function formatWhatsAppNumber(phone?: string | null): string {
  if (!phone) return "";
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.length === 10) {
    cleaned = `91${cleaned}`;
  }
  return cleaned;
}

export function buildInstituteRequestWhatsAppUrl(params: {
  phone?: string | null;
  managerName: string;
  instituteName: string;
  publicListingUrl: string;
  managerDashboardUrl: string;
  freeTrialUrl?: string;
}): string {
  const waPhone = formatWhatsAppNumber(params.phone);
  if (!waPhone) return "";
  const message = buildInstituteRequestWhatsAppMessage(params);
  return `https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(message)}`;
}
