"use client";

import { ChangeEvent, useRef, useState } from "react";
import {
  applyCloudState,
  mergeCloudState,
  readLocalCloudState,
  type CloudState,
} from "../data/cloudSync";

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
  fileName: string;
  exportedAt: Date;
  state: CloudState;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBackup(raw: string): Omit<PendingBackup, "fileName"> {
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

  const downloadBackup = () => {
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
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai-fitness-backup-${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setError("");
    setMessage(`현재 기록 ${Object.keys(backup.state).length}개 항목을 백업했습니다.`);
  };

  const selectBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPending(null);
    setMessage("");
    setError("");
    try {
      if (file.size > MAX_BACKUP_BYTES) {
        throw new Error("백업 파일은 5MB 이하만 복원할 수 있습니다.");
      }
      const parsed = parseBackup(await file.text());
      setPending({ fileName: file.name, ...parsed });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "백업 파일을 읽지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  };

  const restoreBackup = () => {
    if (!pending) return;
    const merged = mergeCloudState(readLocalCloudState(), pending.state);
    applyCloudState(merged);
    setMessage(`백업 기록 ${Object.keys(pending.state).length}개 항목을 현재 기록과 합쳤습니다.`);
    setPending(null);
    window.setTimeout(() => window.location.reload(), 700);
  };

  return (
    <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-[12px] font-bold text-[#534AB7]">기록 백업·복원</p>
      <h3 className="mt-1 text-[17px] font-bold text-gray-900">내 기록 파일로 보관</h3>
      <p className="mt-1 text-[11px] leading-5 text-gray-500">
        운동·식단·체중·인바디·설정을 JSON 파일로 저장합니다. 복원할 때는 현재 기록을 지우지 않고 백업 기록과 합칩니다.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={downloadBackup}
          className="rounded-xl bg-[#534AB7] px-3 py-2.5 text-[12px] font-bold text-white"
        >
          전체 기록 백업
        </button>
        <button
          type="button"
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
              onClick={restoreBackup}
              className="flex-1 rounded-xl bg-amber-600 px-3 py-2 font-bold text-white"
            >
              확인 후 병합 복원
            </button>
            <button
              type="button"
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
