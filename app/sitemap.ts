import type { MetadataRoute } from "next";
import { listShulsForLookup } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://tfila.co";
  const now = new Date();

  const shuls = await listShulsForLookup();

  return [
    { url: baseUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    {
      url: `${baseUrl}/find`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/submit`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/bot`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...shuls.map((s) => ({
      url: `${baseUrl}/shul/${s.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
