// eslint.config.js (integration): lint for the whole repo, plus the house-law guards from AGENTS.md
// that a linter can enforce: the sim is pure (no Math.random, no clocks, no DOM, no render classes)
// and the level builder emits geometry, never meshes or materials.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** three.js names the sim may import: math, geometry for three-mesh-bvh, face sides. */
const SIM_THREE_ALLOWED = [
  'Vector2', 'Vector3', 'Vector4', 'Quaternion', 'Euler', 'Matrix3', 'Matrix4', 'Ray', 'Box3', 'Sphere',
  'Plane', 'Line3', 'Triangle', 'MathUtils', 'Spherical', 'Cylindrical', 'BufferGeometry', 'BufferAttribute',
  'Float32BufferAttribute', 'Uint16BufferAttribute', 'Uint32BufferAttribute', 'DoubleSide', 'FrontSide', 'BackSide',
];

/** three.js names banned in src/levels (rendering classes); geometry classes stay allowed. */
const RENDER_CLASS_PATTERN = '^(WebGL.*|Scene|Mesh|InstancedMesh|SkinnedMesh|Group|Object3D|Points|Sprite|Line|LineSegments|LineLoop|.*Material|.*Texture|.*Light|.*Camera|Fog|FogExp2)$';

const PURE_RESTRICTIONS = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use the seedable Rng from src/core/rng.ts (REQ-CTL-16).' },
    { object: 'Date', property: 'now', message: 'Sim time only (REQ-TIM-03).' },
    { object: 'performance', property: 'now', message: 'Sim time only (REQ-TIM-03).' },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: 'Sim time only (REQ-TIM-03).' },
    { name: 'performance', message: 'Sim time only (REQ-TIM-03).' },
    { name: 'requestAnimationFrame', message: 'The sim is driven by FixedLoop ticks.' },
    { name: 'setTimeout', message: 'Sim time only.' },
    { name: 'setInterval', message: 'Sim time only.' },
    { name: 'window', message: 'No DOM in the sim.' },
    { name: 'document', message: 'No DOM in the sim.' },
    { name: 'localStorage', message: 'Saves happen outside the sim tick (REQ-SAV-03).' },
  ],
};

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'screenshots/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // Contract stubs keep documented parameter names they do not use yet.
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'dev/**/*.mjs', '*.config.{js,ts,mjs}', 'tests/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/sim/**/*.ts', 'src/input/parser.ts', 'src/input/frameBuilder.ts'],
    rules: {
      ...PURE_RESTRICTIONS,
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', allowImportNames: SIM_THREE_ALLOWED, message: 'Only three.js math / geometry in the sim.' },
            { name: 'postprocessing', message: 'No rendering in the sim.' },
            { name: 'n8ao', message: 'No rendering in the sim.' },
          ],
          patterns: [
            { group: ['three/examples/*', 'three/addons/*'], message: 'No three.js addons in the sim.' },
            { group: ['**/render/**', '**/ui/**', '**/audio/**', '**/app/**', '**/save/**'], message: 'The sim imports core, data, levels/types, input and sim only.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/levels/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'postprocessing', message: 'Levels emit data and geometry only.' },
            { name: 'n8ao', message: 'Levels emit data and geometry only.' },
          ],
          patterns: [
            { group: ['three'], importNamePattern: RENDER_CLASS_PATTERN, message: 'Levels emit BufferGeometry and data, never meshes, materials or textures.' },
            { group: ['**/render/**', '**/ui/**', '**/audio/**', '**/app/**', '**/sim/**'], message: 'Levels import core, data and three geometry only.' },
          ],
        },
      ],
    },
  },
);
