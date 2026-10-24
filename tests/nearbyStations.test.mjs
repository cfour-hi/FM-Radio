import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceKm, nearestStations, nearbyDistanceLabel, accuracyLabel } from '../src/lib/nearbyStations.ts';
const origin = { lat: 0, lon: 0 };
const station = (id, lat, lon, clicks = 1) => ({ id, geo: { lat, lon }, clicks });

test('球面距离支持赤道、日界线、重合点和对跖点', () => {
  assert.equal(distanceKm(origin, origin), 0);
  assert.ok(Math.abs(distanceKm(origin, { lat: 0, lon: 1 }) - 111.195) < 0.001);
  assert.ok(Math.abs(distanceKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }) - 222.390) < 0.001);
  assert.ok(Math.abs(distanceKm(origin, { lat: 0, lon: 180 }) - 20015.114) < 0.001);
});

test('全球电台按距离排序，剔除无效坐标，同距离按热度排序且不改变原目录', () => {
  const stations = [station('far', 30, 110), station('near', 0, 1), station('same', 0, 1, 5),
    station('invalid', 91, 0), { id: 'missing', geo: null }, station('nan', NaN, 0)];
  const before = stations.slice();
  assert.deepEqual(nearestStations(stations, origin).map(s => s.station.id), ['same', 'near', 'far']);
  assert.deepEqual(stations, before);
  assert.deepEqual(nearestStations(stations, { lat: Infinity, lon: 0 }), []);
  assert.deepEqual(nearestStations(stations, origin, 0), []);
});

test('默认仅最近50台，分批目录到达后新近台进入结果', () => {
  const stations = Array.from({ length: 60 }, (_, i) => station(String(i), 0, i + 1));
  const result = nearestStations(stations, origin);
  assert.equal(result.length, 50);
  assert.equal(result[49].station.id, '49');
  const updated = nearestStations([...stations, station('new', 0, 0)], origin);
  assert.equal(updated[0].station.id, 'new');
  assert.equal(updated[49].station.id, '48');
});

test('估算电台及低精度位置不展示伪精确距离，省级位置明确标注', () => {
  const item = { station: station('a', 0, 0), distance: 26.53 };
  assert.equal(nearbyDistanceLabel(item, 20), '约 27 公里');
  assert.equal(nearbyDistanceLabel(item, 1500), '约 30 公里');
  assert.equal(nearbyDistanceLabel({ ...item, station: { ...item.station, geoApprox: true } }, 20), '约 30 公里 · 位置为估算');
  assert.equal(nearbyDistanceLabel({ ...item, distance: 0, station: { ...item.station, geoPrecision: 'province' } }, 20), '小于 10 公里 · 省级位置估算');
  assert.equal(nearbyDistanceLabel({ ...item, distance: 0.3 }, 20), '小于 1 公里');
  assert.equal(accuracyLabel(23), '约 30 米');
  assert.equal(accuracyLabel(1500), '约 2 公里');
});
