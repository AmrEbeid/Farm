import {
  ROOT_METADATA,
  ROOT_VIEWPORT,
} from "@/app/root-config";
import { PublicRootDocument } from "@/app/public-root-document";
import "../site.css";

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

export default function ArabicPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <PublicRootDocument lang="ar" dir="rtl">
      {children}
    </PublicRootDocument>
  );
}
