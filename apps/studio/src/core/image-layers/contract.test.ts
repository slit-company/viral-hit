import test from 'node:test';
import assert from 'node:assert/strict';
import { imageLayersRequest, layerBox, moveLayer, newLayer, nextLayerId } from './contract';

test('layers move one place at a time, keep distinct IDs and map to the same pixels everywhere', () => {
  const layers = ['a', 'b', 'c'].map((assetId, index) => newLayer(index, assetId, assetId));
  assert.deepEqual(moveLayer(layers, 'layer-1', 1).map(layer => layer.assetId), ['b', 'a', 'c']);
  assert.deepEqual(moveLayer(layers, 'layer-3', 1).map(layer => layer.assetId), ['a', 'b', 'c']);
  assert.deepEqual(moveLayer(layers, 'layer-1', -1).map(layer => layer.assetId), ['a', 'b', 'c']);
  assert.equal(nextLayerId([{ id: 'layer-1' }, { id: 'layer-3' }]), 'layer-4');
  assert.deepEqual(layerBox({ x: 0.25, y: -0.1, scale: 0.5, width: 400, height: 300 }, { width: 1000, height: 800 }), { left: 250, top: -80, width: 200, height: 150 });
  const update = { action: 'update', stackId: 's', revision: 1, layers: [layers[0], { ...layers[1], id: 'layer-1' }] };
  assert.equal(imageLayersRequest.safeParse(update).success, false, 'duplicate layer IDs');
  assert.equal(imageLayersRequest.safeParse({ ...update, layers: [{ ...layers[0], opacity: 1.5 }] }).success, false, 'opacity above 1');
  assert.equal(imageLayersRequest.safeParse({ ...update, layers: [{ ...layers[0], width: 10 }] }).success, false, 'pixel sizes come from the image');
});
