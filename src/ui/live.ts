/* Live runtime: one clock, two patients (A and B) beating independently on it.
   Keeps the latest beat and the last few seconds of beats (for the monitor strip). */
import { newClock, tick, type Clock, type Warp } from '../engine/clock';
import { catchUp, newPatientSim, nextBeat, setEvents, setTargets, type Beat, type PatientSim } from '../engine/patient';
import { simulate, type BeatResult } from '../model/solve';
import type { AppState, PatientId } from '../state/types';

const KEEP_S = 20;   // seconds of beats kept for the monitor strip

export class Live {
  clock: Clock;
  sims: Record<PatientId, PatientSim>;
  beats: Record<PatientId, Beat | null> = { A: null, B: null };
  recent: Record<PatientId, Beat[]> = { A: [], B: [] };
  pinned: BeatResult | null = null;
  private listeners = new Set<(id: PatientId, b: Beat) => void>();

  constructor(app: AppState) {
    this.clock = { ...newClock(app.t), paused: app.paused, warp: app.warp };
    this.sims = { A: newPatientSim(app.patients.A.inputs, app.patients.A.events, app.t), B: newPatientSim(app.patients.B.inputs, app.patients.B.events, app.t) };
    this.pinned = app.pinned ? simulate(app.pinned.params) : null;
    // first beats so every view has something to draw
    for (const id of ['A', 'B'] as PatientId[]) this.push(id, nextBeat(this.sims[id]));
  }

  onBeat(fn: (id: PatientId, b: Beat) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private push(id: PatientId, r: { sim: PatientSim; beat: Beat }): void {
    this.sims[id] = r.sim; this.beats[id] = r.beat;
    const list = this.recent[id];
    list.push(r.beat);
    while (list.length > 2 && list[0].tStart < r.beat.tStart - KEEP_S) list.shift();
    this.listeners.forEach(fn => fn(id, r.beat));
  }

  /** Advance by a real-time interval and generate any beats now due. */
  frame(realDt: number): void {
    this.clock = tick(this.clock, realDt);
    for (const id of ['A', 'B'] as PatientId[]) {
      const r = catchUp(this.sims[id], this.clock.t);
      if (!r.beats.length) { this.sims[id] = r.sim; continue; }
      // emit each generated beat in order
      let sim = this.sims[id];
      for (const b of r.beats) { sim = { ...r.sim, last: b }; this.push(id, { sim, beat: b }); }
      this.sims[id] = r.sim;
    }
  }

  /** While paused: advance exactly one beat of the active patient; the other catches up. */
  step(active: PatientId): void {
    if (!this.clock.paused) return;
    const other: PatientId = active === 'A' ? 'B' : 'A';
    this.push(active, nextBeat(this.sims[active]));
    this.clock = { ...this.clock, t: this.beats[active]!.tStart };
    const r = catchUp(this.sims[other], this.clock.t);
    for (const b of r.beats) this.push(other, { sim: r.sim, beat: b });
    this.sims[other] = r.sim;
  }

  setPaused(p: boolean): void { this.clock = { ...this.clock, paused: p }; }
  setWarp(w: Warp): void { this.clock = { ...this.clock, warp: w }; }

  /** Apply the store's inputs and drug events (inputs ease in over 3 beats). */
  sync(app: AppState): void {
    for (const id of ['A', 'B'] as PatientId[]) {
      const p = app.patients[id];
      this.sims[id] = setEvents(setTargets(this.sims[id], p.inputs), p.events);
    }
  }

  /** Restart both patients from the store state (after loading a link or file). */
  reset(app: AppState): void {
    this.clock = { ...this.clock, t: app.t, paused: app.paused, warp: app.warp };
    for (const id of ['A', 'B'] as PatientId[]) {
      this.sims[id] = newPatientSim(app.patients[id].inputs, app.patients[id].events, app.t);
      this.recent[id] = [];
      this.push(id, nextBeat(this.sims[id]));
    }
    this.pinned = app.pinned ? simulate(app.pinned.params) : null;
  }
}
