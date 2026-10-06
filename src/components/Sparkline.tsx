import { View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';

const WIDTH = 64;
const HEIGHT = 24;

/** Tiny axis-less trend line for list rows. Renders an empty slot with fewer than 2 values. */
export function Sparkline({ values, color = '#111' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <View style={{ width: WIDTH, height: HEIGHT }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Keep a margin below the lowest value so a flat series still has a non-zero range to draw in.
  const offset = Math.max(0, min - Math.max(1, (max - min) * 0.1));
  return (
    <View style={{ width: WIDTH, height: HEIGHT }} pointerEvents="none">
      <LineChart
        data={values.map((value) => ({ value }))}
        width={WIDTH}
        height={HEIGHT}
        initialSpacing={0}
        endSpacing={0}
        spacing={WIDTH / (values.length - 1)}
        yAxisOffset={offset}
        yAxisLabelWidth={0}
        xAxisLabelsHeight={0}
        hideAxesAndRules
        hideYAxisText
        hideDataPoints
        disableScroll
        color={color}
        thickness={2}
      />
    </View>
  );
}
