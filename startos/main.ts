import { sdk } from './sdk'
import { i18n } from './i18n'
import {
  uiPort,
  getNextcloudEnv,
  getPostgresEnv,
  getNextcloudSub,
  getPostgresSub,
  getValkeySub,
  getBaseDaemons,
} from './utils'
import { configPhp } from './fileModels/config.php'

export const main = sdk.setupMain(async ({ effects }) => {
  /**
   * ======================== Setup ========================
   */
  console.info(i18n('Starting Nextcloud...'))

  // get interface details
  const hostnames = await sdk.serviceInterface
    .getOwn(effects, 'ui', (u) =>
      u?.addressInfo?.public.hostnames.map((h) => h.hostname) || [],
    )
    .const()

  await configPhp.merge(effects, {
    trusted_domains: ['localhost', ...(hostnames || [])],
  })

  const nextcloudSub = await getNextcloudSub(effects)
  const valkeySub = await getValkeySub(effects)
  const postgresEnv = getPostgresEnv()

  /**
   * ======================== Daemons ========================
   */
  /**
   * Shell script that registers qBittorrent's download volume as a Nextcloud
   * "External Storage" (local) so users can browse downloaded files.
   * Idempotent — skips creation if the mount already exists, and is a no-op
   * when qBittorrent is not installed (the /mnt/qbittorrent dir won't exist).
   */
  const setupQbitStorage = [
    // bail out early when the dependency volume is not mounted
    'test -d /mnt/qbittorrent || exit 0',
    // enable the external-storage app (ships with Nextcloud, may be disabled)
    'php /var/www/html/occ app:enable files_external 2>/dev/null || true',
    // allow "local" storage backends (disabled by default in recent NC versions)
    'php /var/www/html/occ config:system:set files_external_allow_create_new_local --value=true --type=boolean 2>/dev/null || true',
    // if a mount named "qBittorrent" already exists, just re-scan and exit
    'php /var/www/html/occ files_external:list 2>/dev/null | grep -qi qbittorrent && { php /var/www/html/occ files:scan --all -q 2>/dev/null || true; exit 0; }',
    // create the external storage mount
    'RESULT=$(php /var/www/html/occ files_external:create "qBittorrent Downloads" local null::null --config datadir=/mnt/qbittorrent 2>&1)',
    // extract the numeric mount-id from "Storage created with id <N>"
    'MOUNT_ID=$(echo "$RESULT" | grep -o "[0-9]*" | head -1)',
    // make it visible to every user
    'test -n "$MOUNT_ID" && php /var/www/html/occ files_external:applicable --add-all "$MOUNT_ID" 2>/dev/null || true',
    // index the files so they appear immediately
    'php /var/www/html/occ files:scan --all -q 2>/dev/null || true',
    'exit 0',
  ].join('; ')

  return getBaseDaemons(
    effects,
    await getPostgresSub(effects),
    nextcloudSub,
    valkeySub,
    postgresEnv,
  ).addDaemon('nextcloud', {
    subcontainer: nextcloudSub,
    exec: {
      command: sdk.useEntrypoint(),
      env: getNextcloudEnv(postgresEnv),
    },
    ready: {
      display: i18n('Web Interface'),
      fn: () =>
        sdk.healthCheck.checkPortListening(effects, uiPort, {
          successMessage: i18n('The web interface is ready'),
          errorMessage: i18n('The web interface is not ready'),
        }),
    },
    requires: ['chown', 'postgres', 'valkey'],
  }).addOneshot('setup-qbit-storage', {
    subcontainer: nextcloudSub,
    exec: {
      command: ['sh', '-c', setupQbitStorage],
      user: 'www-data',
    },
    requires: ['nextcloud'],
  })
})
