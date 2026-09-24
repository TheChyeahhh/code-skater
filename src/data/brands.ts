/**
 * src/data/brands.ts: the ONE brand table (SPEC §11, REQ-BRD-01..05). Frozen after M0.
 *
 * THIS IS THE ONLY FILE ALLOWED TO CONTAIN REAL COMPANY OR PERSON NAMES (AGENTS.md). Every other
 * file reads names from BRANDS. The mode is chosen at BUILD time by VITE_BRAND_MODE (".env" says
 * parody, ".env.private" says real for "npm run build:private"). Default and public build: parody.
 *
 * Dead-code elimination: BRANDS is a ternary on the statically replaced
 * import.meta.env.VITE_BRAND_MODE, so in a parody build the minifier folds it to parodyTable()
 * and drops realTable() with every real string in it. scripts/check-parody.mjs proves this on
 * dist/ after every build. Keep the real strings INSIDE realTable() between the markers below:
 * the check script reads that block to learn what it must not find.
 *
 * Design note: DESIGN REQ-BRD-01 describes two files (brands.real.ts / brands.parody.ts). SPEC §11
 * and AGENTS.md name this single file, so both tables live here (DESIGN §L CR-21).
 * Never reproduce logo artwork in either mode (REQ-BRD-03); names are plain text in original
 * typography. NPCs never attempt a real likeness in either mode (REQ-BRD-05).
 */

import type { MacGuffinId, NpcId, StickerSheetId } from '../core/types';

export type BrandMode = 'parody' | 'real';

/** Role keys, never names: labA = the "North Star" slot, labB = the "Canticle" slot, chip = the "Vidia" slot. */
export type BrandKey = 'labA' | 'labB' | 'chip';

export interface CompanyBrand {
  /** Company name as written in copy. */
  readonly name: string;
  /** Uppercase sign / sticker wordmark text (original typography, never a logo). */
  readonly wordmark: string;
  /** Product or platform name (assistant, compute platform). */
  readonly product: string;
}

export interface NpcBrand {
  /** Short name used in the dialog header: Sam / Dario in both modes. */
  readonly name: string;
  /** Full display line under the name. */
  readonly title: string;
  /** Dialog line (no em dashes, AGENTS.md / CR-17). */
  readonly line: string;
  /** Toast after the MacGuffin pickup. */
  readonly toast: string;
}

export interface MacGuffinBrand {
  /** Name in goal lists and the combo ticker. */
  readonly name: string;
  /** Full-width pickup splash (uppercase). */
  readonly splash: string;
}

export interface BrandTable {
  readonly companies: Readonly<Record<BrandKey, CompanyBrand>>;
  /** Display name of the special grind (trick id gpu_slide): "VIDA Slide" in parody. */
  readonly specialSlideName: string;
  readonly npcs: Readonly<Record<NpcId, NpcBrand>>;
  readonly macguffins: Readonly<Record<MacGuffinId, MacGuffinBrand>>;
}

function parodyTable(): BrandTable {
  // @brand-parody-begin
  return {
    companies: {
      labA: { name: 'North Star', wordmark: 'NORTH STAR', product: 'North Star' },
      labB: { name: 'Canticle', wordmark: 'CANTICLE', product: 'Canticle' },
      chip: { name: 'Vidia', wordmark: 'VIDIA', product: 'VIDA' },
    },
    specialSlideName: 'VIDA Slide',
    npcs: {
      sam: {
        name: 'Sam',
        title: 'Sam, lab director at North Star',
        line: "Hey, I lost my laptop. It's got all my code on it. Grab it before the demo.",
        toast: "Nice. Don't open README.md.",
      },
      dario: {
        name: 'Dario',
        title: 'Dario, safety lead at Canticle',
        line: 'The next model is on this hard drive. Please get it before anyone else does.',
        toast: 'Thank you. Do not inference this.',
      },
    },
    macguffins: {
      secret_laptop: { name: 'North Star Laptop', splash: 'NORTH STAR LAPTOP' },
      secret_drive: { name: 'Canticle Weights Drive', splash: 'CANTICLE WEIGHTS DRIVE' },
    },
  };
  // @brand-parody-end
}

function realTable(): BrandTable {
  // @brand-real-begin
  return {
    companies: {
      labA: { name: 'OpenAI', wordmark: 'OPENAI', product: 'OpenAI' },
      labB: { name: 'Anthropic', wordmark: 'ANTHROPIC', product: 'Claude' },
      chip: { name: 'NVIDIA', wordmark: 'NVIDIA', product: 'CUDA' },
    },
    specialSlideName: 'CUDA Slide',
    npcs: {
      sam: {
        name: 'Sam',
        title: 'Sam Altman',
        line: "Hey, I lost my laptop. It's got all my code on it. Grab it before the demo.",
        toast: "Nice. Don't open README.md.",
      },
      dario: {
        name: 'Dario',
        title: 'Dario Amodei',
        line: 'The next model is on this hard drive. Please get it before anyone else does.',
        toast: 'Thank you. Do not inference this.',
      },
    },
    macguffins: {
      secret_laptop: { name: 'Secret Laptop', splash: 'SECRET LAPTOP' },
      secret_drive: { name: 'Secret Drive', splash: 'SECRET DRIVE' },
    },
  };
  // @brand-real-end
}

/** Build-time brand mode. Anything but the literal "real" is parody. */
export const BRAND_MODE: BrandMode = import.meta.env.VITE_BRAND_MODE === 'real' ? 'real' : 'parody';

/** The active table. Read names through this, never hard-code them anywhere else. */
export const BRANDS: BrandTable = import.meta.env.VITE_BRAND_MODE === 'real' ? realTable() : parodyTable();

/** Sticker sheet labels for the Board Lab (REQ-LAB-01): the brand sheets read BRANDS. */
export function stickerSheetLabel(sheet: StickerSheetId): string {
  switch (sheet) {
    case 'labA':
    case 'labB':
    case 'chip':
      return BRANDS.companies[sheet].name;
    case 'wafer':
      return 'Wafer';
    case 'pcb':
      return 'PCB';
    case 'tokenStream':
      return 'Token Stream';
    case 'inference':
      return 'Inference';
  }
}
