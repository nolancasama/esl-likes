import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAVORITE_REGIONS,
  FREE_REGIONS,
  LABEL_REGIONS,
  MIN_HIT,
  PICTURE_SIZE,
  PIECES,
  PIVOTS,
  REGIONS,
  REGIONS_BY_PIECE,
  REGION_BY_ID,
  REGION_IDS,
  REQUIRED_REGIONS,
  hitBounds,
  labelPlacement,
  pieceBounds,
  regionAt,
  regionBounds,
  shapeBounds,
  tappablePoint,
} from './robotDefinition.js';

test('every region id is unique and stable', () => {
  assert.equal(new Set(REGION_IDS).size, REGION_IDS.length);
  for (const region of REGIONS) {
    assert.equal(typeof region.id, 'string');
    assert.ok(region.id.length > 0);
    assert.equal(REGION_BY_ID[region.id], region);
  }
});

test('the robot has one favourite region, two labelled, and fifteen free', () => {
  assert.equal(FAVORITE_REGIONS.length, 1);
  assert.equal(LABEL_REGIONS.length, 2);
  assert.equal(FREE_REGIONS.length, 15);
  assert.equal(REGIONS.length, 18);
  assert.equal(REQUIRED_REGIONS.length, 3);
});

test('every region declares a known type', () => {
  for (const region of REGIONS) {
    assert.ok(['free', 'required-label', 'required-favorite'].includes(region.type), region.id);
  }
});

test('a labelled region carries no hint of the favourite, and the starred one carries no label', () => {
  for (const region of LABEL_REGIONS) {
    // The label is the instruction itself and is set per round, not baked in.
    assert.equal(region.label, undefined, `${region.id} must not hard-code a colour`);
  }
  for (const region of FAVORITE_REGIONS) {
    assert.equal(region.label, undefined);
  }
});

test('the region-to-piece mapping is total and onto', () => {
  for (const region of REGIONS) {
    assert.ok(PIECES.includes(region.piece), `${region.id} -> unknown piece ${region.piece}`);
  }
  for (const piece of PIECES) {
    assert.ok(REGIONS_BY_PIECE[piece].length > 0, `${piece} owns no regions`);
  }
  const mapped = PIECES.flatMap((piece) => REGIONS_BY_PIECE[piece]);
  assert.equal(mapped.length, REGIONS.length, 'a region is claimed by more than one piece');
  assert.deepEqual([...mapped].sort(), [...REGION_IDS].sort());
});

test('the puppet has nine pieces and every one has a pivot', () => {
  assert.equal(PIECES.length, 9);
  for (const piece of PIECES) {
    const pivot = PIVOTS[piece];
    assert.ok(pivot, `${piece} has no pivot`);
    assert.ok(Number.isFinite(pivot.x) && Number.isFinite(pivot.y), piece);
  }
});

test('every required region belongs to a piece, so it survives into the puppet', () => {
  for (const region of REQUIRED_REGIONS) {
    assert.ok(REGIONS_BY_PIECE[region.piece].includes(region.id), region.id);
  }
});

test('every shape is finite and inside the picture', () => {
  for (const region of REGIONS) {
    assert.ok(region.shapes.length > 0, `${region.id} has no shape`);
    const box = regionBounds(region.id);
    for (const value of Object.values(box)) assert.ok(Number.isFinite(value), region.id);
    assert.ok(box.minX >= 0 && box.minY >= 0, `${region.id} starts outside the picture`);
    assert.ok(box.maxX <= 1 && box.maxY <= 1, `${region.id} runs past the picture`);
  }
});

test('no region is too small to tap on a touchpad', () => {
  for (const region of REGIONS) {
    const box = hitBounds(region.id);
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    assert.ok(width >= MIN_HIT - 1e-9, `${region.id} hit width ${width} < ${MIN_HIT}`);
    assert.ok(height >= MIN_HIT - 1e-9, `${region.id} hit height ${height} < ${MIN_HIT}`);
  }
});

test('a thin detail still draws thin even though it is easy to hit', () => {
  const drawn = regionBounds('antennaStalk');
  const hit = hitBounds('antennaStalk');
  assert.ok(drawn.maxX - drawn.minX < MIN_HIT, 'the stalk should be drawn thinner than the touch floor');
  assert.ok(hit.maxX - hit.minX >= MIN_HIT, 'but it must still be comfortably clickable');
});

test('a point inside a required panel picks the panel, not the body beneath it', () => {
  // The chest panel sits on top of the body; both contain this point.
  assert.equal(regionAt(0.5, 0.48), 'chestPanel');
  assert.ok(REGION_BY_ID.body.shapes.some((shape) => (
    0.5 >= shape.x && 0.5 <= shape.x + shape.width
    && 0.48 >= shape.y && 0.48 <= shape.y + shape.height
  )), 'the body really does overlap that point');
});

test('the eyes win over the face they sit on', () => {
  assert.equal(regionAt(0.5, 0.23), 'eyes');
});

test('points in plain regions resolve to themselves', () => {
  assert.equal(regionAt(0.226, 0.46), 'leftUpperArm');
  assert.equal(regionAt(0.774, 0.6), 'rightForearm');
  assert.equal(regionAt(0.4, 0.7), 'leftLeg');
  assert.equal(regionAt(0.5, 0.045), 'antennaLight');
});

