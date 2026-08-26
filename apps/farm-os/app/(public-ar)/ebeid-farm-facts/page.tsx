import { PublicSiteRoute, generatePublicSitePageMetadata } from "@/components/site/PublicSiteRoute";

export const revalidate = 300;
export const generateMetadata = () => generatePublicSitePageMetadata("ar", "farmFacts");

export default function Page() {
  return <PublicSiteRoute lang="ar" page="farmFacts" />;
}
