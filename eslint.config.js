import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  ...tseslint.configs.recommended,
  {
    // Hexagonal boundary: ImportCore is pure. It must not reach for the CLI
    // framework, the logger, env loading, or any adapter/CLI module.
    // See docs/import-cli-spec/adr/0002-hexagonal-core-cli-as-adapter.md.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'commander', message: 'ImportCore must not depend on the CLI framework.' },
            { name: 'pino', message: 'ImportCore must not depend on the logger.' },
            { name: 'pino-pretty', message: 'ImportCore must not depend on the logger.' },
            { name: 'dotenv', message: 'ImportCore must not load env; that is a CLI concern.' },
            {
              name: 'undici',
              message: 'ImportCore must not perform HTTP; use the StrapiClient port.',
            },
          ],
          patterns: [
            {
              group: ['**/adapters/**', '**/cli/**'],
              message:
                'ImportCore must not import an adapter or the CLI. Depend on the StrapiClient port instead.',
            },
          ],
        },
      ],
    },
  },
);
