/* eslint "no-warning-comments": [1, { "terms": ["todo","fixme"] }] */
const http = require('http');
const fs = require('fs');
const net = require('net');
const bodyParser = require('body-parser');

const express = require('express');
const dateTime = require('node-datetime');
const request = require('request');

const app = express();

let config;
let config_file;
if (process.env.PICLUSTER_CONFIG) {
  config = JSON.parse(fs.readFileSync(process.env.PICLUSTER_CONFIG, 'utf8'));
  config_file = process.env.PICLUSTER_CONFIG;
} else {
  config = JSON.parse(fs.readFileSync('../config.json', 'utf8'));
  config_file = '../config.json';
}
const port = config.server_port;
const agentPort = config.agent_port;

app.use(bodyParser());
// Require('request-debug')(request);
const server = http.createServer(app);

let log = '';
let token = config.token;
let dockerFolder = config.docker;
const container_faillog = [];
let running_containers = 0;
let total_containers = 0;
const multer = require('multer');

const upload = multer({
  dest: '../'
});

if (config.elasticsearch && config.elasticsearch_index) {
  const mapping = {
    settings: {
      index: {
        number_of_shards: 3,
        number_of_replicas: 2
      }
    },
    mappings: {
      picluster: {
        properties: {
          date: {
            type: 'date',
            index: 'true',
            format: 'yyyy-MM-dd HH:mm:ss'
          },
          data: {
            type: 'keyword',
            index: 'true'
          }
        }
      }
    }
  };

  const options = {
    url: config.elasticsearch + '/' + config.elasticsearch_index,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': mapping.length
    },
    body: JSON.stringify(mapping)
  };

  request(options, error => {
    console.log('\nCreating Elasticsearch Map......');
    if (error) {
      console.log(error);
    }
  });
}
if (config.automatic_heartbeat) {
  if (config.automatic_heartbeat.indexOf('enabled') > -1) {
    if (config.heartbeat_interval) {
      console.log('\nAutomatic Heartbeat Enabled. Will check every: ' + config.heartbeat_interval + ' ms.');
      automatic_heartbeat();
    } else {
      console.log('\nAutomatic Heartbeat Disabled: heartbeat_interval is not set.');
    }
  } else {
    console.log('\nAutomatic Heartbeat Disabled.');
  }
} else {
  console.log('\nAutomatic Heartbeat Disabled.');
}

function automatic_heartbeat() {
  if (config.automatic_heartbeat.indexOf('enabled') > -1) {
    setTimeout(() => {
      const options = {
        host: '127.0.0.1',
        path: '/hb?token=' + token,
        port
      };
      http.get(options).on('error', e => {
        console.error(e);
      });
      automatic_heartbeat();
    }, config.heartbeat_interval);
  } else {
    console.log('\nAutomatic Heartbeat Disabled.');
  }
}

function containerDetails() {
  setTimeout(() => {
    total_containers = 0;
    running_containers = 0;
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }
        total_containers++;
      });
    });

    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if (!config.layout[i].hasOwnProperty(key)) {
          return;
        }

        if (key.indexOf('node') > -1) {
          const command = JSON.stringify({
            command: 'docker ps -q | wc -l',
            token
          });

          const options = {
            url: 'http://' + node + ':' + agentPort + '/run',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': command.length
            },
            body: command
          };

          request(options, (error, response, body) => {
            if (error) {
              console.log('An error has occurred.');
            } else {
              const check_value = JSON.parse(body).output.toString();
              const found = check_value.replace(/ /g, '');
              running_containers += parseInt(found);
            }
          });
        }
      });
    });
    containerDetails();
  }, 15000);
}

app.get('/status-count', (req, res) => {
  const check_token = req.query.token;
  const data = JSON.stringify({
    total_containers,
    running_containers
  });

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    res.end(data);
  }
});

app.get('/status', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    const command = JSON.stringify({
      command: 'hostname;docker container ps;node -e \'const getos = require("picluster-getos");getos(function(e,os){var dist = (e) ? "" : os.dist || os.os;console.log("Dist: " + dist);})\'',
      token
    });
    for (let i = 0; i < config.layout.length; i++) {
      const node = config.layout[i].node;

      // Runs a command on each node
      const options = {
        url: 'http://' + node + ':' + agentPort + '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': command.length
        },
        body: command
      };

      request(options, (error, response) => {
        if (error) {
          res.end('An error has occurred.');
        } else {
          const results = JSON.parse(response.body);
          addLog('\nNode: ' + results.output);
        }
      });
    }
    res.end('');
  }
});

