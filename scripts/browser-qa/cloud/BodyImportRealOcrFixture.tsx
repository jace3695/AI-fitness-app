import { useState } from 'react';
import BodyRecordCard from '../../../app/components/BodyRecordCard';
import { readJson, WEIGHT_RECORDS_KEY, INBODY_RECORDS_KEY,
  type WeightRecordStore, type InbodyRecordStore } from '../../../app/data/recordStorage';
import { OCR_ASSET_PREFIX } from './ocr-assets.mjs';

/** Actual default readers and browser pipeline. Only static worker asset paths differ. */
export default function BodyImportRealOcrFixture() {
  const [weights, setWeights] = useState(() => readJson<WeightRecordStore>(WEIGHT_RECORDS_KEY, {}));
  const [inbody, setInbody] = useState(() => readJson<InbodyRecordStore>(INBODY_RECORDS_KEY, {}));
  return <BodyRecordCard dateKey="2025-04-07" weights={weights} inbody={inbody}
    inbodyOcrAssets={{ basePath: OCR_ASSET_PREFIX }}
    onChange={next => { setWeights(next.weights); setInbody(next.inbody); }} />;
}
