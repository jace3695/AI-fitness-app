"use client";

import { ChangeEvent, useRef, useState } from "react";
import {
  restoreCloudBackup,
  readLocalCloudState,
  type CloudState,
} from "../data/cloudSync";
import { captureStorageOwner, type StorageOwnerToken } from "../data/storageTransaction";

const BACKUP_VERSION = 1;
const STORAGE_PREFIX = "ai-fitness-";
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

interface BackupFile {
  app: "AI-fitness-app";
  version: number;
  exportedAt: string;
  state: CloudState;
}

interface PendingBackup {
  owner: StorageOwnerToken;
  fileName: string;
  exportedAt: Date;
  state: CloudState;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBackup(raw: string): Omit<PendingBackup, "fileName" | "owner"> {
  const parsed = JSON.parse(raw) as Partial<BackupFile>;
  if (
    parsed.app !== "AI-fitness-app" ||
    parsed.version !== BACKUP_VERSION ||
    !parsed.exportedAt ||
    !isPlainObject(parsed.state)
  ) {
    throw new Error("이 앱에서 만든 올바른 백업 파일이 아닙니다.");
  }

  const entries = Object.entries(parsed.state);
  if (!entries.length || entries.some(([key]) => !key.startsWith(STORAGE_PREFIX))) {
    throw new Error("백업 파일에 복원할 운동 앱 기록이 없습니다.");
  }

  const exportedAt = new Date(parsed.exportedAt);
  if (Number.isNaN(exportedAt.getTime())) {
    throw new Error("백업 시각을 확인할 수 없습니다.");
  }
  return { exportedAt, state: Object.fromEntries(entries) };
}

export default function DataBackupPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const restorePending = useRef(false);
  const selectionRevision = useRef(0);

  const downloadBackup = () => {
    try {
      const exportedAt = new Date();
      const backup: BackupFile = {
        app: "AI-fitness-app",
        version: BACKUP_VERSION,
        exportedAt: exportedAt.toISOString(),
        state: readLocalCloudState(),
      };
      const date = exportedAt.toLocaleDateString("sv-SE");
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      if (blob.size > MAX_BACKUP_BYTES) {
        setMessage("");
        setError("현재 JSON 복원 한도인 5MB를 넘어 백업 파일을 만들지 않았습니다. 원본 기록은 그대로 유지됩니다.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ai-fitness-backup-${date}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setError("");
      setMessage(`이 브라우저의 운동·식단 관련 기록 ${Object.keys(backup.state).length}개 항목으로 백업 파일을 만들었습니다.`);
    } catch (reason) {
      setMessage("");
      setError(reason instanceof Error ? reason.message : "기록을 안전하게 읽지 못해 백업 파일을 만들지 않았습니다.");
    }
  };

  const selectBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file || restorePending.current) return;
    const revision = ++selectionRevision.current;
    setPending(null);
    setMessage("");
    setError("");
    try {
      if (file.size > MAX_BACKUP_BYTES) {
        throw new Error("백업 파일은 5MB 이하만 복원할 수 있습니다.");
      }
      const owner = captureStorageOwner();
      const parsed = parseBackup(await file.text());
      if (revision !== selectionRevision.current) return;
      const current = captureStorageOwner();
      if (owner.userId !== current.userId || owner.epoch !== current.epoch) throw new Error("계정이 변경되었습니다. 백업 파일을 다시 선택해 주세요.");
      setPending({ owner, fileName: file.name, ...parsed });
    } catch (reason) {
      if (revision === selectionRevision.current) setError(reason instanceof Error ? reason.message : "백업 파일을 읽지 못했습니다.");
    } finally {
      input.value = "";
    }
  };

  const restoreBackup = async () => {
    if (!pending || restorePending.current) return;
    const selected = pending;
    restorePending.current = true;
    setRestoring(true);
    setError("");
    setMessage("");
    try {
      // The preview's owner remains authoritative through file I/O and lock
      // queuing; the merge itself reads the latest records inside that lock.
      await restoreCloudBackup(selected.state, selected.owner);
      const current = captureStorageOwner();
      if (current.userId !== selected.owner.userId || current.epoch !== selected.owner.epoch) return;
      setMessage(`백업 기록 ${Object.keys(selected.state).length}개 항목을 현재 기록과 합쳤습니다.`);
      setPending(null);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "복원을 완료하지 못했습니다. 기존 기록과 선택한 백업을 유지합니다.");
    } finally {
      restorePending.current = false;
      setRestoring(false);
    }
  };

  return (
    <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-[12px] font-bold text-[#534AB7]">기록 백업·복원</p>
      <h3 className="mt-1 text-[17px] font-bold text-gray-900">이 브라우저의 운동·식단 기록 보관</h3>
      <p className="mt-1 text-[11px] leading-5 text-gray-500">
        이 브라우저에 저장된 운동·식단·체중·인바디·관련 설정을 5MB 이하의 JSON 파일로 저장합니다. 복원할 때는 이 범위의 현재 기록을 지우지 않고 백업 기록과 합칩니다.
      </p>
      <p className="mt-2 text-[11px] leading-5 text-amber-800">
        연이 전체 앱 백업은 아닙니다. 클라우드에만 있는 기록, 일본어 Live 기록, 업로드한 교재·그림·음성 파일과 별도 임시 저장된 입력은 포함되지 않습니다.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={downloadBackup}
          className="rounded-xl bg-[#534AB7] px-3 py-2.5 text-[12px] font-bold text-white"
        >
          운동·식단 기록 백업
        </button>
        <button
          type="button"
          disabled={restoring}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl bg-[#EEEDFE] px-3 py-2.5 text-[12px] font-bold text-[#3C3489]"
        >
          백업 파일 선택
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          onChange={(event) => void selectBackup(event)}
          className="hidden"
        />
      </div>

      {pending && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
          <p className="font-bold break-all">{pending.fileName}</p>
          <p className="mt-1">
            백업 시각 {pending.exportedAt.toLocaleString("ko-KR")} · {Object.keys(pending.state).length}개 항목
          </p>
          <p className="mt-1">같은 날짜의 기록은 선택한 백업 내용으로 갱신됩니다.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={restoring}
              onClick={() => void restoreBackup()}
              className="flex-1 rounded-xl bg-amber-600 px-3 py-2 font-bold text-white"
            >
              확인 후 병합 복원
            </button>
            <button
              type="button"
              disabled={restoring}
              onClick={() => setPending(null)}
              className="rounded-xl bg-white px-3 py-2 font-bold text-gray-600"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {message ? <p role="status" className="mt-3 text-[11px] font-medium text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-[11px] font-medium text-red-700">{error}</p> : null}
    </section>
  );
}
