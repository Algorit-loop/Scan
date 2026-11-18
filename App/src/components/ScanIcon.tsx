import Svg, { Path } from 'react-native-svg';

/** Biểu tượng quét: bốn góc khung + vạch quét ngang. */
export function ScanIcon({ size = 48, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path
        d="M6 16V9a3 3 0 0 1 3-3h7M32 6h7a3 3 0 0 1 3 3v7M42 32v7a3 3 0 0 1-3 3h-7M16 42H9a3 3 0 0 1-3-3v-7"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M12 24h24" stroke={color} strokeWidth={4} strokeLinecap="round" />
    </Svg>
  );
}
