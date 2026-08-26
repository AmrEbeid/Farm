import { PublicSiteRoute, generatePublicSitePageMetadata } from "@/components/site/PublicSiteRoute";

export const revalidate = 300;
export const generateMetadata = () => generatePublicSitePageMetadata("en", "chinaSupply");

export default function Page() {
  return <PublicSiteRoute lang="en" page="chinaSupply" />;
}
