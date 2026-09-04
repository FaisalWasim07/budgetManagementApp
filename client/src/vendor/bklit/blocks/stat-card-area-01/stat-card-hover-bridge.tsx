"use client";

import { useChart } from "../../charts/index.js";
import { useEffect } from "react";

// Vendored from bklit-ui c57f66b,
// packages/ui/registry/blocks/stat-card-area-01/components/stat-card-hover-bridge.tsx.
// Two edits, both forced by the fact that Bayt is not a shadcn project — see
// ../../README.md for the same reasoning behind charts/index.js:
//
//   1. `useChart` came from "@/components/charts", the path shadcn's CLI would
//      have written. Bayt's barrel is ../../charts/index.js.
//   2. `StatCardHoverState` was imported (and re-exported) from
//      ./stat-card-chart, the block's other file. That file is nothing but
//      Tailwind layout classes for bleeding the chart to the card's edges,
//      which Bayt already does in its own `.kpi .mini` CSS, so it was not
//      copied and the interface is declared here instead. It is a type: the
//      build strips it either way.
//
// Everything below the interface is byte-exact.
export interface StatCardHoverState {
  value: number | null;
  label: string | null;
  trend: number | null;
}

export function formatStatCardMonth(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short" });
}

export function formatStatCardWeekday(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function parsePointDate(raw: unknown): Date | null {
  if (raw instanceof Date) {
    return raw;
  }
  if (typeof raw === "string") {
    return new Date(raw);
  }
  return null;
}

function computePeriodTrend(
  data: Record<string, unknown>[],
  index: number,
  dataKey: string
): number | null {
  if (index <= 0) {
    return null;
  }

  const current = data[index]?.[dataKey];
  const previous = data[index - 1]?.[dataKey];

  if (
    typeof current !== "number" ||
    typeof previous !== "number" ||
    previous === 0
  ) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

/** Syncs hovered chart values, labels, and trend into stat card UI. */
export function StatCardHoverBridge({
  dataKey,
  dateKey = "date",
  formatLabel,
  onHoverChange,
}: {
  dataKey: string;
  dateKey?: string;
  formatLabel: (date: Date) => string;
  onHoverChange: (state: StatCardHoverState) => void;
}) {
  const { data, tooltipData } = useChart();

  useEffect(() => {
    if (!tooltipData?.point) {
      onHoverChange({ value: null, label: null, trend: null });
      return;
    }

    const raw = tooltipData.point[dataKey];
    const value = typeof raw === "number" ? raw : null;
    const date = parsePointDate(tooltipData.point[dateKey]);
    const label = date ? formatLabel(date) : null;
    const trend = computePeriodTrend(data, tooltipData.index, dataKey);

    onHoverChange({ value, label, trend });
  }, [data, dataKey, dateKey, formatLabel, onHoverChange, tooltipData]);

  return null;
}
