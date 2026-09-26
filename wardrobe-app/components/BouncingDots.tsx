import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

const DOT_COUNT = 3;
const BOUNCE_MS = 420;
/** Offset between one dot starting its bounce and the next. */
const STAGGER_MS = 140;
const TRAVEL = 5;

/**
 * A looping "working on it" indicator.
 *
 * Replaces a changing status label. The wording used to move between
 * "Hearing…" and "Reading…", which drew the eye to a distinction the user has
 * no reason to care about; a steady animation says "still going" without
 * asking to be read.
 *
 * Each dot loops a single Animated.timing, never Animated.sequence -- RN's
 * Animated.sequence unconditionally reports _isUsingNativeDriver() as false
 * regardless of what's inside it (see AnimatedImplementation.js), so
 * Animated.loop(Animated.sequence([...])) always restarts every cycle via a
 * JS-thread callback, even when every individual timing inside it has
 * useNativeDriver: true. That restart callback queues up and stalls under
 * JS-thread congestion, which is what made these dots freeze in practice
 * (observed: advancing only once per unrelated keystroke). Looping a bare
 * Animated.timing instead takes Animated.loop's native-loop path
 * (_startNativeLoop), so the entire repeat cycle -- not just each frame --
 * runs on the native thread, immune to whatever the JS thread is doing.
 *
 * The up-down bounce shape comes from interpolating that single 0->1 ramp
 * through a midpoint, not from two separate timings -- and the softness the
 * original's separate ease-out/ease-in phases gave comes from applying
 * Easing.inOut(Easing.quad) to the ramp itself (shaping the value's own
 * progress through time), which composes with the interpolation's midpoint
 * breakpoint to decelerate into the peak and accelerate away from it, the
 * same visual effect, still as one timing.
 *
 * The only remaining JS-thread dependency is the one-time per-dot stagger
 * delay at mount, which is unavoidable (Animated.delay is itself JS-driven)
 * but no longer part of the repeating cycle -- a busy JS thread at mount
 * could start the dots less staggered than intended, but once started, each
 * loop runs independently of it.
 */
export function BouncingDots({ color = '#1A1714' }: { color?: string }) {
  // Created once: re-creating the values each render would restart every loop
  // and the dots would never fall out of step with each other.
  const values = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    const loops = values.map((value) =>
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: BOUNCE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    );
    const delays = values.map((_, index) => Animated.delay(index * STAGGER_MS));

    delays.forEach((delay, index) => {
      delay.start(({ finished }) => {
        if (finished) loops[index].start();
      });
    });

    // Braced for the same reason as the effect body: what a cleanup function
    // returns is not meant to be anything.
    return () => {
      delays.forEach((delay) => delay.stop());
      loops.forEach((loop) => loop.stop());
    };
  }, [values]);

  return (
    <View className="flex-row items-end h-3">
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: color,
            marginHorizontal: 2,
            transform: [
              {
                translateY: value.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0, -TRAVEL, 0],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
}
