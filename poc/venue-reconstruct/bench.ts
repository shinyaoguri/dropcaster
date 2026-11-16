// 会場の逆算推定器 (src/viewer/venue/venueReconstruct.ts) の精度を、合成会場で測る (#243)。
// 実行: node poc/venue-reconstruct/bench.ts [試行回数 (既定 100)]
// 構成・配置・投射比の有無ごとに、なぞった画素へ各軸 ±2 px の一様ノイズを入れて推定し、
// 正解との誤差を Markdown の表で出す。乱数は試行番号から決まり、同じ入力なら同じ表になる。
import { reconstructVenue } from '../../src/viewer/venue/venueReconstruct.ts';
import { CONFIGS, OUTPUT, compareUpToScale, observe, random, truthProjector } from '../../tests/fixtures/venue-reconstruct-scene.js';

const TRIALS = Number(process.argv[2] ?? 100);
const NOISE_PX = 2;
const TRUE_FOV = 50;
/** 頂点誤差がこれを超えた試行は「誤った解に収束した」と数える。 */
const WRONG_SOLUTION_METERS = .5;

const POSES = {
  front: { label: '正面 (奥の壁に正対)', projector: truthProjector() },
  oblique: { label: '斜め (左奥の隅を狙う)', projector: truthProjector({ position: [2.6, 2.4, 2.5] }, [-2.5, .8, -2.2]) },
};

/** knownIntrinsics: 画角とレンズシフトを仕様値 (正解) に固定する。 */
type Case = { pose: keyof typeof POSES; config: keyof typeof CONFIGS; priorSigma?: number; knownIntrinsics?: boolean };
const CASES: Case[] = [
  { pose: 'front', config: 'room' },
  { pose: 'front', config: 'room', priorSigma: 2 },
  { pose: 'front', config: 'roomAndBox' },
  { pose: 'front', config: 'roomAndBox', priorSigma: 2 },
  { pose: 'front', config: 'boxTwoFaces' },
  { pose: 'front', config: 'boxTwoFaces', priorSigma: 2 },
  { pose: 'front', config: 'boxTwoFacesCorner', priorSigma: 2 },
  { pose: 'front', config: 'oneCorner' },
  { pose: 'front', config: 'oneCorner', priorSigma: 2 },
  { pose: 'front', config: 'oneCorner', knownIntrinsics: true },
  { pose: 'front', config: 'oneCornerAmbiguous', knownIntrinsics: true },
  { pose: 'oblique', config: 'boxTwoFaces' },
  { pose: 'oblique', config: 'boxTwoFaces', priorSigma: 2 },
  { pose: 'oblique', config: 'boxTwoFacesCorner' },
];

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const pair = (values: number[], digits: number): string =>
  `${quantile(values, .5).toFixed(digits)} / ${quantile(values, .95).toFixed(digits)}`;

console.log(`試行 ${TRIALS} 回、ノイズ 各軸 ±${NOISE_PX} px (一様)、出力 ${OUTPUT.width}×${OUTPUT.height}、正解の縦画角 ${TRUE_FOV}°`);
console.log('投射比あり = 縦画角の事前分布 (中心に ±σ の一様な誤差を入れる)。誤差は中央値 / 95 パーセンタイル。');
console.log('頂点誤差は縮尺を最小二乗で正解に合わせた後の最大誤差 (cm)。ok = 全量が決まったと診断した割合。\n');
console.log('| 配置 | なぞり方 | 投射比 | ok | 画角誤差 (°) | 頂点誤差 (cm) | 誤った解 | 再投影 RMS (px) | 1px あたりの画角の不確かさ (°、固定は 0) | 時間 (ms) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const c of CASES) {
  const { projector, label } = POSES[c.pose];
  const config = CONFIGS[c.config];
  let ok = 0, wrong = 0;
  const fovErrors: number[] = [], vertexErrors: number[] = [], rms: number[] = [], fovStd: number[] = [], times: number[] = [];
  for (let trial = 0; trial < TRIALS; trial++) {
    const rng = random(1000 + trial);
    const vertices = observe(projector, config.ids, { noise: NOISE_PX, rng });
    const fovPrior = c.priorSigma ? { degrees: TRUE_FOV + (rng() * 2 - 1) * c.priorSigma, sigmaDegrees: c.priorSigma } : undefined;
    const started = performance.now();
    const known = c.knownIntrinsics
      ? { initial: { verticalFovDegrees: TRUE_FOV, lensShift: projector.lensShift }, locked: ['fov', 'lensShiftX', 'lensShiftY'] as const }
      : {};
    const result = reconstructVenue({ output: OUTPUT, vertices, elements: config.elements, fovPrior, ...known, locked: known.locked && [...known.locked] });
    times.push(performance.now() - started);
    if (result.status === 'ok') ok++;
    const error = compareUpToScale(projector, result.vertices, config.ids).maxError;
    if (error > WRONG_SOLUTION_METERS) wrong++;
    fovErrors.push(Math.abs(result.projector.verticalFovDegrees - TRUE_FOV));
    vertexErrors.push(error * 100);
    rms.push(result.rmsPixels);
    fovStd.push(result.uncertainty.fovDegrees ?? 0);
  }
  const percent = (n: number) => `${Math.round(n / TRIALS * 100)}%`;
  const intrinsics = c.knownIntrinsics ? '画角・シフトを固定' : c.priorSigma ? `σ ${c.priorSigma}°` : 'なし';
  console.log(`| ${label} | ${config.label} | ${intrinsics} | ${percent(ok)} | ${pair(fovErrors, 2)} | ${pair(vertexErrors, 1)} | ${percent(wrong)} | ${quantile(rms, .5).toFixed(2)} | ${quantile(fovStd, .5).toFixed(2)} | ${quantile(times, .5).toFixed(0)} |`);
}
