'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './showcase.module.css';

type AudioGraph = { context: AudioContext; oscillators: OscillatorNode[]; gain: GainNode };

export default function AudioToggle() {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const graphRef = useRef<AudioGraph | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const toggle = useCallback(async () => {
    const graph = graphRef.current;
    if (enabledRef.current && graph) {
      enabledRef.current = false;
      setEnabled(false);
      clearStopTimer();
      const now = graph.context.currentTime;
      graph.gain.gain.cancelScheduledValues(now);
      graph.gain.gain.setTargetAtTime(0.0001, now, 0.09);
      stopTimerRef.current = window.setTimeout(() => { void graph.context.suspend(); }, 450);
      return;
    }

    try {
      clearStopTimer();
      let activeGraph = graphRef.current;
      if (!activeGraph) {
        const context = new AudioContext();
        const gain = context.createGain();
        gain.gain.value = 0.0001;
        gain.connect(context.destination);
        const oscillators = [48, 72].map((frequency, index) => {
          const oscillator = context.createOscillator();
          oscillator.type = index === 0 ? 'sine' : 'triangle';
          oscillator.frequency.value = frequency;
          const voice = context.createGain();
          voice.gain.value = index === 0 ? 0.7 : 0.12;
          oscillator.connect(voice).connect(gain);
          oscillator.start();
          return oscillator;
        });
        activeGraph = { context, oscillators, gain };
        graphRef.current = activeGraph;
      }
      await activeGraph.context.resume();
      const now = activeGraph.context.currentTime;
      activeGraph.gain.gain.cancelScheduledValues(now);
      activeGraph.gain.gain.setTargetAtTime(0.018, now, 0.8);
      enabledRef.current = true;
      setEnabled(true);
    } catch {
      enabledRef.current = false;
      setEnabled(false);
    }
  }, [clearStopTimer]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const graph = graphRef.current;
      if (!graph) return;
      if (document.hidden) void graph.context.suspend();
      else if (enabledRef.current) void graph.context.resume();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearStopTimer();
      const graph = graphRef.current;
      graphRef.current = null;
      if (graph) {
        graph.oscillators.forEach((oscillator) => oscillator.stop());
        void graph.context.close();
      }
    };
  }, [clearStopTimer]);

  return (
    <button
      aria-label={enabled ? 'Turn sound off' : 'Turn sound on'}
      aria-pressed={enabled}
      className={styles.audioButton}
      onClick={() => { void toggle(); }}
      type="button"
    >
      Sound {enabled ? 'on' : 'off'}
    </button>
  );
}
