import { useState } from 'react';
import { type LayoutRectangle, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import type { DetectionResult } from '../detection/types';
import { colors } from '../theme';

type Props = {
  result: DetectionResult | null;
  /** Kích thước khung hình đã phân tích — để quy đổi sang tọa độ màn hình. */
  frameWidth: number;
  frameHeight: number;
  aligned: boolean;
};

/**
 * Vẽ tứ giác tài liệu lên preview camera (cho người còn thị lực yếu).
 * Preview hiển thị kiểu "cover" nên cần quy đổi tọa độ khung hình sang tọa độ màn hình.
 */
export function DetectionOverlay({ result, frameWidth, frameHeight, aligned }: Props) {
  const [layout, setLayout] = useState<LayoutRectangle | null>(null);

  let points: string | null = null;
  if (layout && result?.found && frameWidth > 0 && frameHeight > 0) {
    const scale = Math.max(layout.width / frameWidth, layout.height / frameHeight);
    const dw = frameWidth * scale;
    const dh = frameHeight * scale;
    const ox = (layout.width - dw) / 2;
    const oy = (layout.height - dh) / 2;
    points = result.corners.map((c) => `${ox + c.x * dw},${oy + c.y * dh}`).join(' ');
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => setLayout(e.nativeEvent.layout)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {points && layout && (
        <Svg width={layout.width} height={layout.height}>
          <Polygon
            points={points}
            fill={aligned ? 'rgba(39,227,107,0.18)' : 'rgba(255,212,0,0.12)'}
            stroke={aligned ? colors.success : colors.accent}
            strokeWidth={aligned ? 6 : 4}
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </View>
  );
}
