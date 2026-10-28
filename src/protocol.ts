import type { Composition, Settings } from './optimizer';
import type { DirectionPolicy } from './language';
export { families } from './fonts';
export type { Typeface } from './fonts';
import type { Typeface } from './fonts';
export interface ComposeRequest {
  id: number;
  paragraphs: string[];
  settings: Settings;
  typeface: Typeface;
  direction: DirectionPolicy;
}
export type WorkerResponse = ComposeResponse | { kind: 'ready' };
export interface ComposeResponse {
  id: number;
  result?: Composition;
  elapsed: number;
  measurements: number;
  fontMs: number;
  measureMs: number;
  searchMs: number;
  error?: string;
}
