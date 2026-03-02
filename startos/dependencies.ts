import { sdk } from './sdk'

export const setDependencies = sdk.setupDependencies(
  async ({ effects }) => ({
    qbittorrent: {
      kind: 'exists' as const,
      versionRange: '>=0.0.0',
    },
  }),
)
