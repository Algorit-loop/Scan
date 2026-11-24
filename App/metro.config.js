// Cho Metro coi model ONNX, các file wasm và dữ liệu Tesseract là asset (tải về máy như ảnh, không nằm trong JS bundle).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
for (const ext of ['onnx', 'wasm', 'traineddata']) {
  if (!config.resolver.assetExts.includes(ext)) config.resolver.assetExts.push(ext);
}
config.resolver.sourceExts = config.resolver.sourceExts.filter((ext) => ext !== 'wasm');

module.exports = config;
