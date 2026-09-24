// Types for scripts/lib/brandScan.mjs so TypeScript tests can import it.
export declare const ROOT: string;
export declare const BRANDS_FILE: string;
export declare function realNames(): string[];
export declare function bannedFranchiseNames(): string[];
export declare function forbiddenTerms(): string[];
export declare function walk(dir: string, skipDirs?: Set<string>): string[];
export interface ScanHit {
  readonly file: string;
  readonly term: string;
  readonly context: string;
}
export declare function scanFiles(files: readonly string[], terms: readonly string[]): ScanHit[];
