import {
  RootDocument,
  ROOT_METADATA,
  ROOT_VIEWPORT,
} from "@/app/root-document";

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

export default function EnglishPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootDocument lang="en" dir="ltr">
      {children}
    </RootDocument>
  );
}