app.get('/clearlog', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    log = '';
    res.end();
  }
});

app.get('/nodes', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    const command = JSON.stringify({
      command: 'hostname;echo;uname -a;df -h /;node -e \'const getos = require("picluster-getos");getos(function(e,os){var dist = (e) ? "" : os.dist || os.os;console.log("Dist: " + dist);})\';node -e \'require("cpu-stats")(1000, (error, result) => { let usage = 0; result.forEach(e => { usage += e.cpu; });console.log(usage); });\'',
      token
    });
    for (let i = 0; i < config.layout.length; i++) {
      const node = config.layout[i].node;

      // Runs a command on each node
      const options = {
        url: 'http://' + node + ':' + agentPort + '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': command.length
        },
        body: command
      };

      request(options, (error, response) => {
        if (error) {
          res.end(error);
        } else {
          const results = JSON.parse(response.body);
          addLog('Node: ' + results.output);
        }
      });
    }
    res.end('');
  }
});

app.get('/images', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    const command = JSON.stringify({
      command: 'hostname;docker image list;node -e \'const getos = require("picluster-getos");getos(function(e,os){var dist = (e) ? "" : os.dist || os.os;console.log("Dist: " + dist);})\';',
      token
    });
    for (let i = 0; i < config.layout.length; i++) {
      const node = config.layout[i].node;

      // Runs a command on each node
      const options = {
        url: 'http://' + node + ':' + agentPort + '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': command.length
        },
        body: command
      };

      request(options, (error, response) => {
        if (error) {
          res.end('An error has occurred.');
        } else {
          const results = JSON.parse(response.body);
          addLog('\nNode: ' + results.output);
        }
      });
    }
    res.end('');
  }
});

function addLog(data) {
  log += data;
}

app.get('/build', (req, res) => {
  const check_token = req.query.token;
  const no_cache = req.query.no_cache;
  let image = '';
  if (req.query.image) {
    image = req.query.image;
  }

  if (image.indexOf('*') > -1) {
    image = '*';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }
        let command;
        if (no_cache.indexOf('true') > -1) {
          command = JSON.stringify({
            command: 'docker image build --no-cache ' + dockerFolder + '/' + key + ' -t ' + key + ' -f ' + dockerFolder + '/' + key + '/Dockerfile',
            token
          });
        } else {
          command = JSON.stringify({
            command: 'docker image build ' + dockerFolder + '/' + key + ' -t ' + key + ' -f ' + dockerFolder + '/' + key + '/Dockerfile',
            token
          });
        }

        const options = {
          url: 'http://' + node + ':' + agentPort + '/run',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': command.length
          },
          body: command
        };

        if ((image.indexOf('*') > -1) || key.indexOf(image) > -1) {
          request(options, (error, response) => {
            if (error) {
              res.end('An error has occurred.');
            } else {
              const results = JSON.parse(response.body);
              addLog('\n' + results.output);
            }
          });
        }
      });
    });
    res.end('');
  }
});

app.get('/delete-image', (req, res) => {
  const check_token = req.query.token;
  let image = '';
  if (req.query.image) {
    image = req.query.image;
  }

  if (image.indexOf('*') > -1) {
    image = '*';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }
        const command = JSON.stringify({
          command: 'docker image rm ' + key,
          token
        });

        const options = {
          url: 'http://' + node + ':' + agentPort + '/run',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': command.length
          },
          body: command
        };

        if ((image.indexOf('*') > -1) || key.indexOf(image) > -1) {
          request(options, (error, response) => {
            if (error) {
              res.end('An error has occurred.');
            } else {
              const results = JSON.parse(response.body);
              addLog('\n' + results.output);
            }
          });
        }
      });
    });
    res.end('');
  }
});

app.get('/create', (req, res) => {
  const check_token = req.query.token;
  let container = '';

  if (req.query.container) {
    container = req.query.container;
  }

  if (container.indexOf('*') > -1) {
    container = '*';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    let responseString = '';
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }
        const command = JSON.stringify({
          command: 'docker container run -d --name ' + key + ' ' + config.layout[i][key] + ' ' + key,
          token
        });

        const options = {
          hostname: node,
          port: agentPort,
          path: '/run',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': command.length
          }
        };

        if ((key.indexOf(container) > -1) || (container.indexOf('*')) > -1) {
          const request = http.request(options, response => {
            response.on('data', data => {
              responseString += data;
            });
            response.on('end', () => {
              if (responseString.body) {
                const body = responseString.body;
                const results = JSON.parse(body.toString('utf8'));
                addLog(results.output);
              }
            });
          }).on('error', e => {
            console.error(e);
          });
          request.write(command);
          req.end();
        }
      });
    });
  }
  res.end('');
});

