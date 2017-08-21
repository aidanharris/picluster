<template>
  <div class="header">
    <nav>
      <ul>
        <li>
          <a href='#'>
            <img :src='imageSource' width='65' height='65' />
          </a>
        </li>
        <li v-for="(val, key) in links">
          <a href="#!">
            {{key}}
          </a>
          <ul class="dropdown" style="display: none;" v-if="val.length > 0">
            <li v-for="link in val">
              <a :id="link.id||''" :href="link.href||'#'">{{link.title}}</a>
            </li>
          </ul>
        </li>
      </ul>
    </nav>
  </div>
</template>

<script>
export default {
  name: 'header',
  data () {
    return {
      imageSource: require('../../assets/images/sphere.png'),
      links: {
        System: [
          {
            id: 'nodes',
            title: 'Nodes'
          },
          {
            id: 'editconfig',
            title: 'Edit Configuration'
          },
          {
            id: 'reloadconfig',
            title: 'Reload Configuration'
          },
          {
            id: 'addhost',
            title: 'Add Host'
          },
          {
            id: 'rmhost',
            title: 'Remove Host'
          }
        ],
        Containers: [
          {
            id: 'layout',
            title: 'Running'
          },
          {
            id: 'manage',
            title: 'Manage'
          },
          {
            id: 'addcontainer',
            title: 'Add'
          }
        ],
        Images: [
          {
            id: 'pull',
            title: 'Pull'
          },
          {
            id: 'build',
            title: 'Manage'
          },
          {
            id: 'image-layout',
            title: 'List'
          },
          {
            id: 'upload',
            title: 'Upload Files'
          }
        ],
        Operations: [
          {
            id: 'killvip',
            title: 'Reset Virtual IP'
          },
          {
            id: 'sandbox',
            title: 'Run Command(s)'
          },
          {
            id: 'hb',
            title: 'Heartbeat'
          },
          {
            id: 'prune',
            title: 'Clean Docker'
          },
          {
            id: 'terminal',
            title: 'Terminal'
          },
          {
            id: 'kibana',
            title: 'Kibana'
          }
        ],
        Logs: [
          {
            id: 'log',
            title: 'PiCluster Logs'
          },
          {
            id: 'syslog',
            title: 'Syslog Analytics'
          },
          {
            id: 'rsyslog',
            title: 'Rsyslog Analytics'
          }
        ]
      }
    }
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h1, h2 {
  font-weight: normal;
}

ul {
  list-style-type: none;
  padding: 0;
}

li {
  display: inline-block;
  margin: 0 10px;
}

a {
  color: #42b983;
}
</style>
