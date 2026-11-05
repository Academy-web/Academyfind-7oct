import { prisma } from '@/lib/prisma';

export const revalidate = 86400; // Cache sitemap index for 24 hours

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://academyfind.com';

  const [totalInstitutes, latestInstitute, latestBlog] = await Promise.all([
    prisma.institute.count({
      where: { isActive: true, isPublished: true } 
    }),
    prisma.institute.findFirst({
      where: { isActive: true, isPublished: true },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true }
    }),
    prisma.blogPost.findFirst({
      where: { status: 'PUBLISHED' },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true }
    })
  ]);
  
  const instituteLastmod = latestInstitute?.updatedAt 
    ? latestInstitute.updatedAt.toISOString() 
    : undefined;
  const blogLastmod = latestBlog?.updatedAt 
    ? latestBlog.updatedAt.toISOString() 
    : undefined;

  const limit = 6000; 
  const totalPages = Math.ceil(totalInstitutes / limit);

  let instituteSitemaps = '';
  for (let i = 0; i < totalPages; i++) {
    instituteSitemaps += `
  <sitemap>
    <loc>${baseUrl}/sitemap-institutes/${i}</loc>${instituteLastmod ? `\n    <lastmod>${instituteLastmod}</lastmod>` : ''}
  </sitemap>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${baseUrl}/sitemap-static.xml</loc>
  </sitemap>
  <sitemap>
    <loc>${baseUrl}/sitemap-categories-city.xml</loc>
  </sitemap>
  <sitemap>
    <loc>${baseUrl}/sitemap-blogs.xml</loc>${blogLastmod ? `\n    <lastmod>${blogLastmod}</lastmod>` : ''}
  </sitemap>
  ${instituteSitemaps}
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'text/xml',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate',
    },
  });
}