app.get('/start', (req, res) => {
  const check_token = req.query.token;
  let container = '';
  if (req.query.container) {
    container = req.query.container;
  }
  if (container.indexOf('*') > -1) {
    container = '*';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }
        const command = JSON.stringify({
          command: 'docker container start ' + key,
          token
        });
        const options = {
          url: 'http://' + node + ':' + agentPort + '/run',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': command.length
          },
          body: command
        };
        if ((container.indexOf('*') > -1) || key.indexOf(container) > -1) {
          request(options, (error, response) => {
            if (error) {
              res.end('An error has occurred.');
            } else {
              const results = JSON.parse(response.body);
              addLog('\nStarting: ' + key + '\n' + results.output);
            }
          });
        }
      });
    });
    res.end('');
  }
});

function migrate(container, original_host, new_host, original_container_data) {
  let existing_automatic_heartbeat_value = '';
  if (config.automatic_heartbeat) {
    existing_automatic_heartbeat_value = config.automatic_heartbeat;
    if (config.automatic_heartbeat.indexOf('enabled') > -1) {
      config.automatic_heartbeat = 'disabled';
    }
  }
  const command = JSON.stringify({
    command: 'docker rm -f ' + container,
    token
  });
  const options = {
    url: 'http://' + original_host + ':' + agentPort + '/run',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': command.length
    },
    body: command
  };

  request(options, error => {
    if (error) {
      addLog('An error has occurred.');
    } else {
      const command = JSON.stringify({
        command: `docker image build ${dockerFolder}/${container} -t ${container} -f ${dockerFolder}/${container}/Dockerfile;docker container run -d --name ${container} ${original_container_data} ${container}`,
        token
      });

      const options = {
        url: 'http://' + new_host + ':' + agentPort + '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': command.length
        },
        body: command
      };

      request(options, error => {
        if (error) {
          addLog('An error has occurred.');
        } else {
          const command = JSON.stringify({
            command: 'docker container run -d --name ' + container + ' ' + original_container_data + ' ' + container,
            token
          });

          const options = {
            url: 'http://' + new_host + ':' + agentPort + '/run',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': command.length
            },
            body: command
          };
          request(options, error => {
            if (error) {
              addLog('An error has occurred.');
            } else {
              addLog('\nStarting ' + container);
              if (config.automatic_heartbeat) {
                if (existing_automatic_heartbeat_value.indexOf('enabled') > -1) {
                  config.automatic_heartbeat = existing_automatic_heartbeat_value;
                }
              }
            }
          });
        }
      });
    }
  });
}

app.get('/addhost', (req, res) => {
  const check_token = req.query.token;
  const host = req.query.host;

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    let proceed = 1;
    for (let i = 0; i < config.layout.length; i++) {
      /* eslint-disable no-unused-vars */
      for (const key in config.layout[i]) { // FixMe: Why is 'key' unused?
        if (config.layout[i].node.indexOf(host) > -1) {
          proceed = 0;
        }
      }
      /* eslint-enable no-unused-vars */
    }

    if (proceed) {
      // Add New Host
      config.layout.push({
        node: host
      });

      if (config.hb) {
        config.hb.push({
          node: host
        });
      }

      const new_config = JSON.stringify({
        payload: JSON.stringify(config),
        token
      });

      // Save Configuration
      const options = {
        url: `http://127.0.0.1:${port}/updateconfig`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': new_config.length
        },
        body: new_config
      };

      request(options, error => {
        if (error) {
          res.end(error);
        } else {
          res.end('\nAdded host ' + host + ' to the configuration.');
        }
      });
    } else {
      res.end('\nError: Host already exists');
    }
  }
});

function elasticsearch(data) {
  const dt = dateTime.create();

  const elasticsearch_data = JSON.stringify({
    data,
    date: dt.format('Y-m-d H:M:S')
  });

  const options = {
    url: config.elasticsearch + '/' + config.elasticsearch_index + '/' + config.elasticsearch_index,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': elasticsearch_data.length
    },
    body: elasticsearch_data
  };

  request(options, error => {
    if (error) {
      console.log(error);
    }
  });
}

