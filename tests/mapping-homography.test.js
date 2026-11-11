import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CORNER_KEYS,
  applyQuadCanvas,
  applyVideoCrop,
  quadHomography,
  invertHomography,
  transformPoint,
  outputUvToCanvas,
  cropUvToSourceUv,
} from '../src/viewer/utils/mappingTransform.ts';

const { fixtures } = JSON.parse(readFileSync(new URL('./fixtures/mapping-css-baseline.json', import.meta.url), 'utf8'));
const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const nearPoint = (actual, expected, tolerance = 1e-8) => {
  assert.ok(actual, 'finite point expected');
  assert.ok(Math.abs(actual.x - expected.x) < tolerance, `x: ${actual.x} vs ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < tolerance, `y: ${actual.y} vs ${expected.y}`);
};

for (const fixture of fixtures) {
  test(`CSS coefficients / crop match pre-refactor output: ${fixture.name}`, () => {
    // Frozen from 4b2fc82, not calculated with the implementation under test.
    /** @type {any} Only style is used by the DOM adapters. */
    const container = { style: { visibility: '', transform: '' } };
    /** @type {any} */
    const video = { style: {} };
    applyQuadCanvas(container, fixture.quad, fixture.width, fixture.height);
    applyVideoCrop(video, fixture.source);
    assert.deepEqual(container.style, fixture.containerStyle);
    assert.deepEqual(video.style, fixture.videoStyle);
  });
}

test('forward / inverse maps corners and interior for affine, mirrored, offset and old strong-perspective quads', () => {
  for (const fixture of fixtures.filter(f => f.containerStyle.visibility !== 'hidden')) {
    const forward = quadHomography(fixture.quad);
    assert.ok(forward, fixture.name);
    const inverse = invertHomography(forward);
    assert.ok(inverse, fixture.name);
    for (const [i, uv] of corners.entries()) {
      nearPoint(transformPoint(forward, uv), fixture.quad[CORNER_KEYS[i]]);
      nearPoint(transformPoint(inverse, fixture.quad[CORNER_KEYS[i]]), uv);
    }
    for (const uv of [{ x: 0.17, y: 0.73 }, { x: 0.5, y: 0.5 }, { x: 0.95, y: 0.02 }]) {
      nearPoint(transformPoint(inverse, transformPoint(forward, uv)), uv);
    }
  }
});

test('interior of a trapezoid uses projective division, not two-triangle / bilinear interpolation', () => {
  const matrix = quadHomography({
    topLeft: { x: 0, y: 0 }, topRight: { x: 200, y: 0 },
    bottomRight: { x: 150, y: 100 }, bottomLeft: { x: 50, y: 100 },
  });
  nearPoint(transformPoint(matrix, { x: 0.5, y: 0.5 }), { x: 100, y: 200 / 3 });
  nearPoint(transformPoint(matrix, { x: 0.25, y: 0.5 }), { x: 200 / 3, y: 200 / 3 });
});

test('known projective maps recover independent interior samples across many quads', () => {
  for (let n = 1; n <= 200; n++) {
    // Analytic family: positive denominator over the unit square, translation,
    // nonuniform scale and shear; alternate winding without changing geometry rules.
    const a = n % 2 ? -320 : 320;
    const g = n / 250, h = n / 400;
    const project = ({ x, y }) => ({
      x: (a * x + 12 * y) / (1 + g * x + h * y) + n * 20,
      y: (8 * x + 240 * y) / (1 + g * x + h * y) - n * 5,
    });
    const quad = {
      topLeft: project(corners[0]), topRight: project(corners[1]),
      bottomRight: project(corners[2]), bottomLeft: project(corners[3]),
    };
    const matrix = quadHomography(quad);
    assert.ok(matrix);
    const uv = { x: 0.31, y: 0.67 };
    nearPoint(transformPoint(matrix, uv), project(uv));
    nearPoint(transformPoint(invertHomography(matrix), project(uv)), uv);
  }
});

test('invalid quads have no transform; invalid -> valid unhides CSS without a full-canvas flash', () => {
  const valid = fixtures[0].quad;
  /** @type {any} Only style is used by the DOM adapter. */
  const container = { style: { visibility: '', transform: '' } };
  applyQuadCanvas(container, valid, 640, 360);
  const previous = container.style.transform;
  for (const fixture of fixtures.filter(f => f.containerStyle.visibility === 'hidden')) {
    assert.equal(quadHomography(fixture.quad), null);
    applyQuadCanvas(container, fixture.quad, 640, 360);
    assert.equal(container.style.visibility, 'hidden');
    assert.equal(container.style.transform, previous);
  }
  applyQuadCanvas(container, valid, 640, 360);
  assert.equal(container.style.visibility, '');
  for (const x of [NaN, Infinity, -Infinity]) {
    assert.equal(quadHomography({ ...valid, topLeft: { x, y: 0 } }), null);
  }
});

test('zero-size CSS container keeps existing no-op behavior', () => {
  /** @type {any} Only style is used by the DOM adapter. */
  const container = { style: { visibility: 'hidden', transform: 'translate(1px)' } };
  for (const [width, height] of [[0, 360], [640, 0], [-1, 360]]) {
    applyQuadCanvas(container, fixtures[0].quad, width, height);
    assert.deepEqual(container.style, { visibility: 'hidden', transform: 'translate(1px)' });
  }
});

test('inverse can have a zero bottom-right coefficient and still be valid', () => {
  /** @type {import('../src/viewer/utils/mappingTransform.ts').Homography} */
  const matrix = [1, 0, 1, 0, 0, 1, 0, 1, 1];
  const inverse = invertHomography(matrix);
  assert.ok(inverse);
  assert.equal(Math.abs(inverse[8]), 0);
  const point = { x: 0.3, y: 0.7 };
  nearPoint(transformPoint(inverse, transformPoint(matrix, point)), point);
});

test('singular, non-finite and infinite-point results are explicit nulls', () => {
  assert.equal(invertHomography([1, 2, 3, 2, 4, 6, 0, 0, 1]), null);
  assert.equal(invertHomography([Infinity, 0, 0, 0, 1, 0, 0, 0, 1]), null);
  assert.equal(transformPoint([1, 0, 0, 0, 1, 0, 1, 0, 1], { x: -1, y: 0 }), null);
  assert.equal(transformPoint([1, 0, 0, 0, 1, 0, 0, 0, 1], { x: NaN, y: 0 }), null);
  // Small but invertible transforms must not be rejected by a pixel-sized epsilon.
  assert.ok(invertHomography([1e-8, 0, 0, 0, 1e-8, 0, 0, 0, 1]));
});

test('output UV -> canvas -> inverse quad -> crop agrees across adjacent outputs', () => {
  const left = { id: 'left', position: { x: 0, y: 30 }, size: { width: 320, height: 180 } };
  const right = { ...left, id: 'right', position: { x: 320, y: 30 }, pixelSize: { width: 3840, height: 2160 } };
  const quad = {
    topLeft: { x: 160, y: 30 }, topRight: { x: 480, y: 30 },
    bottomRight: { x: 480, y: 210 }, bottomLeft: { x: 160, y: 210 },
  };
  const inverse = invertHomography(quadHomography(quad));
  const crop = { x: 25, y: 10, width: 50, height: 80 };
  const sample = (out, uv) => cropUvToSourceUv(crop, transformPoint(inverse, outputUvToCanvas(out, uv)));
  nearPoint(sample(left, { x: 1, y: 0.5 }), { x: 0.5, y: 0.5 });
  nearPoint(sample(right, { x: 0, y: 0.5 }), { x: 0.5, y: 0.5 });
  nearPoint(sample(right, { x: 0.25, y: 0.5 }), { x: 0.625, y: 0.5 });
  nearPoint(outputUvToCanvas(right, { x: 0, y: 0 }), { x: 320, y: 30 });
  nearPoint(outputUvToCanvas(right, { x: 1, y: 1 }), { x: 640, y: 210 });
});

test('crop preserves out-of-image UVs and the existing minimum size for empty / negative dimensions', () => {
  nearPoint(cropUvToSourceUv({ x: -25, y: 80, width: 150, height: 60 }, { x: 0, y: 1 }), { x: -0.25, y: 1.4 });
  nearPoint(cropUvToSourceUv({ x: -25, y: 80, width: 150, height: 60 }, { x: 1, y: 0 }), { x: 1.25, y: 0.8 });
  for (const width of [0, -1, 0.00001]) {
    nearPoint(cropUvToSourceUv({ x: 30, y: 40, width, height: width }, { x: 1, y: 1 }), { x: 0.300001, y: 0.400001 });
  }
});
