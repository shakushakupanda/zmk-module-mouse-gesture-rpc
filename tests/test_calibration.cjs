const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { buildSync } = require('../web/node_modules/esbuild');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-calibration-'));
for (const name of ['flickCalibration', 'mouseGestureProto']) {
  buildSync({ entryPoints: [path.join(__dirname, '../web/src/lib', name + '.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dir, name + '.cjs') });
}
const { calibrate } = require(path.join(dir, 'flickCalibration.cjs'));
const proto = require(path.join(dir, 'mouseGestureProto.cjs'));
const settings = { inertialScrollTickMs: 20, inertialScrollIdleMs: 80, inertialScrollMinVelocityQ8: 64, inertialScrollImpulsePercent: 100 };
function samples(dt, n) {
  return Array.from({length: 4}, (_, t) => Array.from({length: n}, (_, i) => ({tsMs: t * 1000 + i * dt, amount: 1, negative: false, axis: 0}))).flat();
}
const normal = samples(70, 4), flick = samples(10, 8);
const result = calibrate(normal, flick, settings);
assert.equal(result.detectedFlicks, 4);
assert.throws(() => calibrate(normal, normal, settings), /区別/);
assert.throws(() => calibrate([], flick, settings), /3回/);
const horizontal = flick.map(s => ({ ...s, negative: true, axis: 1 }));
assert.equal(calibrate(normal, horizontal, settings).detectedFlicks, 4);
// Settings fields 14..16 survive decoding; legacy missing fields remain zero.
// Verify using the request encoder's nested Settings message, replacing the outer tag.
const base = proto.parseResponse(Uint8Array.from([42, 2, 10, 0])).settings;
const encoded = proto.buildSetSettingsRequest({...base, inertialScrollFlickWindowMs: 120, inertialScrollFlickMinCounts: 7, inertialScrollFlickMaxGapMs: 50});
encoded[0] = 42;
const decoded = proto.parseResponse(encoded).settings;
assert.equal(decoded.inertialScrollFlickWindowMs, 120);
assert.equal(decoded.inertialScrollFlickMinCounts, 7);
assert.equal(decoded.inertialScrollFlickMaxGapMs, 50);
assert.equal(base.inertialScrollFlickWindowMs, 0);
const capture = proto.parseResponse(Uint8Array.from([58, 14, 8, 1, 16, 1, 42, 8, 8, 20, 16, 3, 24, 1, 32, 1])).capture;
assert.equal(capture.samples[0].amount, 3);
assert.equal(capture.samples[0].axis, 1);
assert.equal(capture.samples[0].negative, true);
console.log('PASS: calibration separation, overlap rejection, insufficient data, horizontal flick, protocol compatibility');
fs.rmSync(dir, { recursive: true });
