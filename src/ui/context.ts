import type { Store } from '../state/store';
import type { Live } from './live';
import type { PatientId, TabId } from '../state/types';

/** Shared handles every UI module receives. */
export interface Ctx {
  store: Store;
  live: Live;
  /** id of the patient being edited/viewed */
  active(): PatientId;
  tab(): TabId;
  explain(id: string): void;
  /** dispatch a drug action at the current clock time */
  syncClock(): void;
}