test('a point well outside the robot belongs to nothing', () => {
  assert.equal(regionAt(0.02, 0.98), null);
  assert.equal(regionAt(0.98, 0.02), null);
});

test('piece bounds cover every region the piece owns', () => {
  for (const piece of PIECES) {
    const box = pieceBounds(piece);
    for (const regionId of REGIONS_BY_PIECE[piece]) {
      const inner = regionBounds(regionId);
      assert.ok(inner.minX >= box.minX - 1e-9 && inner.maxX <= box.maxX + 1e-9, `${piece}/${regionId} x`);
      assert.ok(inner.minY >= box.minY - 1e-9 && inner.maxY <= box.maxY + 1e-9, `${piece}/${regionId} y`);
    }
  }
});

test('the definition is frozen, so nothing can reshape the robot at runtime', () => {
  assert.ok(Object.isFrozen(REGIONS));
  assert.ok(Object.isFrozen(REGIONS[0]));
  assert.ok(Object.isFrozen(REGIONS[0].shapes));
});

test('the arms read as arms: clearly longer than they are wide', () => {
  for (const side of ['left', 'right']) {
    const upper = regionBounds(`${side}UpperArm`);
    const fore = regionBounds(`${side}Forearm`);
    const width = upper.maxX - upper.minX;
    const length = fore.maxY - upper.minY;
    assert.equal(width, fore.maxX - fore.minX, `${side} arm changes width at the elbow`);
    assert.ok(length / width >= 3.5, `${side} arm is stubby: ${(length / width).toFixed(2)}:1`);
    // The elbow is where the two segments meet, and the pivot sits there.
    assert.ok(Math.abs(upper.maxY - fore.minY) < 1e-9, `${side} arm has a gap at the elbow`);
  }
});

test('nothing floats: arms are held off the body and the shoulder cap bridges the gap', () => {
  const body = regionBounds('body');
  const arm = regionBounds('leftUpperArm');
  const gap = body.minX - arm.maxX;
  assert.ok(gap > 0.02, `no shoulder gap (${gap.toFixed(3)})`);
  const cap = REGION_BY_ID.shoulders.shapes.map(shapeBounds)[0];
  assert.ok(cap.minX < arm.maxX && cap.maxX > body.minX, 'the cap does not bridge arm to body');
  assert.ok(REGION_BY_ID.shoulders.order > REGION_BY_ID.body.order,
    'the cap must draw over the torso, not under it');
});

test('the legs are tucked under the torso rather than floating below it', () => {
  const body = regionBounds('body');
  for (const leg of ['leftLeg', 'rightLeg']) {
    assert.ok(regionBounds(leg).minY <= body.maxY, `${leg} floats below the body`);
  }
  for (const [leg, foot] of [['leftLeg', 'leftFoot'], ['rightLeg', 'rightFoot']]) {
    assert.ok(Math.abs(regionBounds(leg).maxY - regionBounds(foot).minY) < 1e-9,
      `${leg} does not meet ${foot}`);
  }
});

test('every labelled region has somewhere legible to put its word', () => {
  for (const region of LABEL_REGIONS) {
    const place = labelPlacement(region.id);
    assert.ok(place, region.id);
    const width = (place.maxX - place.minX) * PICTURE_SIZE;
    const height = (place.maxY - place.minY) * PICTURE_SIZE;
    // `ORANGE` is the longest of the seven words; six bold monospace glyphs need
    // roughly 3.3em, and the halo adds another 0.28em.
    assert.ok(width / height >= 3.5,
      `${region.id}'s label box is too cramped for ORANGE (${width.toFixed(0)}x${height.toFixed(0)})`);
    assert.ok(height >= 30, `${region.id}'s label box is only ${height.toFixed(0)}px tall`);
  }
});

test('a label box either sits inside its region or announces a leader', () => {
  for (const region of REGIONS) {
    if (!region.labelBox) {
      assert.equal(labelPlacement(region.id).leader, false, region.id);
      continue;
    }
    const place = labelPlacement(region.id);
    const own = regionBounds(region.id);
    const overlaps = place.minX < own.maxX && place.maxX > own.minX
      && place.minY < own.maxY && place.maxY > own.minY;
    assert.equal(place.leader, !overlaps, region.id);
    if (place.leader) assert.ok(place.anchor, `${region.id} needs an anchor to draw a leader to`);
  }
});

test('the starred region needs no label box: its own shape holds a star easily', () => {
  for (const region of FAVORITE_REGIONS) {
    assert.equal(region.labelBox, undefined, region.id);
    const own = regionBounds(region.id);
    assert.ok((own.maxY - own.minY) * PICTURE_SIZE >= 44, region.id);
  }
});

test('every region can actually be tapped — none is buried under another', () => {
  for (const region of REGIONS) {
    assert.ok(tappablePoint(region.id), `${region.id} has no point that colours it`);
  }
});

test('a tap in the middle of the torso colours the chest panel, not the body', () => {
  // The inverse of the test above, spelled out: overlap is intended, and a
  // harness or a child aiming at a bounding-box centre gets the top region.
  const body = regionBounds('body');
  assert.equal(regionAt((body.minX + body.maxX) / 2, (body.minY + body.maxY) / 2), 'chestPanel');
});
