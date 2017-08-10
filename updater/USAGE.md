# Autoupdater

## Usage

### Node >=v8.x.x

```sh
cd updater
npm install --production
node updater.js
```

### Node < v8.x.x

Older versions do not support async/await so a polyfill is provided by Babel.

```sh
cd updater
npm install
./node_modules/.bin/babel updater.js > updater.dist.js
node updater.dist.js
```

### Cron

You can create a cronjob as follows:

```sh
@hourly NODE_ENV=cron node /path/to/picluster/updater/updater.js
```

### Systemd Timer

To Do

### Pm2

To Do