app.get('/clear-elasticsearch', (req, res) => {
  const check_token = req.query.token;

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    const message = {
      query: {
        match_all: {}
      }

    };

    const options = {
      url: config.elasticsearch + '/' + config.elasticsearch_index,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': message.length
      },
      body: JSON.stringify(message)
    };

    request(options, (error, response, body) => {
      if (error) {
        res.end(error);
        console.log(error);
      } else {
        res.end('\nCleared Elasticsearch data');
        console.log('\nCleared Elasticsearch data:' + body);
      }
    });
  }
});

app.get('/rmhost', (req, res) => {
  const check_token = req.query.token;
  const host = req.query.host;
  let hb_proceed = 0; // FixMe: Should this be a boolean (true or false)?

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    // Ensures that the host exists
    for (let i = 0; i < config.layout.length; i++) {
      /* eslint-disable no-unused-vars */
      for (const key in config.layout[i]) { // FixMe: Why is 'key' unused?
        if (config.layout[i].node.indexOf(host) > -1) {
          config.layout.splice(i, 1);
          hb_proceed = 1;
          break;
        }
      }
      /* eslint-enable no-unused-vars */
    }
  }

  if (hb_proceed) {
    if (config.hb) {
      for (let i = 0; i < config.hb.length; i++) {
        /* eslint-disable no-unused-vars */
        for (const key in config.hb[i]) { // FixMe: Why is 'key' unused?
          if (config.hb[i].node.indexOf(host) > -1) {
            config.hb.splice(i, 1);
            break;
          }
        }
        /* eslint-enable no-unused-vars */
      }
    }
  }
  const new_config = JSON.stringify({
    payload: JSON.stringify(config),
    token
  });

  // Save Configuration
  const options = {
    url: `http://127.0.0.1:${port}/updateconfig`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': new_config.length
    },
    body: new_config
  };

  request(options, error => {
    if (error) {
      res.end(error);
    } else {
      res.end('\nAdded host ' + host + ' to the configuration.');
    }
  });
});

app.get('/removecontainerconfig', (req, res) => {
  const check_token = req.query.token;
  const container = req.query.container;

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }
        if (key.indexOf(container) > -1) {
          delete config.layout[i][key];
        }
      });
    });

    if (config.hb) {
      Object.keys(config.hb).forEach((get_node, i) => {
        Object.keys(config.hb[i]).forEach(key => {
          if ((!config.hb[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
            return;
          }
          if (key.indexOf(container) > -1) {
            delete config.hb[i][key];
          }
        });
      });
    }

    if (config.container_host_constraints) {
      Object.keys(config.container_host_constraints).forEach((get_node, i) => {
        Object.keys(config.container_host_constraints[i]).forEach(key => {
          if ((!config.container_host_constraints[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
            return;
          }
          const analyze = config.container_host_constraints[i][key].split(',');
          if (container.indexOf(analyze[0]) > -1) {
            config.container_host_constraints.splice(i, i + 1);
          }
        });
      });

      for (let i = 0; i < config.container_host_constraints.length; i++) {
        for (const key in config.container_host_constraints[i]) {
          if (container.length > 0) {
            const analyze = config.container_host_constraints[i][key].split(',');
            if (container.indexOf(analyze[0]) > -1) {
              config.container_host_constraints.splice(i, i + 1);
            }
          }
        }
      }
    }

    const new_config = JSON.stringify({
      payload: JSON.stringify(config),
      token
    });

    // Save Configuration
    const options = {
      url: `http://127.0.0.1:${port}/updateconfig`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': new_config.length
      },
      body: new_config
    };

    request(options, error => {
      if (error) {
        res.end(error);
      } else {
        res.end('\nRemoved Container ' + container + ' from the configuration.');
      }
    });
  }
});

