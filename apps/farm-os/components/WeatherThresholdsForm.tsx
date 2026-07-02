"use client";

import { useState } from "react";
import { Button, Field, Input, Alert } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { updateWeatherThresholds } from "@/app/(app)/weather/thresholds/actions";
import type { WeatherThresholds } from "@/lib/weather";

/**
 * Owner/farm_manager editor for the weather-gate thresholds (SPEC-0007 §3). Mirrors SettingsForm's
 * shape (controlled string inputs, saved via a server action, field-safe Arabic error surface).
 * Values are plain numeric inputs — never rendered through `num()`/`fmtDate()` because these ARE the
 * raw editable configuration, not a display of a computed/money value.
 */
export function WeatherThresholdsForm({ thresholds }: { thresholds: WeatherThresholds }) {
  const [sprayMaxWindKph, setSprayMaxWindKph] = useState(String(thresholds.sprayMaxWindKph));
  const [pollinateMaxRainMm, setPollinateMaxRainMm] = useState(String(thresholds.pollinateMaxRainMm));
  const [pollinateMaxWindKph, setPollinateMaxWindKph] = useState(String(thresholds.pollinateMaxWindKph));
  const [harvestMaxRainMm, setHarvestMaxRainMm] = useState(String(thresholds.harvestMaxRainMm));
  const [heatStressC, setHeatStressC] = useState(String(thresholds.heatStressC));
  const [frostBelowC, setFrostBelowC] = useState(String(thresholds.frostBelowC));
  const { pending, submit } = useSubmit();
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await submit(() =>
      updateWeatherThresholds({
        sprayMaxWindKph: Number(sprayMaxWindKph),
        pollinateMaxRainMm: Number(pollinateMaxRainMm),
        pollinateMaxWindKph: Number(pollinateMaxWindKph),
        harvestMaxRainMm: Number(harvestMaxRainMm),
        heatStressC: Number(heatStressC),
        frostBelowC: Number(frostBelowC),
      }),
    );
    setMsg(
      r.ok
        ? { tone: "ok", text: "تم حفظ عتبات الطقس" }
        : { tone: "danger", text: r.error ?? "تعذّر الحفظ" },
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <Alert
        tone="info"
        title="قوالب استرشادية قابلة للتعديل"
        description="هذه العتبات تحدد متى تظهر تنبيهات الطقس على الخطط والتنفيذ؛ استرشادية فقط وبانتظار اعتماد المهندس الزراعي — لا تُستخدم كوقف إلزامي."
      />
      <Field label="أقصى رياح للرش (كم/س)" id="wt-spray-wind">
        <Input
          id="wt-spray-wind"
          type="number"
          min={0}
          step="1"
          value={sprayMaxWindKph}
          onChange={(e) => setSprayMaxWindKph(e.target.value)}
          required
        />
      </Field>
      <Field label="أقصى أمطار للتلقيح (مم)" id="wt-pollinate-rain">
        <Input
          id="wt-pollinate-rain"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.1"
          value={pollinateMaxRainMm}
          onChange={(e) => setPollinateMaxRainMm(e.target.value)}
          required
        />
      </Field>
      <Field label="أقصى رياح للتلقيح (كم/س)" id="wt-pollinate-wind">
        <Input
          id="wt-pollinate-wind"
          type="number"
          min={0}
          step="1"
          value={pollinateMaxWindKph}
          onChange={(e) => setPollinateMaxWindKph(e.target.value)}
          required
        />
      </Field>
      <Field label="أقصى أمطار للحصاد (مم)" id="wt-harvest-rain">
        <Input
          id="wt-harvest-rain"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.1"
          value={harvestMaxRainMm}
          onChange={(e) => setHarvestMaxRainMm(e.target.value)}
          required
        />
      </Field>
      <Field label="حد الإجهاد الحراري (°م)" id="wt-heat">
        <Input
          id="wt-heat"
          type="number"
          step="1"
          value={heatStressC}
          onChange={(e) => setHeatStressC(e.target.value)}
          required
        />
      </Field>
      <Field label="حد خطر الصقيع (°م، أقل من)" id="wt-frost">
        <Input
          id="wt-frost"
          type="number"
          step="1"
          value={frostBelowC}
          onChange={(e) => setFrostBelowC(e.target.value)}
          required
        />
      </Field>
      {msg && <Alert tone={msg.tone} title={msg.text} />}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ العتبات"}
        </Button>
      </div>
    </form>
  );
}
