/* Synthesised heart sounds (Web Audio). S1 "lub": lower and longer (mitral + tricuspid
   closure); S2 "dub": higher and shorter (aortic + pulmonary closure). Each is a short,
   damped low-frequency tone with a falling pitch plus a burst of low-pass noise.
   Real heart sounds sit around 20–150 Hz; the tones here are pitched a little higher
   (S1 ≈ 70 Hz, S2 ≈ 110 Hz, with harmonics) so laptop speakers can play them. */

export class HeartSounds {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  on = false;

  /** Turn sound on or off. Must be called from a click (browsers only allow audio after a user gesture). */
  toggle(): boolean {
    this.on = !this.on;
    if (this.on) {
      try {
        if (!this.ac) {
          const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AC) { this.on = false; return false; }
          this.ac = new AC();
          this.master = this.ac.createGain(); this.master.gain.value = 0.9;
          const comp = this.ac.createDynamicsCompressor();
          this.master.connect(comp); comp.connect(this.ac.destination);
        }
        void this.ac.resume();
      } catch { this.on = false; }
    } else void this.ac?.suspend();
    return this.on;
  }

  play(which: 1 | 2): void {
    if (!this.on || !this.ac || !this.master) return;
    const ac = this.ac, t = ac.currentTime + 0.005;
    const f0 = which === 1 ? 70 : 110, dur = which === 1 ? 0.14 : 0.10, amp = which === 1 ? 0.9 : 0.75;
    for (const [mult, a] of [[1, 1], [2, 0.45], [3, 0.2]] as const) {
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0 * mult * 1.15, t);
      o.frequency.exponentialRampToValueAtTime(f0 * mult * 0.8, t + dur);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(amp * a, t + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    // valve "click": short low-passed noise
    const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.18));
    const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), gn = ac.createGain();
    src.buffer = buf; lp.type = 'lowpass'; lp.frequency.value = which === 1 ? 180 : 260; gn.gain.value = 0.5;
    src.connect(lp); lp.connect(gn); gn.connect(this.master);
    src.start(t);
  }
}
