import {
  useUserPreferences,
  type SortMode,
} from "../../hooks/useUserPreferences";
import { recordAction } from "../../services/perf";
import { Section, SegmentedButtons } from "./controls";

export function SortSection() {
  const { prefs, update } = useUserPreferences();

  return (
    <Section title="Sort order">
      <SegmentedButtons
        value={prefs.sortMode}
        onChange={(v) => {
          recordAction("sort_change", {
            from: prefs.sortMode,
            to: v,
          });
          update("sortMode", v);
        }}
        options={[
          { value: "shuffle", label: "Shuffle" },
          { value: "name", label: "Name" },
          { value: "added", label: "Added" },
          { value: "custom", label: "Custom" },
        ] satisfies Array<{
          value: SortMode;
          label: string;
        }>}
      />
      {prefs.sortMode === "custom" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Drag any tile to reorder. Only available on the full, unfiltered
          library — clear any search or tag filter first.
        </p>
      )}
    </Section>
  );
}
