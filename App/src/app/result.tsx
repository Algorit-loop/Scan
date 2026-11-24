import { Image } from 'expo-image';
import { router } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '../components/BackButton';
import { ReaderBar } from '../components/ReaderBar';
import { Segment } from '../components/Segment';
import { ZoomableView } from '../components/ZoomableView';
import type { LayoutRegion } from '../layout/LayoutEngine';
import { labelInfo } from '../layout/labels';
import type { Box, ReadingDoc } from '../reading/compose';
import { ANALYSIS_BUDGET_MS, runAnalysis } from '../reading/runAnalysis';
import { useReader } from '../reading/useReader';
import { type AnalysisState, type Scan, type ScanMode, setScanMode, useAnalysis, useLastScan } from '../scanner/lastScan';
import { type ScanSettings, useScanSettings } from '../scanner/settings';
import { colors, font } from '../theme';

const PAD = 16;
const comma = (v: number, digits: number) => v.toFixed(digits).replace('.', ',');
type Done = Extract<AnalysisState, { status: 'done' }>;

/**
 * Trang kết quả: ảnh đã nắn phẳng + nội dung đọc được, đọc thành tiếng từng câu.
 * Trên: ảnh (phóng to bằng 2 ngón), câu đang đọc được tô sáng. Giữa: toàn bộ nội dung theo đoạn, chạm một câu để đọc.
 * Đáy (cố định): câu hiện tại + ba nút Câu trước / Đọc lại / Câu sau.
 */
export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const scan = useLastScan();
  const analysis = useAnalysis();

  // Vào thẳng màn này mà chưa phân tích (vd. nạp lại app khi đang ở đây): chạy.
  useEffect(() => {
    if (scan && !analysis) runAnalysis();
  }, [scan, analysis]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} label="Quay lại camera" />
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {scan?.flattened === false ? 'Ảnh gốc (không thấy trang giấy)' : 'Kết quả quét'}
        </Text>
      </View>
      {!scan ? (
        <Text style={[styles.meta, styles.padded]}>Chưa có ảnh.</Text>
      ) : analysis?.status === 'done' ? (
        // key: mỗi lần phân tích xong là một nội dung mới -> dựng lại, đọc từ đầu.
        <Reading key={`${scan.id}:${analysis.at}`} scan={scan} analysis={analysis} />
      ) : (
        <Waiting scan={scan} analysis={analysis} />
      )}
    </View>
  );
}

// ---------- Đang phân tích / lỗi ----------

