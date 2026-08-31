import React from 'react';
import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { TodayDataProvider, useTodayData, type TodayLoadState } from '../TodayDataContext';
import { currentLocation } from '../../services/location';
import { fetchTodayForecast } from '../../services/weather';
import { fetchTodayCandidates } from '../../services/outfitGenerator';
import { getLatestLoggedOutfit } from '../../services/items';

// This test is only about reload() request ordering, not any one service's
// own behaviour — every dependency loadToday touches is stubbed so the test
// can control exactly when each step of two overlapping loads resolves.
// jest.mock calls are hoisted above these imports regardless of source
// order, so the imports above already resolve to the mocked modules.
jest.mock('../../services/location', () => ({ currentLocation: jest.fn() }));
jest.mock('../../services/weather', () => ({ fetchTodayForecast: jest.fn() }));
jest.mock('../../services/outfitGenerator', () => ({ fetchTodayCandidates: jest.fn() }));
jest.mock('../../services/items', () => ({ getLatestLoggedOutfit: jest.fn() }));
jest.mock('../../services/database', () => ({
  initDatabase: jest.fn(() => Promise.resolve()),
  withDb: jest.fn((fn: (db: unknown) => Promise<unknown>) => fn({})),
}));

/** A promise this test can resolve on its own schedule, to force a specific completion order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Flushes every already-queued microtask, unlike a fixed number of `await Promise.resolve()` hops. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function Probe({ onValue }: { onValue: (value: ReturnType<typeof useTodayData>) => void }) {
  const value = useTodayData();
  onValue(value);
  return null;
}

describe('TodayDataProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchTodayForecast as jest.Mock).mockResolvedValue({ tempC: 10, feltTempC: 10, windSpeedKph: 5 });
    (fetchTodayCandidates as jest.Mock).mockResolvedValue(null);
  });

  it("applies only the latest reload()'s result when an earlier one resolves after it", async () => {
    // The provider's own mount effect fires the first reload (request A);
    // this test fires a second one (request B) before A's location fix
    // resolves, then resolves B first and A afterward — exactly the
    // "earlier request finishes last" ordering a stale response would
    // otherwise win under.
    const locationA = deferred<{ ok: true; coords: { latitude: number; longitude: number } }>();
    const locationB = deferred<{ ok: true; coords: { latitude: number; longitude: number } }>();
    (currentLocation as jest.Mock)
      .mockReturnValueOnce(locationA.promise)
      .mockReturnValueOnce(locationB.promise);
    // getLatestLoggedOutfit is only reached after each request's own
    // location resolves, so the real call order tracks resolution order,
    // not start order — the first actual call belongs to whichever request
    // resolves its location first.
    (getLatestLoggedOutfit as jest.Mock)
      .mockResolvedValueOnce([{ id: 'from-B' }])
      .mockResolvedValueOnce([{ id: 'from-A' }]);

    let latest!: ReturnType<typeof useTodayData>;
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <TodayDataProvider>
          <Probe onValue={(value) => (latest = value)} />
        </TodayDataProvider>,
      );
    });
    expect(latest.state.step).toBe('loading');

    // Request B: a second reload before A has resolved anything.
    act(() => {
      latest.reload();
    });

    // Resolve B (the newer request) first.
    await act(async () => {
      locationB.resolve({ ok: true, coords: { latitude: 1, longitude: 1 } });
      await flushMicrotasks();
    });

    const afterB = latest.state as Extract<TodayLoadState, { step: 'ready' }>;
    expect(afterB.step).toBe('ready');
    expect(afterB.wornToday).toEqual([{ id: 'from-B' }]);

    // Resolve A (the stale, earlier request) afterward — its result must be
    // discarded rather than overwriting B's, which is already on screen.
    await act(async () => {
      locationA.resolve({ ok: true, coords: { latitude: 0, longitude: 0 } });
      await flushMicrotasks();
    });

    const finalState = latest.state as Extract<TodayLoadState, { step: 'ready' }>;
    expect(finalState.step).toBe('ready');
    expect(finalState.wornToday).toEqual([{ id: 'from-B' }]);

    await act(async () => {
      tree.unmount();
      await flushMicrotasks();
    });
  });
});
