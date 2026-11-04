import { connection } from "next/server";
import { siteUrl } from "@/lib/site";

export default async function robots() {
  await connection();
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
