// Pinned official runtime/data bytes only; no OCR observations or image results.
export const OCR_ASSET_ID = 't6.0.1-c6.1.2-e1.0.0-0e7d7f911930e9a6';
export const OCR_ASSET_PREFIX = `/ocr-static/${OCR_ASSET_ID}`;
export const OCR_ASSETS = [
  {
    "name": "worker.min.js",
    "source": "tesseract.js/dist/worker.min.js",
    "sha256": "38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842",
    "bytes": 111162
  },
  {
    "name": "tesseract-core.wasm.js",
    "source": "tesseract.js-core/tesseract-core.wasm.js",
    "sha256": "e66872f6a76f5ad414d73d21512245df0de3060ad4871a97c47efceaab27b955",
    "bytes": 4750805
  },
  {
    "name": "tesseract-core-simd.wasm.js",
    "source": "tesseract.js-core/tesseract-core-simd.wasm.js",
    "sha256": "3b0678c47a8dea6abb931b214171c08b742a5b9a9fcbbb1a028a08d5de6e9d4c",
    "bytes": 4751193
  },
  {
    "name": "tesseract-core-lstm.wasm.js",
    "source": "tesseract.js-core/tesseract-core-lstm.wasm.js",
    "sha256": "775a35df6f2ae100e02609443e6bd5cafcd07983dd6175454ca4a432a7730687",
    "bytes": 3954181
  },
  {
    "name": "tesseract-core-simd-lstm.wasm.js",
    "source": "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    "sha256": "9d7c43fb206dc9f48475228b46bf35f888fa9e6259da2e67d5a75c77049f2dc7",
    "bytes": 3954569
  },
  {
    "name": "eng.traineddata.gz",
    "url": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz",
    "sha256": "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
    "bytes": 2952873
  }
];
