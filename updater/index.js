const fs = require('fs');
const exec = require('child-process-promise').exec;
const execSync = require('child_process').execSync;

// Change the working directory to this script
// This is important because the working directory
// of a cronjob probably won't be here...
process.chdir(__dirname);

if (process.env.PICLUSTER_CONFIG) {
  var config = JSON.parse(fs.readFileSync(process.env.PICLUSTER_CONFIG, 'utf8'));
} else {
  var config = JSON.parse(fs.readFileSync('../config.json', 'utf8'));
}

function validateInterval(interval) {
  interval = Number(interval);
  if (!isNaN(interval) && interval > -1) {
    return interval;
  } else {
    return -1;
  }
}

function checkUpdate(func, interval) {
  // If the NODE_ENV environment variable is set to cron
  // we won't run in the background we'll check for updates
  // once and then exit. Cron will be responsible for scheduling
  // when the script runs. A sample cronjob is as follows:
  // @hourly NODE_ENV=cron node /path/to/picluster/updater/index.js
  if (process.env.NODE_ENV === 'cron') {
    return func();
  } else {
    return setInterval(func, interval);
  }
}

function getInterval() {
  // Override the interval using the CONFIG_UPDATER_INTERVAL environment variable.
  if (validateInterval(process.env.CONFIG_UPDATER_INTERVAL) > -1) {
    return Number(process.env.CONFIG_UPDATER_INTERVAL);
  } else if (Object(config.updater).hasOwnProperty('interval') &&
             validateInterval(config.updater.interval) > -1) {
    return Number(config.updater.interval);
  } else {
    return 3600000; // Check once an hour by default
  }
}

function getChannel() {
  if (process.env.CONFIG_UPDATER_CHANNEL) {
    return process.env.CONFIG_UPDATER_CHANNEL;
  } else if (Object(config.updater).hasOwnProperty('channel')) {
    return config.updater.channel;
  } else {
    return 'master';
  }
}

function upstreamCommit() {
  return new Promise(function(resolve, reject) {
    exec([
      "git",
      "ls-remote",
      "https://github.com/picluster/picluster.git", //To Do: This shouldn't be here and should be defined in a package.json somewhere...
      getChannel()
    ].join(' ')).then(function(output) {
      return resolve(output.stdout.replace(/\s.*/g, ""));
    }).catch(function(err) {
      return reject(err);
    });
  });
}

function localCommit() {
  return new Promise(function(resolve, reject) {
    exec([
      "git",
      "rev-parse",
      getChannel()
    ].join(' ')).then(function(output) {
      return resolve(output.stdout.replace(/\s.*/g, ""));
    }).catch(function(err) {
      return reject(err);
    });
  });
}

function currentBranch() {
  return new Promise(function(resolve, reject) {
    exec([
      "git",
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ].join(' ')).then(function(output) {
      return resolve(output.stdout.replace(/\s.*/g, ""));
    }).catch(function(err) {
      return reject(err);
    });
  });
}

checkUpdate(async function() {
  const localcommit = await localCommit();
  const remotecommit = await upstreamCommit();
  console.log(localcommit);
  console.log(remotecommit);
  if (localcommit === remotecommit) { return; }
  // Stash changes. This will deal with the whole "What if there are conflicts?" situation
  // Git will store the changes and they can be re-applied later via `git stash apply`
  try {
    execSync("git stash");
  } catch (err) {
    console.error(`Command \`${err.cmd}\` has failed with exit code ${err.status}`);
  }
  try {
    execSync(`git fetch https://github.com/picluster/picluster.git ${getChannel()}`);
  } catch (err) {
    // An error probably means the branch doesn't exist on the remote end or github
    // is having issues...
    console.error(`Command \`${err.cmd}\` has failed with exit code ${err.status}`);
  }
  if (await currentBranch() !== getChannel()) {
    try {
      execSync(`git checkout ${getChannel()}`);
    } catch (err) {
      // If an error occurs then the working directory is probably dirty...
      console.error(`Command \`${err.cmd}\` has failed with exit code ${err.status}`);
    }
  }
  [
    "agent",
    "server",
    "web",
    "updater"
  ].forEach(function(dir) {
    try {
      execSync([
        "npm",
        "install",
        "--production"
      ].join(' '), {cwd: `${__dirname}/../${dir}`});
    } catch (err) {
      console.error(`Command \`${err.cmd}\` has failed with exit code ${err.status}`);
    }
  });
}, getInterval());