app.get('/addcontainer', (req, res) => {
  const check_token = req.query.token;
  const host = req.query.host;
  const container = req.query.container;
  const container_args = req.query.container_args;
  const heartbeat_args = req.query.heartbeat_args;
  const failover_constraints = req.query.failover_constraints;

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    // Ensures that the host exists
    let proceed = 0;
    for (let i = 0; i < config.layout.length; i++) {
      /* eslint-disable no-unused-vars */
      for (const key in config.layout[i]) { // FixMe: Why isn't 'key' used?
        if (config.layout[i].node.indexOf(host) > -1) {
          proceed++;
        }
      }
      /* eslint-enable no-unused-vars */
    }

    if (proceed < 1) {
      res.end('\nError: Node does not exist!');
    } else {
      // Add Data to New Host

      for (let i = 0; i < config.layout.length; i++) {
        /* eslint-disable no-unused-vars */
        for (const key in config.layout[i]) { // FixMe: Why isn't 'key' used?
          if (config.layout[i].node.indexOf(host) > -1) {
            config.layout[i][container] = container_args;
          }
        }
        /* eslint-enable no-unused-vars */
      }

      // Adds Heartbeat Data
      if (config.hb) {
        if (heartbeat_args) {
          for (let i = 0; i < config.hb.length; i++) {
            /* eslint-disable no-unused-vars */
            for (const key in config.hb[i]) { // FixMe: Why isn't 'key' used?
              if (config.hb[i].node.indexOf(host) > -1) {
                config.hb[i][container] = heartbeat_args;
              }
            }
            /* eslint-enable no-unused-vars */
          }
        }
      }

      if (config.container_host_constraints) {
        if (failover_constraints) {
          config.container_host_constraints.push({
            container: failover_constraints
          });
        }
      }
      const new_config = JSON.stringify({
        payload: JSON.stringify(config),
        token
      });

      // Save Configuration
      const options = {
        url: `http://127.0.0.1:${port}/updateconfig`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': new_config.length
        },
        body: new_config
      };

      request(options, error => {
        if (error) {
          res.end(error);
        } else {
          // Res.end('\nAdded ' + container + ' to the configuration.');
          request(`http://127.0.0.1:${port}/changehost?token=${token}&container=${container}&newhost=${host}`, (error, response) => {
            if (!error && response.statusCode === 200) {
              res.end('\nAdded ' + container + ' to the configuration.');
            } else {
              res.end('\nError connecting with server.');
            }
          });
        }
      });
    }
  }
});

app.get('/changehost', (req, res) => {
  const check_token = req.query.token;
  let container = '';
  let original_host = '';
  let original_container_data = '';
  let original_heartbeat_data = '';
  const new_host = req.query.newhost;

  if (req.query.container) {
    container = req.query.container;
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    // Ensures that the host exists
    let proceed = 0;
    for (let i = 0; i < config.layout.length; i++) {
      for (const key in config.layout[i]) {
        if (container.length > 0) {
          if (config.layout[i].node.indexOf(new_host) > -1) {
            proceed++;
          }
          if (key.indexOf(container) > -1) {
            if (key.indexOf(config.layout[i].node)) {
              proceed++;
            }
          }
        }
      }
    }

    if (proceed < 2) {
      res.end('\nError: Node or Container does not exist!');
    } else {
      // Find Current Host
      for (let i = 0; i < config.layout.length; i++) {
        for (const key in config.layout[i]) {
          if (container.length > 0) {
            if (key.indexOf(container) > -1) {
              original_host = config.layout[i].node;
              original_container_data = config.layout[i][key];
              delete config.layout[i][key];
            }
          }
        }
      }

      if (config.hb) {
        // Checks for HB
        for (let i = 0; i < config.hb.length; i++) {
          for (const key in config.hb[i]) {
            if (container.length > 0) {
              if (key.indexOf(container) > -1) {
                original_heartbeat_data = config.hb[i][key];
                delete config.hb[i][key];
              }
            }
          }
        }
      }

      for (let i = 0; i < config.layout.length; i++) {
        /* eslint-disable no-unused-vars */
        for (const key in config.layout[i]) { // FixMe: Why isn't 'key' used?
          if (config.layout[i].node.indexOf(new_host) > -1) {
            config.layout[i][container] = original_container_data;
          }
        }
        /* eslint-enable no-unused-vars */
      }

      // Adds Heartbeat Data
      if (config.hb) {
        if (original_heartbeat_data) {
          for (let i = 0; i < config.hb.length; i++) {
            /* eslint-disable no-unused-vars */
            for (const key in config.hb[i]) { // FixMe: Why isn't 'key' used?
              if (config.hb[i].node.indexOf(new_host) > -1) {
                config.hb[i][container] = original_heartbeat_data;
              }
            }
            /* eslint-enable no-unused-vars */
          }
        }
      }

      const new_config = JSON.stringify({
        payload: JSON.stringify(config),
        token
      });

      // Save Configuration
      const options = {
        url: `http://127.0.0.1:${port}/updateconfig`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': new_config.length
        },
        body: new_config
      };

      request(options, error => {
        if (error) {
          res.end(error);
        } else {
          migrate(container, original_host, new_host, original_container_data);
          res.end('\nMigration may take awhile. Please observe the logs and running containers for the latest information.');
        }
      });
    }
  }
});

