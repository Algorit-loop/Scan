import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

export type TabIconName = 'home' | 'history' | 'settings';

/** Biểu tượng của ba mục ở thanh dưới: Trang chủ (ngôi nhà), Lịch sử (đồng hồ), Cài đặt (thanh trượt). */
export function TabIcon({ name, color, size = 28 }: { name: TabIconName; color: ColorValue; size?: number }) {
  const stroke = { stroke: color, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'home' && (
        <>
          <Path d="M3.5 11.5 12 4l8.5 7.5" {...stroke} />
          <Path d="M6 10v9.5h4.5V14h3v5.5H18V10" {...stroke} />
        </>
      )}
      {name === 'history' && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M12 7.5V12l3 2" {...stroke} />
        </>
      )}
      {name === 'settings' && (
        <>
          <Path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" {...stroke} />
          <Circle cx={15} cy={7} r={2} {...stroke} />
          <Circle cx={9} cy={12} r={2} {...stroke} />
          <Circle cx={17} cy={17} r={2} {...stroke} />
        </>
      )}
    </Svg>
  );
}
