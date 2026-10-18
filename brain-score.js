// 말랑그램(두뇌 무게)·영역 능력치·박사 코멘트 계산. 화면과 Firebase에 의존하지 않는 순수 함수만 둔다.

export const AREAS = [
  { key: 'intuition', label: '직감', color: '#ff7a45', icon: 'assets/cat-intuition.webp' },
  { key: 'memory', label: '기억', color: '#f2b51c', icon: 'assets/cat-memory.webp' },
  { key: 'analysis', label: '분석', color: '#3d9bf0', icon: 'assets/cat-analysis.webp' },
  { key: 'compute', label: '계산', color: '#4cb963', icon: 'assets/cat-compute.webp' },
  { key: 'perception', label: '지각', color: '#9b6bea', icon: 'assets/cat-perception.webp' },
];

// 60초 한 판에서 "꽤 잘했다"고 볼 점수. 이 점수면 그 영역 능력치 100.
// 문제 하나 맞히면 100점(+콤보 최대 50점)이라, 직감처럼 빨리 넘기는 게임이 기준이 높다.
// 학생 기록이 쌓이면 이 값만 조정하면 된다.
export const AREA_REFERENCE = [3200, 1200, 1500, 1400, 1600];

const MIN_GRAMS = 400;
const GRAMS_PER_POINT = 3.2; // 다섯 영역이 모두 100이면 400 + 500×3.2 = 2000g

export const GRADES = [
  { min: 1850, name: '전설의 두뇌', comment: '전설의 말랑그램 등장! 박사도 깜짝 놀랐어요.' },
  { min: 1600, name: '천재 두뇌', comment: '이 정도면 두뇌학원 우등생이에요!' },
  { min: 1300, name: '반짝 두뇌', comment: '반짝반짝! 오늘 두뇌 컨디션 최고예요.' },
  { min: 1000, name: '탱글 두뇌', comment: '오, 두뇌에 탄력이 붙었어요! 이 기세 그대로!' },
  { min: 700, name: '말랑 두뇌', comment: '나쁘지 않아요! 두뇌가 말랑말랑한 게 딱 좋군요.' },
  { min: 0, name: '새싹 두뇌', comment: '오늘은 몸풀기였어요! 내일은 더 말랑해질 거예요.' },
];

export function areaScore(category, score) {
  const ratio = Number(score) / AREA_REFERENCE[category];
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100);
}

export function gramsFrom(areaScores) {
  const sum = areaScores.reduce((total, value) => total + (value ?? 0), 0);
  return Math.round((MIN_GRAMS + sum * GRAMS_PER_POINT) / 10) * 10;
}

export function gradeFor(grams) {
  return GRADES.find((grade) => grams >= grade.min) ?? GRADES.at(-1);
}

// 하루 도전 결과(영역 순서대로 5개)로 그날의 말랑그램을 계산한다.
export function dailyBrain(results = []) {
  const areas = AREAS.map((_, i) => (results[i] ? areaScore(i, results[i].score) : 0));
  const grams = gramsFrom(areas);
  return { areas, grams, grade: gradeFor(grams), tip: weakestTip(areas) };
}

// 최근 7회 영역별 기록 평균으로 지금 실력을 본다. 다섯 영역이 다 있어야 말랑그램이 나온다.
export function profileBrain(history = {}) {
  const areas = AREAS.map((_, i) => {
    const values = toList(history[i]).map(Number).filter(Number.isFinite);
    if (!values.length) return null;
    return areaScore(i, values.reduce((a, b) => a + b, 0) / values.length);
  });
  const measured = areas.filter((value) => value !== null).length;
  if (measured < AREAS.length) return { areas, measured, grams: null, grade: null, tip: '' };
  const grams = gramsFrom(areas);
  return { areas, measured, grams, grade: gradeFor(grams), tip: weakestTip(areas) };
}

function weakestTip(areas) {
  const scored = areas.map((value, i) => ({ value: value ?? 0, i }));
  const weakest = scored.reduce((low, item) => (item.value < low.value ? item : low), scored[0]);
  const strongest = scored.reduce((high, item) => (item.value > high.value ? item : high), scored[0]);
  if (strongest.value - weakest.value < 15) return '다섯 영역이 고르게 균형 잡혔어요.';
  return `${AREAS[strongest.i].label}이 특히 좋아요. ${AREAS[weakest.i].label} 연습을 하면 더 무거워질 거예요!`;
}

function toList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined) : Object.values(value);
}

// 오각형 레이더 차트 꼭짓점 좌표 (위쪽부터 시계 방향: 직감·기억·분석·계산·지각).
export function radarPoints(values, radius, cx, cy) {
  return values.map((value, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / values.length;
    const r = (radius * Math.max(0, Math.min(100, value ?? 0))) / 100;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}
