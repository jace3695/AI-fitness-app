import { useState } from 'react';
import BodyRecordCard from '../../../app/components/BodyRecordCard';
import { readJson, WEIGHT_RECORDS_KEY, INBODY_RECORDS_KEY,
  type WeightRecordStore, type InbodyRecordStore } from '../../../app/data/recordStorage';
import { readSyntheticReport, readSyntheticInbodyReport } from './body-import-ocr';

/** Synthetic storage only; no authenticated account or image/OCR accuracy claim. */
export default function BodyImportFixture() {
  const [weights, setWeights] = useState(() => readJson<WeightRecordStore>(WEIGHT_RECORDS_KEY, {}));
  const [inbody, setInbody] = useState(() => readJson<InbodyRecordStore>(INBODY_RECORDS_KEY, {}));
  return <BodyRecordCard dateKey="2025-04-07" weights={weights} inbody={inbody} readReport={readSyntheticReport} readInbodyReport={readSyntheticInbodyReport}
    onChange={next => { setWeights(next.weights); setInbody(next.inbody); }} />;
}