app.get('/stop', (req, res) => {
  const check_token = req.query.token;
  let container = '';
  if (req.query.container) {
    container = req.query.container;
  }
  if (container.indexOf('*') > -1) {
    container = '*';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }
        const command = JSON.stringify({
          command: 'docker container stop ' + key,
          token
        });
        const options = {
          url: 'http://' + node + ':' + agentPort + '/run',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': command.length
          },
          body: command
        };
        if ((container.indexOf('*') > -1) || key.indexOf(container) > -1) {
          request(options, (error, response) => {
            if (error) {
              res.end('An error has occurred.');
            } else {
              const results = JSON.parse(response.body);
              addLog('\nStopping: ' + key + '\n' + results.output);
            }
          });
        }
      });
    });
    res.end('');
  }
});

app.get('/delete', (req, res) => {
  const check_token = req.query.token;
  let container = '';
  if (req.query.container) {
    container = req.query.container;
  }

  if (container.indexOf('*') > -1) {
    container = '*';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }

        const command = JSON.stringify({
          command: 'docker container rm -f ' + key,
          token
        });
        const options = {
          url: `http://${node}:${agentPort}/run`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': command.length
          },
          body: command
        };

        if ((container.indexOf('*') > -1) || key.indexOf(container) > -1) {
          request(options, (error, response) => {
            if (error) {
              res.end('An error has occurred.');
            } else {
              const results = JSON.parse(response.body);
              addLog('\nStopping: ' + key + '\n' + results.output);
            }
          });
        }
      });
    });
  }
  res.end('');
});

app.get('/restart', (req, res) => {
  const check_token = req.query.token;
  let selected_container = '';
  if (req.query.container) {
    selected_container = req.query.container;
  }
  if (selected_container.indexOf('*') > -1) {
    selected_container = '*';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }
        const command = JSON.stringify({
          command: 'docker container restart ' + key,
          token
        });
        const options = {
          url: 'http://' + node + ':' + agentPort + '/run',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': command.length
          },
          body: command
        };
        if ((selected_container.indexOf('*') > -1) || key.indexOf(selected_container) > -1) {
          request(options, (error, response) => {
            if (error) {
              res.end('An error has occurred.');
            } else {
              const results = JSON.parse(response.body);
              addLog('\nRestarting: ' + key + '\n' + results.output);
            }
          });
        }
      });
    });
    res.end('');
  }
});

app.get('/containerlog', (req, res) => {
  const check_token = req.query.token;
  let selected_container = '';
  if (req.query.container) {
    selected_container = req.query.container;
  }
  if (selected_container.indexOf('*') > -1) {
    selected_container = '*';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    Object.keys(config.layout).forEach((get_node, i) => {
      Object.keys(config.layout[i]).forEach(key => {
        const node = config.layout[i].node;
        if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
          return;
        }

        const command = JSON.stringify({
          command: 'docker container logs ' + key,
          token
        });
        const options = {
          url: 'http://' + node + ':' + agentPort + '/run',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': command.length
          },
          body: command
        };
        if ((selected_container.indexOf('*') > -1) || key.indexOf(selected_container) > -1) {
          request(options, (error, response) => {
            if (error) {
              res.end('An error has occurred.');
            } else {
              const results = JSON.parse(response.body);
              addLog('\nLogs for Container: ' + key + '\n' + results.output);
            }
          });
        }
      });
    });
  }
  res.end('');
});

app.post('/listcontainers', (req, res) => {
  let node = req.body.node;
  const check_token = req.body.token;
  const output = [];
  let container;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    for (let i = 0; i < config.layout.length; i++) {
      for (const key in config.layout[i]) {
        if (config.layout[i].hasOwnProperty(key)) {
          container = key;
          node = config.layout[i].node;
          const check_port = config.layout[i][key];
          if (check_port !== node) {
            output.push(container);
          }
        }
      }
    }
    res.send(output);
  }
});

app.post('/listnodes', (req, res) => {
  const check_token = req.body.token;
  const output = [];
  let node;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    for (let i = 0; i < config.layout.length; i++) {
      for (const key in config.layout[i]) {
        if (config.layout[i].hasOwnProperty(key)) {
          node = config.layout[i].node;
          const port_check = config.layout[i][key];
          if (port_check === node) {
            output.push(node);
          }
        }
      }
    }
    res.send(output);
  }
});

