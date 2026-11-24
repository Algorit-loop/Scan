// Metro trả id asset (số) khi import file nhị phân (metro.config.js thêm onnx, wasm vào assetExts).
declare module '*.onnx' {
  const asset: number;
  export default asset;
}
declare module '*.wasm' {
  const asset: number;
  export default asset;
}
declare module '*.traineddata' {
  const asset: number;
  export default asset;
}
