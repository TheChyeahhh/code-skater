/**
 * src/app/game.ts (integration): the game chunk. Everything that needs three.js, the level builder,
 * the sim or the views is reached through this module, which src/app/boot.ts imports dynamically
 * after the main menu has painted (REQ-MNU-05, REQ-DEP-03). The vendor chunk (three, postprocessing,
 * n8ao, three-mesh-bvh) loads with it.
 */

export { createStage, type Stage } from './stage';
export { createGameSession, type GameSession } from './session';
export { createBoardPreview } from '../render/skater/boardPreview';
