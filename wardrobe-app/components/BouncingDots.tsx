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
 * Uses the built-in Animated with the native driver, so it keeps moving while
 * JavaScript is busy handling the response.
 */
export function BouncingDots({ color = '#0f172a' }: { color?: string }) {
  // Created once: re-creating the values each render would restart every loop
  // and the dots would never fall out of step with each other.
  const values = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    const animations = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * STAGGER_MS),
          Animated.timing(value, {
            toValue: 1,
            duration: BOUNCE_MS / 2,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: BOUNCE_MS / 2,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((DOT_COUNT - 1 - index) * STAGGER_MS),
        ]),
      ),
    );

    animations.forEach((animation) => {
      animation.start();
    });
    // Braced for the same reason as the effect body: what a cleanup function
    // returns is not meant to be anything.
    return () => {
      animations.forEach((animation) => {
        animation.stop();
      });
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
              { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -TRAVEL] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}
