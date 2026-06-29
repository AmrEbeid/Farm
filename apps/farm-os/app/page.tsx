import Link from "next/link";
import { Button } from "@/components/ui";

// Public, unauthenticated landing — Direction A ("The Registry") prototype.
// The hero states the product's thesis (the stock-coverage wedge); the hawsha
// grid is an ABSTRACT brand motif, not a data display. Per non-negotiable #1
// (never fabricate farm data) this page shows NO farm figures — real KPIs live
// behind auth on the role dashboards, each from a live org-scoped query.

// Decorative signature cells. A handful are accented (active / watch) purely to
// hint at the registry's status tracking — they assert no real count or state.
const ACCENT: Record<number, "active" | "watch"> = {
  3: "active",
  9: "watch",
  12: "active",
  18: "active",
  21: "watch",
  25: "active",
};

export default function Home() {
  return (
    <main className="landing">
      <div className="landing__inner">
        <section className="landing__hero">
          <p className="landing__eyebrow">نظام تشغيل المزارع · نخيل البلح والفاكهة</p>

          <h1 className="landing__title">
            اعرف نقص مخزونك{" "}
            <span className="landing__title-accent">قبل</span> أن تقف في الغيط.
          </h1>

          <p className="landing__lede">
            من الخطة إلى تغطية المخزون إلى اعتماد الصرف — حلقة واحدة تربط ما تنوي
            تنفيذه بما يكفيك فعلاً من السماد والخامات، حوشة بحوشة.
          </p>

          <div className="landing__cta">
            <Link href="/login">
              <Button variant="primary">تسجيل الدخول</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="ghost">لوحة التحكم</Button>
            </Link>
          </div>

          <ul className="landing__pillars">
            <li>
              <span>التخطيط</span> خطة أسبوعية بعملياتها وكمياتها
            </li>
            <li>
              <span>تغطية المخزون</span> إنذار النفاد قبل الوصول للحقل
            </li>
            <li>
              <span>الموازنة والاعتماد</span> صرف محكوم بحدودٍ معتمدة
            </li>
          </ul>
        </section>

        <aside className="landing__signature" aria-hidden="true">
          <div className="hawsha-grid">
            {Array.from({ length: 28 }, (_, i) => (
              <span key={i} data-state={ACCENT[i]} />
            ))}
          </div>
          <p className="landing__signature-label">
            الحوشة — وحدة الإدارة والمتابعة في المزرعة
          </p>
        </aside>
      </div>
    </main>
  );
}
