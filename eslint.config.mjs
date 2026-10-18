import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/release/**', 'packages/api-client/src/schema.ts', '.local/**', 'docs/**'] }, js.configs.recommended, ...ts.configs.recommended, {
  files: ['**/*.ts', '**/*.tsx'],
  rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] }
});