function Waiting({ scan, analysis }: { scan: Scan; analysis: AnalysisState | null }) {
  const insets = useSafeAreaInsets();
  const [zoomed, setZoomed] = useState(false);
  return (
    <ScrollView scrollEnabled={!zoomed} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
      <PageImage scan={scan} maxHeightRatio={0.6} onZoomChange={setZoomed} />
      <View accessibilityLiveRegion="polite" style={styles.block}>
        {analysis?.status === 'error' ? (
          <>
            <Text style={[styles.status, styles.error]}>Không đọc được nội dung: {analysis.message}</Text>
            <Pressable
              onPress={() => runAnalysis()}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Thử lại"
            >
              <Text style={styles.retryText}>Thử lại</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.inline}>
            <ActivityIndicator color={colors.text} />
            <Text style={styles.status}>
              {analysis?.status === 'pending' && analysis.step === 'ocr' ? 'Đang đọc chữ trong ảnh…' : 'Đang xem hướng trang…'}{' '}
              <Elapsed since={analysis?.status === 'pending' ? analysis.startedAt : undefined} />
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/** Số giây đã trôi qua (cập nhật mỗi giây) — để biết vẫn đang chạy chứ không đứng. */
function Elapsed({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>({Math.max(0, Math.floor((now - (since ?? now)) / 1000))} s)</>;
}

// ---------- Có nội dung: xem + nghe ----------

function Reading({ scan, analysis }: { scan: Scan; analysis: Done }) {
  const insets = useSafeAreaInsets();
  const [settings, updateSettings] = useScanSettings();
  const [zoomed, setZoomed] = useState(false);
  const { doc, layout } = analysis;
  const reader = useReader(doc.sentences, { continuous: settings.continuous, rate: settings.speechRate });
  const empty = doc.sentences.length === 0;
  const current = reader.index >= 0 ? doc.sentences[reader.index] : null;

  // Có nội dung là đọc luôn câu đầu (người dùng không cần tìm nút).
  const started = useRef(false);
  const { speakAt } = reader;
  useEffect(() => {
    if (started.current || empty) return;
    started.current = true;
    const t = setTimeout(() => speakAt(0), 350);
    return () => clearTimeout(t);
  }, [empty, speakAt]);

  // Cuộn danh sách tới đoạn chứa câu đang đọc.
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const listY = useRef(0);
  const rowY = useRef(new Map<number, number>());
  const paragraph = current?.paragraph;
  useEffect(() => {
    const y = paragraph != null ? rowY.current.get(paragraph) : undefined;
    if (y != null) scroll.current?.scrollTo({ y: Math.max(0, listY.current + y - 24), animated: true });
  }, [paragraph]);

  return (
    <>
      <ScrollView ref={scroll} style={styles.flex} scrollEnabled={!zoomed} contentContainerStyle={[styles.content, styles.contentEnd]}>
        <PageImage
          scan={scan}
          maxHeightRatio={0.4}
          onZoomChange={setZoomed}
          docSize={doc}
          highlight={current?.boxes}
          regions={settings.showLayout && layout ? layout.regions.filter((r) => r.score >= 0.4) : undefined}
        />

        {empty ? (
          <Text style={styles.status} accessibilityLiveRegion="polite">
            Không thấy chữ trong ảnh. Hãy chụp lại: đưa máy gần hơn, đủ sáng, giữ yên tay.
          </Text>
        ) : (
          <>
            {doc.conf < 75 && (
              <Text style={[styles.meta, styles.warn]}>
                Chữ khó đọc (độ tin cậy {Math.round(doc.conf)}%), nội dung có thể sai. Nên chụp lại gần hơn, đủ sáng.
              </Text>
            )}
            {reader.hasVietnameseVoice === false && (
              <Text style={[styles.meta, styles.warn]}>
                Máy chưa có giọng đọc tiếng Việt: vào Cài đặt của máy, phần Trợ năng / Giọng đọc, tải thêm giọng tiếng Việt.
              </Text>
            )}
            <View
              style={styles.list}
              onLayout={(e: LayoutChangeEvent) => {
                listY.current = e.nativeEvent.layout.y;
              }}
            >
              {doc.paragraphs.map((p) => (
                <View
                  key={p.index}
                  style={styles.paragraph}
                  onLayout={(e: LayoutChangeEvent) => {
                    rowY.current.set(p.index, e.nativeEvent.layout.y);
                  }}
                >
                  {p.sentences.map((i) => {
                    const on = i === reader.index;
                    return (
                      <Text
                        key={i}
                        onPress={() => reader.speakAt(i)}
                        style={[styles.sentence, on && styles.sentenceOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`Câu ${i + 1}: ${doc.sentences[i].text}`}
                        accessibilityHint="Chạm hai lần để đọc câu này"
                      >
                        {doc.sentences[i].text}
                      </Text>
                    );
                  })}
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.options}>
          {scan.hasEnhanced && (
            <Segment<ScanMode>
              label="Ảnh"
              value={scan.mode}
              options={[
                ['enhanced', 'Rõ chữ'],
                ['original', 'Gốc'],
              ]}
              onChange={setScanMode}
            />
          )}
          <Segment
            label="Cách đọc"
            value={settings.continuous}
            options={[
              [false, 'Từng câu'],
              [true, 'Liên tục'],
            ]}
            onChange={(continuous) => updateSettings({ continuous })}
          />
          <Segment<ScanSettings['speechRate']>
            label="Tốc độ đọc"
            value={settings.speechRate}
            options={[
              [0.8, 'Chậm'],
              [1, 'Vừa'],
              [1.2, 'Nhanh'],
            ]}
            onChange={(speechRate) => updateSettings({ speechRate })}
          />
          <Segment
            label="Khung bố cục"
            value={settings.showLayout}
            options={[
              [false, 'Ẩn khung'],
              [true, 'Hiện khung'],
            ]}
            onChange={(showLayout) => updateSettings({ showLayout })}
          />
        </View>
        <Text style={styles.meta}>{details(scan, analysis)}</Text>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {!empty && (
          <Pressable
            onPress={() => (reader.speaking ? reader.stop() : reader.replay())}
            style={styles.now}
            accessibilityRole="button"
            accessibilityLabel={current ? `Câu ${current.index + 1} trên ${doc.sentences.length}: ${current.text}` : 'Chưa đọc câu nào'}
            accessibilityHint={reader.speaking ? 'Chạm hai lần để dừng đọc' : 'Chạm hai lần để đọc'}
          >
            <Text style={styles.counter}>
              {current ? `Câu ${current.index + 1} / ${doc.sentences.length}` : `${doc.sentences.length} câu`}
              {reader.speaking ? '  ·  đang đọc — chạm để dừng' : ''}
            </Text>
            <Text style={styles.nowText} numberOfLines={4}>
              {current ? current.text : 'Bấm Câu sau để bắt đầu.'}
            </Text>
          </Pressable>
        )}
        <ReaderBar disabled={empty} onPrevious={reader.previous} onReplay={reader.replay} onNext={reader.next} />
      </View>
    </>
  );
}

function details(scan: Scan, a: Done) {
  const { ms, doc, layout, ocrSize } = a;
  return (
    `${doc.sentences.length} câu, ${doc.paragraphs.length} đoạn · độ tin cậy ${Math.round(doc.conf)}% · ảnh ${scan.width}×${scan.height} px` +
    (layout?.rotate ? ` · đã xoay ${layout.rotate}° cho thẳng` : '') +
    `\nThời gian: ${comma(ms.total / 1000, 1)} s — hướng trang + bố cục ${ms.layout} · xoay ${ms.rotate} · ` +
    `giải mã ${Math.round(ms.ocrDecode)} · tiền xử lý ${Math.round(ms.ocrPre)} · nhận dạng chữ ${Math.round(ms.ocr)} ` +
    `(${ocrSize[0]}×${ocrSize[1]}) · tách câu ${ms.compose} ms` +
    (ms.ocrLoad > 50 ? ` (trong đó chờ nạp bộ nhận dạng ${comma(ms.ocrLoad / 1000, 1)} s)` : '') +
    (ms.total > ANALYSIS_BUDGET_MS ? ` — VƯỢT mốc ${ANALYSIS_BUDGET_MS / 1000} s` : '') +
    (layout ? '' : '\nKhông chạy được bước hướng trang / bố cục (coi như trang đã thẳng).')
  );
}

// ---------- Ảnh + lớp phủ ----------

/**
 * Ảnh bản quét trong khung phóng to được: rộng hết màn, cao theo tỉ lệ ảnh nhưng không quá `maxHeightRatio` màn hình.
 * `highlight`: khung của câu đang đọc (pixel theo `docSize`); `regions`: khung bố cục (tọa độ chuẩn hóa).
 */
function PageImage({
  scan,
  maxHeightRatio,
  onZoomChange,
  docSize,
  highlight,
  regions,
}: {
  scan: Scan;
  maxHeightRatio: number;
  onZoomChange: (zoomed: boolean) => void;
  docSize?: Pick<ReadingDoc, 'width' | 'height'>;
  highlight?: Box[];
  regions?: LayoutRegion[];
}) {
  const win = useWindowDimensions();
  const viewW = win.width - PAD * 2;
  const viewH = Math.min((viewW * scan.height) / scan.width, win.height * maxHeightRatio);
  const k = Math.min(viewW / scan.width, viewH / scan.height);
  const rect = { width: scan.width * k, height: scan.height * k, left: (viewW - scan.width * k) / 2, top: (viewH - scan.height * k) / 2 };
  const sx = docSize ? rect.width / docSize.width : 0;
  const sy = docSize ? rect.height / docSize.height : 0;
  return (
    <View style={[styles.viewer, { width: viewW, height: viewH }]}>
      <ZoomableView width={viewW} height={viewH} onZoomChange={onZoomChange}>
        <View style={[styles.abs, rect]}>
          <Image
            source={{ uri: scan.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
            accessible
            accessibilityLabel="Ảnh tài liệu vừa chụp"
          />
          {regions?.map((r) => {
            const { vi, color } = labelInfo(r.label);
            const [x1, y1, x2, y2] = r.norm;
            return (
              <View
                key={r.index}
                pointerEvents="none"
                style={[
                  styles.region,
                  { left: x1 * rect.width, top: y1 * rect.height, width: (x2 - x1) * rect.width, height: (y2 - y1) * rect.height, borderColor: color },
                ]}
              >
                <Text style={[styles.chip, { backgroundColor: color }]} numberOfLines={1}>
                  {vi} {comma(r.score, 2)}
                </Text>
              </View>
            );
          })}
          {highlight?.map((b, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={[styles.highlight, { left: b[0] * sx - 2, top: b[1] * sy - 2, width: (b[2] - b[0]) * sx + 4, height: (b[3] - b[1]) * sy + 4 }]}
            />
          ))}
        </View>
      </ZoomableView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: PAD, paddingBottom: 8 },
  title: { flex: 1, color: colors.text, fontSize: font.title, fontWeight: '700' },
  padded: { paddingHorizontal: PAD },
  content: { paddingHorizontal: PAD, gap: 12 },
  contentEnd: { paddingBottom: 16 },
  block: { gap: 12 },
  viewer: { borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
  abs: { position: 'absolute' },
  region: { position: 'absolute', borderWidth: 2 },
  chip: { alignSelf: 'flex-start', maxWidth: '100%', color: '#000', fontSize: 11, fontWeight: '700', paddingHorizontal: 3, overflow: 'hidden' },
  highlight: { position: 'absolute', backgroundColor: 'rgba(255, 212, 0, 0.38)', borderColor: colors.accent, borderWidth: 1.5, borderRadius: 3 },
  meta: { color: colors.textMuted, fontSize: font.small, lineHeight: 21 },
  warn: { color: colors.accent },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { color: colors.text, fontSize: font.body, lineHeight: 26 },
  error: { color: colors.danger },
  retry: {
    alignSelf: 'flex-start',
    minHeight: 56,
    paddingHorizontal: 28,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: colors.onAccent, fontSize: font.body, fontWeight: '700' },
  list: { gap: 14 },
  paragraph: { gap: 2 },
  sentence: { color: colors.text, fontSize: font.body, lineHeight: 28, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 6 },
  sentenceOn: { backgroundColor: colors.accent, color: colors.onAccent, overflow: 'hidden' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  bottom: {
    paddingHorizontal: PAD,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  now: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  counter: { color: colors.accent, fontSize: font.small, fontWeight: '700' },
  nowText: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
