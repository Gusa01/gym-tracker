import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { ChartPoint, Metric } from '../lib/progress/types';
import { formatMetricValue, formatShortDate, formatSourceSet } from '../lib/progress/format';

const MAX_X_LABELS = 6;
const Y_AXIS_LABEL_WIDTH = 36;

/**
 * Line chart of one point per session, with the tapped (or latest) point's set shown below.
 * `width` is the horizontal space available to the whole chart, y-axis labels included.
 * Give it a `key` that changes with the series so the selection resets.
 */
export function ProgressChart({
  points,
  metric,
  width,
  height = 200,
}: {
  points: ChartPoint[];
  metric: Metric;
  width: number;
  height?: number;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  if (points.length === 0) return null;

  // gifted-charts draws the y-axis labels outside `width`
  const plotWidth = width - Y_AXIS_LABEL_WIDTH;
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const data = points.map((p, i) => ({ value: p.value, label: i % labelStep === 0 ? formatShortDate(p.date) : '' }));
  const minValue = Math.min(...points.map((p) => p.value));
  const selected = points[selectedIndex ?? points.length - 1];

  return (
    <View>
      <LineChart
        data={data}
        width={plotWidth}
        yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
        height={height}
        color="#111"
        thickness={2}
        dataPointsColor="#111"
        noOfSections={4}
        yAxisOffset={Math.max(0, Math.floor(minValue * 0.9))}
        initialSpacing={12}
        spacing={points.length > 1 ? Math.max(24, (plotWidth - 24) / (points.length - 1)) : 24}
        focusEnabled
        showStripOnFocus
        onFocus={(_item: unknown, index: number) => setSelectedIndex(index)}
        xAxisLabelTextStyle={styles.axisText}
        yAxisTextStyle={styles.axisText}
      />
      {selected && (
        <Text style={styles.selected}>
          {formatShortDate(selected.date)} · {formatSourceSet(selected, metric)}
          {metric === 'e1rm' ? ` · ${formatMetricValue(selected.value, metric)}` : ''}
        </Text>
      )}
      {points.length === 1 && <Text style={styles.hint}>Seguí entrenando para ver la evolución</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  axisText: { color: '#666', fontSize: 10 },
  selected: { marginTop: 8, color: '#111', fontWeight: '600' },
  hint: { marginTop: 4, color: '#666' },
});
