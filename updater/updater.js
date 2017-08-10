const fs = require('fs');
const exec = require('child-process-promise').exec;
const execSync = require('child_process').execSync;

const pm2 = require('pm2');

const services = [
  "agent",
  "server",
  "webconsole",
  "updater"
];

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
  // @hourly NODE_ENV=cron node /path/to/picluster/updater/updater.js
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

function trackingBranch() {
  return new Promise(function(resolve, reject) {
    exec([
      "git",
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}"
    ].join(' ')).then(function(output) {
      return resolve(output.stdout.replace(/\s.*/g, ""));
    }).catch(function(err) {
      return reject(err);
    });
  });
}

// `git stash` requires an email to be set
// We'll set one locally (for this repo) if
// one isn't already set.
function getEmail() {
  try {
    return execSync(`git config user.email`);
  } catch (err) {
    return '';
  }
}

checkUpdate(async function() {
  const localcommit = await localCommit();
  const remotecommit = await upstreamCommit();
  console.log(localcommit);
  console.log(remotecommit);
  if (localcommit === remotecommit) { return; }
  // Stash changes. This will deal with the whole "What if there are conflicts?" situation
  // Git will store the changes and they can be re-applied later via `git stash apply`
  var unsetEmail = false;
  try {
    if (getEmail() === '') {
      unsetEmail = true;
      try {
        execSync(`git config user.email "you@example.com"`);
      } catch (err) {
        console.error(`Command \`${err.cmd}\` has failed with exit code ${err.status}`);
      }
    }
    execSync("git stash");
    if (unsetEmail) {
      try {
        execSync(`git config --unset user.email`);
      } catch (err) {
        console.error(`Command \`${err.cmd}\` has failed with exit code ${err.status}`);
      }
    }
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
  let trackingbranch;
  try {
    trackingbranch = await trackingBranch();
  } catch (err) {
    // Assume the tracking branch is origin
    // To Do:
    //  * Don't make this assumption, look at the remotes (git remote -v) and figure out which one we should use.
    //  Add a remote pointing to upstream picluster and track this if need be, in case any funny business is going on...
    trackingbranch = "origin";
  }
  execSync(`git pull --ff-only ${trackingbranch.replace('/', ' ')}`);
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
  pm2.connect(function(err) {
    if (err) { console.error(err); process.exit(2); }

    pm2.list(function(err, processes) {
      if (err) { console.error(err); process.exit(2); }

      const processList = processes.filter(function(e) {
        for (let i = 0, j = services.length; i < services.length/2; i++, j--) {
          if (e.name === services[i] ||
              e.name === services[j]) {
                return true;
          }
        }
        return false;
      });

      processList.forEach(function(process) {
        pm2.gracefulReload(process.name, function(err) {
          if (err) { console.error(err); }
        });
      });

      pm2.disconnect();
    });
  });
}, getInterval());