function copyToAgents(file) {
  Object.keys(config.layout).forEach((get_node, i) => {
    Object.keys(config.layout[i]).forEach(key => {
      const node = config.layout[i].node;
      if ((!config.layout[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
        return;
      }

      const formData = {
        name: 'file',
        token,
        file: fs.createReadStream(file)
      };

      request.post({
        url: 'http://' + node + ':' + agentPort + '/receive-file',
        formData
      }, err => {
        if (!err) {
          addLog('\nCopied ' + file + ' to ' + node);
          console.log('\nCopied ' + file + ' to ' + node);
        }
      });
    });
  });
}

app.post('/receive-file', upload.single('file'), (req, res) => {
  const check_token = req.body.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    /* eslint-disable handle-callback-err */
    fs.readFile(req.file.path, (err, data) => { // FixMe: We should handle an error here...
      const newPath = '../' + req.file.originalname;
      /* eslint-disable no-unused-vars */
      /* eslint-disable handle-callback-err */
      fs.writeFile(newPath, data, err => { // FixMe: We should handle an error here...
        copyToAgents(newPath);
      });
      /* eslint-enable no-unused-vars */
      /* eslint-enable handle-callback-err */
    });
    /* eslint-enable handle-callback-err */
    res.end('');
  }
});

app.post('/listcommands', (req, res) => {
  const check_token = req.body.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else if (config.commandlist) {
    res.end(JSON.stringify(config.commandlist));
  } else {
    res.end('');
  }
});

app.post('/exec', (req, res) => {
  const check_token = req.body.token;
  let selected_node = '';
  if (req.body.node) {
    selected_node = req.body.node;
  }

  if (selected_node.indexOf('*') > -1) {
    selected_node = '';
  }

  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    const command = JSON.stringify({
      command: req.body.command,
      token
    });

    for (let i = 0; i < config.layout.length; i++) {
      const node = config.layout[i].node;

      const options = {
        url: 'http://' + node + ':' + agentPort + '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': command.length
        },
        body: command
      };

      if (selected_node.length === 0) {
        request(options, (error, response) => {
          if (error) {
            res.end('An error has occurred.');
          } else {
            const results = JSON.parse(response.body);
            addLog('\nNode:' + results.node + '\n' + results.output);
          }
        });
      }
      if (selected_node.indexOf(node) > -1) {
        request(options, (error, response) => {
          if (error) {
            res.end('An error has occurred.');
          } else {
            const results = JSON.parse(response.body);
            addLog('\nNode:' + results.node + '\n' + results.output);
          }
        });
      }
      res.end('');
    }
  }
});

app.get('/prune', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    const command = JSON.stringify({
      command: 'docker system prune -a -f',
      token
    });
    for (let i = 0; i < config.layout.length; i++) {
      const node = config.layout[i].node;

      const options = {
        url: 'http://' + node + ':' + agentPort + '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': command.length
        },
        body: command
      };

      request(options, (error, response) => {
        if (error) {
          res.end('An error has occurred.');
        } else {
          const results = JSON.parse(response.body);
          addLog('\nNode:' + results.node + '\n' + results.output);
          console.log('\nNode:' + results.node + '\n' + results.output);
        }
      });
      res.end('');
    }
  }
});

function move_container(container, newhost) {
  console.log('\nMigrating container ' + container + ' to ' + newhost + '......');
  addLog('\nMigrating container ' + container + ' to ' + newhost + '......');
  const options = {
    url: `http://127.0.0.1:3000/changehost?token=${token}&container=${container}&newhost=${newhost}`,
    method: 'GET'
  };

  request(options, error => {
    if (error) {
      console.log('Error connecting with server. ' + error);
    } else {
      config.automatic_heartbeat = 'enabled';
    }
  });
}

function container_failover(container) {
  let container_fail_counter = 0;
  let proceed = '';

  for (const key in container_faillog) {
    if (log.hasOwnProperty(key)) {
      if (container_faillog[key].indexOf(container) > -1) {
        container_fail_counter++;
      }
    }
  }

  if (container_fail_counter >= 3) {
    for (const bkey in container_faillog) {
      if (container_faillog[bkey].indexOf(container) > -1) {
        delete container_faillog[bkey];
        proceed = 1;
      }
    }

    if (proceed) {
      for (const key in config.container_host_constraints) {
        if (config.container_host_constraints.hasOwnProperty(key)) {
          const analyze = config.container_host_constraints[key].container.split(',');
          if (container.indexOf(analyze[0]) > -1) {
            analyze.splice(0, 1);
            const newhost = analyze[Math.floor(Math.random() * analyze.length)];
            move_container(container, newhost);
            config.automatic_heartbeat = 'disabled';
          }
        }
      }
    }
  }
}

