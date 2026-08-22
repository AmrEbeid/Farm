import { describe, expect, it } from "vitest";
import { validateMarketingRecordInput } from "./validate-record";

describe("validateMarketingRecordInput", () => {
  it("rejects a blank title", () => {
    const result = validateMarketingRecordInput("quality_batch", {
      title: "  ",
      payload: { batchRef: "B-1" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("العنوان مطلوب.");
  });

  it("rejects a non-finite amount", () => {
    const result = validateMarketingRecordInput("quality_batch", {
      title: "دفعة",
      payload: { batchRef: "B-1" },
      amount: Number.POSITIVE_INFINITY,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("القيمة يجب أن تكون رقمًا صحيحًا.");
  });

  it("rejects a non-finite numeric payload value", () => {
    const result = validateMarketingRecordInput("weekly_availability", {
      title: "توفر",
      payload: { week: "2026-08-01", tons: Number.NaN },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("tons");
  });

  it("requires batchRef for quality_batch", () => {
    const result = validateMarketingRecordInput("quality_batch", {
      title: "دفعة",
      payload: { grade: "A" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("حقل مرجع الدفعة مطلوب.");
  });

  it("requires week for weekly_availability", () => {
    const result = validateMarketingRecordInput("weekly_availability", {
      title: "توفر",
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("حقل الأسبوع مطلوب.");
  });

  it("requires commodity and market for price_observation", () => {
    const missingMarket = validateMarketingRecordInput("price_observation", {
      title: "سعر",
      payload: { commodity: "برحي" },
    });
    expect(missingMarket.ok).toBe(false);
    expect(missingMarket.error).toBe("حقل السوق مطلوب.");

    const missingBoth = validateMarketingRecordInput("price_observation", {
      title: "سعر",
      payload: {},
    });
    expect(missingBoth.ok).toBe(false);
    expect(missingBoth.error).toBe("حقل السلعة مطلوب.");
  });

  it("requires body for message_template", () => {
    const result = validateMarketingRecordInput("message_template", {
      title: "قالب",
      payload: { channel: "whatsapp" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("حقل نص القالب مطلوب.");
  });

  it("accepts a valid record for each gated record type", () => {
    expect(
      validateMarketingRecordInput("quality_batch", { title: "دفعة", payload: { batchRef: "B-1" } }).ok,
    ).toBe(true);
    expect(
      validateMarketingRecordInput("weekly_availability", {
        title: "توفر",
        payload: { week: "2026-08-01" },
      }).ok,
    ).toBe(true);
    expect(
      validateMarketingRecordInput("price_observation", {
        title: "سعر",
        payload: { commodity: "برحي", market: "الرياض" },
      }).ok,
    ).toBe(true);
    expect(
      validateMarketingRecordInput("message_template", {
        title: "قالب",
        payload: { body: "نص الرسالة" },
      }).ok,
    ).toBe(true);
  });

  it("does not require payload keys for record types without a required-field mapping", () => {
    const result = validateMarketingRecordInput("competitor", { title: "منافس", payload: {} });
    expect(result.ok).toBe(true);
  });

  it("requires the editable keys for full-source record types", () => {
    expect(validateMarketingRecordInput("freight_reference", { title: "شحن", payload: {} }).ok).toBe(false);
    expect(validateMarketingRecordInput("daily_sales_report", { title: "يومي", payload: {} }).ok).toBe(false);
    expect(validateMarketingRecordInput("freight_reference", { title: "شحن", payload: { rate: 0.6 } }).ok).toBe(true);
    expect(validateMarketingRecordInput("daily_sales_report", {
      title: "يومي",
      payload: { date: "2026-08-22" },
    }).ok).toBe(true);
  });

  it("rejects a non-object payload", () => {
    const result = validateMarketingRecordInput("competitor", {
      title: "منافس",
      payload: "not an object",
    });
    expect(result.ok).toBe(false);
  });
});
