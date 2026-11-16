/**
 * 依存なしの密な非線形最小二乗 (Levenberg–Marquardt)。
 * 未知数は高々百個程度を想定し、ヤコビアンは中心差分で求める。
 * 会場の逆算 (venueReconstruct.ts) のための汎用部品で、DOM・three.js に依存しない。
 */

export type ResidualFunction = (x: readonly number[]) => number[];

export interface LmOptions {
  maxIterations?: number;
  /** コストの相対減少・ステップの相対長がこれを下回ったら収束とみなす。 */
  tolerance?: number;
  initialLambda?: number;
}

export interface LmResult {
  x: number[];
  /** ½‖r‖² */
  cost: number;
  residuals: number[];
  iterations: number;
  converged: boolean;
}

/** 中心差分のヤコビアン (行 = 残差、列 = 未知数)。 */
export function numericJacobian(f: ResidualFunction, x: readonly number[], r0?: number[]): number[][] {
  const base = r0 ?? f(x);
  const m = base.length, n = x.length;
  const jacobian = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  const probe = [...x];
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]));
    probe[j] = x[j] + h;
    const plus = f(probe);
    probe[j] = x[j] - h;
    const minus = f(probe);
    probe[j] = x[j];
    for (let i = 0; i < m; i++) jacobian[i][j] = (plus[i] - minus[i]) / (2 * h);
  }
  return jacobian;
}

/** JᵀJ と Jᵀr。 */
export function normalEquations(jacobian: readonly number[][], residuals: readonly number[]): { a: number[][]; g: number[] } {
  const n = jacobian[0]?.length ?? 0;
  const a = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const g = new Array<number>(n).fill(0);
  for (let i = 0; i < jacobian.length; i++) {
    const row = jacobian[i], ri = residuals[i];
    for (let p = 0; p < n; p++) {
      const v = row[p];
      if (v === 0) continue;
      g[p] += v * ri;
      const ap = a[p];
      for (let q = p; q < n; q++) ap[q] += v * row[q];
    }
  }
  for (let p = 0; p < n; p++) for (let q = 0; q < p; q++) a[p][q] = a[q][p];
  return { a, g };
}

/** 対称正定値行列のコレスキー分解。正定値でなければ null。 */
export function cholesky(a: readonly number[][]): number[][] | null {
  const n = a.length;
  const l = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= l[i][k] * l[j][k];
      if (i === j) {
        if (!(sum > 0) || !Number.isFinite(sum)) return null;
        l[i][i] = Math.sqrt(sum);
      } else {
        l[i][j] = sum / l[j][j];
      }
    }
  }
  return l;
}

/** L Lᵀ x = b を解く。 */
export function choleskySolve(l: readonly number[][], b: readonly number[]): number[] {
  const n = l.length;
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= l[i][k] * y[k];
    y[i] = sum / l[i][i];
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= l[k][i] * x[k];
    x[i] = sum / l[i][i];
  }
  return x;
}

const halfSquaredNorm = (r: readonly number[]): number => {
  let sum = 0;
  for (const v of r) sum += v * v;
  return Number.isFinite(sum) ? sum / 2 : Infinity;
};

/** Marquardt の対角スケーリング付き LM。 */
export function levenbergMarquardt(f: ResidualFunction, x0: readonly number[], options: LmOptions = {}): LmResult {
  const maxIterations = options.maxIterations ?? 200;
  const tolerance = options.tolerance ?? 1e-12;
  let lambda = options.initialLambda ?? 1e-3;
  let x = [...x0];
  let residuals = f(x);
  let cost = halfSquaredNorm(residuals);
  let converged = false;
  let iterations = 0;
  if (x.length === 0) return { x, cost, residuals, iterations, converged: true };

  while (iterations < maxIterations && !converged) {
    iterations++;
    const { a, g } = normalEquations(numericJacobian(f, x, residuals), residuals);
    if (Math.max(...g.map(Math.abs)) < 1e-14) { converged = true; break; }
    let accepted = false;
    while (!accepted) {
      const damped = a.map((row, i) => row.map((v, j) => i === j ? v + lambda * Math.max(v, 1e-12) : v));
      const l = cholesky(damped);
      if (!l) { lambda *= 10; if (lambda > 1e16) break; continue; }
      const step = choleskySolve(l, g).map(v => -v);
      const candidate = x.map((v, i) => v + step[i]);
      const nextResiduals = f(candidate);
      const nextCost = halfSquaredNorm(nextResiduals);
      if (nextCost < cost) {
        const stepNorm = Math.hypot(...step), xNorm = Math.hypot(...x);
        const relativeDecrease = (cost - nextCost) / Math.max(cost, 1e-300);
        x = candidate; residuals = nextResiduals; cost = nextCost;
        lambda = Math.max(lambda / 3, 1e-15);
        accepted = true;
        if (relativeDecrease < tolerance || stepNorm < tolerance * (xNorm + tolerance) || cost < 1e-24) converged = true;
      } else {
        lambda *= 4;
        if (lambda > 1e16) break;
      }
    }
    if (!accepted) { converged = true; break; }
  }
  return { x, cost, residuals, iterations, converged };
}

/**
 * 解での (JᵀJ)⁻¹ の対角 (各未知数の分散)。残差が「1 単位 = 観測の標準偏差」で
 * 重み付けされている前提で、そのまま標準偏差の 2 乗になる。決まらない方向は巨大な値になる。
 * 3×3 の小ブロックが欲しいときのため、逆行列全体を返す。
 */
export function covariance(f: ResidualFunction, x: readonly number[]): number[][] {
  const residuals = f(x);
  const { a } = normalEquations(numericJacobian(f, x, residuals), residuals);
  const n = a.length;
  const scale = Math.max(...a.map((row, i) => row[i]), 1e-300);
  for (let attempt = 0; attempt < 8; attempt++) {
    const epsilon = scale * 1e-14 * 10 ** attempt;
    const l = cholesky(a.map((row, i) => row.map((v, j) => i === j ? v + epsilon : v)));
    if (!l) continue;
    return Array.from({ length: n }, (_, i) => {
      const e = new Array<number>(n).fill(0); e[i] = 1;
      return choleskySolve(l, e);
    });
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? Infinity : 0));
}