function hb_check(node, container_port, container) {
  if (config.automatic_heartbeat.indexOf('enabled') > -1) {
    const client = new net.Socket();

    client.connect(container_port, node, container, () => {});

    client.on('end', () => {
      addLog('\nA Heart Beat Check Just Ran.');
    });

    client.on('error', () => {
      addLog('\n' + container + ' failed on: ' + node);
      console.log('\n' + container + ' failed on: ' + node);
      if (config.container_host_constraints) {
        container_faillog.push(container);
        container_failover(container);
      }

      const options = {
        host: '127.0.0.1',
        path: '/restart?node=' + node + '&container=' + container + '&token=' + token,
        port
      };

      http.get(options).on('error', e => {
        console.error(e);
      });
      client.destroy();
    });
  }
}

app.get('/hb', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    let node = '';
    let check_port = '';
    let container = '';
    for (let i = 0; i < config.hb.length; i++) {
      for (const key in config.hb[i]) {
        if (config.hb[i].hasOwnProperty(key)) {
          container = key;
          node = config.hb[i].node;
          check_port = config.hb[i][key];
          if (check_port !== node) {
            hb_check(node, check_port, container);
          }
        }
      }
    }
    res.end('');
  }
});

/* eslint-disable no-unused-vars */
function gatherLog(callback) { // FixMe: Why isn't this used anywhere?
  callback(log);
}
/* eslint-enable no-unused-vars */

app.get('/log', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    if (config.elasticsearch && config.elasticsearch_index) {
      elasticsearch(log);
    }
    res.send(log);
  }
});

app.get('/rsyslog', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    request(`http://${config.rsyslog_host}:${config.agent_port}/rsyslog?token=${token}`, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        res.end(body);
      } else {
        res.end('Error connecting with server. ' + error);
      }
    });
  }
});

app.get('/reloadconfig', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    if (process.env.PICLUSTER_CONFIG) {
      config = JSON.parse(fs.readFileSync(process.env.PICLUSTER_CONFIG, 'utf8'));
    } else {
      config = JSON.parse(fs.readFileSync('../config.json', 'utf8'));
    }
    token = config.token;
    dockerFolder = config.docker;
    addLog('\nReloading Config.json\n');
    res.end('');
  }
});

app.get('/getconfig', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    res.send(config);
  }
});

app.get('/killvip', (req, res) => {
  const check_token = req.query.token;
  if ((check_token !== token) || (!check_token)) {
    res.end('\nError: Invalid Credentials');
  } else {
    if (!config.vip) { // eslint-disable-line no-negated-condition,no-lonely-if
      res.end('\nError: VIP not configured.');
    } else {
      Object.keys(config.vip).forEach((get_node, i) => {
        Object.keys(config.vip[i]).forEach(key => {
          const node = config.vip[i].node;
          if ((!config.vip[i].hasOwnProperty(key) || key.indexOf('node') > -1)) {
            return;
          }
          const token_body = JSON.stringify({
            token
          });

          const options = {
            url: 'http://' + node + ':' + agentPort + '/killvip',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': token_body.length
            },
            body: token_body
          };

          request(options, error => {
            if (error) {
              res.end('An error has occurred.');
            }
          });
        });
      });
    }
  }
  res.end('');
});

app.post('/updateconfig', (req, res) => {
  let payload = req.body.payload;
  const check_token = req.body.token;

  try {
    const verify_payload = JSON.parse(req.body.payload);
    if ((check_token !== token) || (!check_token)) {
      res.end('\nError: Invalid Credentials');
    } else {
      payload = JSON.stringify(verify_payload, null, 4);
      fs.writeFile(config_file, payload, err => {
        if (err) {
          console.log('\nError while writing config.' + err);
        } else {
          res.end('Updated Configuration. Please reload it now for changes to take effect.');
        }
      });
    }
  } catch (err) {
    res.end('Error: Invalid JSON. Configuration not saved.');
  }
});

containerDetails();

server.listen(port, () => {
  console.log('Listening on port %d', port);
});
