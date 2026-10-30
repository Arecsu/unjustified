import type { Composition, Settings } from './optimizer';
import type { DirectionPolicy } from './language';
import type { FontBinary } from './fonts';
import type { PackedCandidates } from './pack';
export { families } from './fonts';
export type { Typeface } from './fonts';
import type { Typeface } from './fonts';
/** Pre-fetch and prepare the worker's font subsets while the page is painting. */
export interface WarmRequest {
  warm: true;
  typeface: Typeface;
  text: string;
  fonts?: FontBinary[];
}

export interface ComposeRequest {
  id: number;
  paragraphs: string[];
  settings: Settings;
  typeface: Typeface;
  direction: DirectionPolicy;
  fonts?: FontBinary[];
}
export type WorkerResponse =
  | ComposeResponse
  | { kind: 'ready' | 'booted' | 'warm-start' | 'warm-fonts' | 'warm-jit' }
  | { kind: 'warm-error'; detail: string };
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

/** Composer → paragraph helper. */
export type HelperRequest =
  | { kind: 'fonts'; fonts: FontBinary[] }
  | { kind: 'work'; id: number; paragraphs: { index: number; text: string }[];
      settings: Settings; typeface: Typeface; direction: DirectionPolicy };
/** Paragraph helper → composer. */
export interface HelperResponse {
  id: number;
  results: { index: number; packed: PackedCandidates }[];
  measurements: number;
  measureMs: number;
  error?: string;
}
