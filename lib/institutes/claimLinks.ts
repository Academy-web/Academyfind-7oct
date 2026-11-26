import { buildInstituteRequestWhatsAppMessage } from "@/lib/institutes/instituteRequestLinks";

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

export interface ClaimLinkInput {
  id?: string;
  instituteId?: string;
  fullName?: string | null;
  phone?: string | null;
  institute?: {
    id?: string;
    name?: string | null;
    slug?: string | null;
  } | null;
  user?: {
    name?: string | null;
  } | null;
}

export function buildApprovalLinks(claim: ClaimLinkInput) {
  const baseUrl = getProductionBaseUrl();
  const instituteId = claim.institute?.id || claim.instituteId || "";
  const rawSlug =
    claim.institute?.slug ||
    claim.institute?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ||
    "";
  const slug = rawSlug.replace(/^-+|-+$/g, "");

  const publicListingUrl = slug
    ? `${baseUrl}/institute/${instituteId}-${slug}`
    : `${baseUrl}/institute/${instituteId}`;
  const managerDashboardUrl = `${baseUrl}/manager/${instituteId}`;
  const freeTrialUrl = `${baseUrl}/manager/${instituteId}/subscription`;

  return { publicListingUrl, managerDashboardUrl, freeTrialUrl, baseUrl };
}

export function buildApprovalWhatsAppMessage(claim: ClaimLinkInput): string {
  const { publicListingUrl, managerDashboardUrl, freeTrialUrl } = buildApprovalLinks(claim);
  const managerName = claim.fullName || claim.user?.name || "Manager";
  const instituteName = claim.institute?.name || "Your Institute";

  return buildInstituteRequestWhatsAppMessage({
    managerName,
    instituteName,
    publicListingUrl,
    managerDashboardUrl,
    freeTrialUrl,
  });
}

export function buildApprovalWhatsAppUrl(claim: ClaimLinkInput): string {
  const waPhone = formatWhatsAppNumber(claim.phone);
  if (!waPhone) return "";
  const message = buildApprovalWhatsAppMessage(claim);
  return `https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(message)}`;
}
