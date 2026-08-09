import assert from "node:assert/strict";
import test from "node:test";
import {
  isCardioDone,
  isPullupDone,
  isWorkoutPerformed,
  removeGeneralWorkoutRecord,
  WorkoutDayRecord,
} from "./workoutCompletion";

test("일반 운동 삭제 시 다른 운동 종류의 기록을 모두 보존한다", () => {
  const record: WorkoutDayRecord = {
    workoutDone: true,
    workoutRoutineName: "허리 강화",
    workoutStatus: "completed",
    workoutMemo: "일반 운동 메모",
    workoutExerciseRecords: [
      { exerciseName: "버드독", status: "completed" },
    ],
    cardioDone: true,
    cardioType: "슬라이딩보드",
    cardioMinutes: 30,
    cardioMemo: "유산소 메모",
    rosaryCardioDone: true,
    rosaryCardioMinutes: 20,
    rosaryDecades: 5,
    postWorkoutCardioDone: true,
    postWorkoutCardioMinutes: 10,
    pullupDone: true,
    pullupStage: 2,
    pullupExerciseNames: ["짧은 매달리기"],
    pullupMemo: "철봉 메모",
    foamRollerDone: true,
    foamRollerTiming: "after",
    foamRollerAreas: ["등"],
    foamRollerMemo: "폼롤러 메모",
  };

  const preserved = removeGeneralWorkoutRecord(record);

  assert.equal(isWorkoutPerformed(preserved), false);
  assert.equal(isCardioDone(preserved), true);
  assert.equal(isPullupDone(preserved), true);
  assert.deepEqual(preserved, {
    cardioDone: true,
    cardioType: "슬라이딩보드",
    cardioMinutes: 30,
    cardioMemo: "유산소 메모",
    rosaryCardioDone: true,
    rosaryCardioMinutes: 20,
    rosaryDecades: 5,
    postWorkoutCardioDone: true,
    postWorkoutCardioMinutes: 10,
    pullupDone: true,
    pullupStage: 2,
    pullupExerciseNames: ["짧은 매달리기"],
    pullupMemo: "철봉 메모",
    foamRollerDone: true,
    foamRollerTiming: "after",
    foamRollerAreas: ["등"],
    foamRollerMemo: "폼롤러 메모",
  });
});

test("일반 운동만 있던 기록은 빈 객체가 된다", () => {
  assert.deepEqual(
    removeGeneralWorkoutRecord({
      workoutDone: false,
      workoutStatus: "partial",
      workoutDifficulty: "moderate",
      workoutFatigue: 2,
    }),
    {},
  );
});
